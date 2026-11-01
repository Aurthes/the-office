"use strict";
const crypto = require("node:crypto");
const { sessionItem, realtimeSessionItem, clipText } = require("./codex-session-items");
const { answerQuestions } = require("./codex-session-questions");
const { messageInput } = require("./codex-session-uploads");
const { sessionSettings, sessionChoices, settingsPatch } = require("./codex-session-settings");
const supportedApprovals = new Set(["item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval"]);

class CodexSessionControls {
  constructor(client, asyncQuestions = () => [], options = {}) { this.client = client; this.asyncQuestions = asyncQuestions; this.options = options; this.states = new Map(); this.requests = new Map(); this.sends = new Map(); this.attaching = new Map(); }
  state(id) {
    if (!this.states.has(id)) this.states.set(id, { version: 0, activeTurnId: null, items: new Map(), turnStatus: null, error: null });
    return this.states.get(id);
  }
  requireReady() { if (!this.client?.ready) throw new Error("Codex is disconnected"); }
  async attach(id) {
    this.requireReady();
    if (!this.attaching.has(id)) {
      // Native resume rejoins a loaded thread or restores the same stored
      // thread. Omit overrides so Codex restores its tools and configuration.
      const pending = this.client.call("thread/resume", { threadId: id, excludeTurns: true }).then(async result => {
        if (!this.state(id).settings) this.saveSettings(id, result);
        await this.refreshTurn(id); return true;
      }).catch(error => { this.attaching.delete(id); throw error; });
      this.attaching.set(id, pending);
    }
    await this.attaching.get(id);
  }
  saveSettings(id, result) {
    const settings = this.options.settings ? this.options.settings.current(id, result) : sessionSettings(result);
    if (!settings) return;
    const state = this.state(id);
    state.predictionContext = { model: result.model, modelProvider: result.modelProvider ?? state.predictionContext?.modelProvider,
      planMode: result.collaborationMode === undefined ? Boolean(state.predictionContext?.planMode) : result.collaborationMode?.mode === "plan" };
    state.cwd = result.cwd;
    if (JSON.stringify(state.settings) !== JSON.stringify(settings)) { state.settings = settings; state.version++; }
  }
  async choices(id) {
    await this.attach(id);
    if (this.options.settings) { const result = await this.options.settings.choices(id); this.saveSettings(id, {}); return result; }
    return sessionChoices(this.client, this.state(id).cwd);
  }
  async updateSettings(id, input) {
    if (this.options.settings) { const result = await this.options.settings.update(id, input); this.saveSettings(id, {}); return result; }
    const choices = await this.choices(id);
    if (!this.state(id).settings) throw new Error("原会话设置尚未就绪");
    const patch = settingsPatch(input, this.state(id).settings, choices);
    await this.client.call("thread/settings/update", { threadId: id, ...patch });
    // The native settings notification is the source of truth, pushed to every
    // connected view. Never apply a guessed optimistic state or restart a turn.
    return { updated: true };
  }
  async refreshTurn(id) {
    const result = await this.client.call("thread/turns/list", { threadId: id, limit: 1, itemsView: "notLoaded", sortDirection: "desc" });
    const turn = result.data[0], state = this.state(id);
    state.activeTurnId = turn?.status === "inProgress" ? turn.id : null;
    state.turnStatus = turn?.status || null; state.error = turn?.error?.message || null;
  }
  handle(frame) {
    const p = frame.params || {}, id = p.threadId;
    if (frame.method === "connection/closed") { this.attaching.clear(); return; }
    if (!id) return;
    if (frame.method === "thread/closed" || (frame.method === "thread/status/changed" && p.status?.type === "notLoaded")) this.attaching.delete(id);
    const state = this.state(id);
    if (frame.method === "thread/tokenUsage/updated") { state.tokenUsage = p.tokenUsage; state.version++; return; }
    if (frame.method === "thread/settings/updated") { this.saveSettings(id, p.threadSettings); return; }
    if (frame.id !== undefined) {
      this.requests.set(String(frame.id), { requestId: String(frame.id), wireId: frame.id, method: frame.method, params: p, supported: supportedApprovals.has(frame.method) });
      state.version++; return;
    }
    if (frame.method === "serverRequest/resolved") { this.requests.delete(String(p.requestId)); state.version++; return; }
    if (frame.method === "turn/started") { state.activeTurnId = p.turn.id; state.turnStatus = "inProgress"; state.error = null; state.version++; }
    if (frame.method === "turn/completed") {
      if (state.activeTurnId === p.turn.id) { state.activeTurnId = null; state.turnStatus = p.turn.status; state.error = p.turn.error?.message || null; }
      for (const [key, request] of this.requests) if (request.params.threadId === id && request.params.turnId === p.turn.id) this.requests.delete(key);
      state.version++;
    }
    const item = p.item;
    if (frame.method === "item/agentMessage/delta") {
      const key = `${p.turnId}:${p.itemId}`, previous = state.items.get(key);
      const text = (previous?.content || "") + p.delta;
      state.items.set(key, { ...previous, id: key, turnId: p.turnId, role: "assistant", ...clipText(text, 64 * 1024), truncated: Buffer.byteLength(text) > 64 * 1024 || previous?.truncated, version: ++state.version });
    } else if (frame.method === "thread/realtime/item/completed") {
      const normalized = realtimeSessionItem(item);
      if (!normalized) return;
      state.items.set(normalized.id, { ...normalized, ...clipText(normalized.content, 64 * 1024), version: ++state.version });
    } else if (["item/started", "item/completed"].includes(frame.method) && item) {
      const normalized = sessionItem(item, p.turnId);
      if (!normalized) return;
      const key = normalized.id;
      const details = item.type === "fileChange" ? JSON.stringify(item.changes || []) : null;
      state.items.set(key, { ...normalized, ...clipText(normalized.content, normalized.role === "tool" ? 2000 : 64 * 1024), status: item.status || (frame.method === "item/started" ? "inProgress" : "completed"), details: details?.slice(0, 4000), incompleteDetails: details ? Buffer.byteLength(details) > 16000 || details.length > 4000 : false, version: ++state.version });
    }
    while (state.items.size > 128) state.items.delete(state.items.keys().next().value);
  }
  questions(id) {
    return [...this.requests.values()].filter(r => r.params.threadId === id && r.method === "item/tool/requestUserInput").slice(0, 3).map(r => ({
      requestId: r.requestId, submitted: Boolean(r.submitted), questions: r.params.questions,
    })).filter(r => Array.isArray(r.questions) && r.questions.length > 0 && r.questions.length <= 3 && Buffer.byteLength(JSON.stringify(r)) <= 16000);
  }
  replyQuestions(id, requestId, answers) {
    this.requireReady();
    const request = this.requests.get(String(requestId)), visible = this.questions(id).find(q => q.requestId === String(requestId));
    if (!request || !visible || request.submitted) throw new Error("问题已结束或答案已提交，请核对当前会话");
    const validated = answerQuestions(visible, answers);
    this.client.respond(request.wireId, { answers: Object.fromEntries(validated.map(answer => [answer.questionItemId, { answers: [answer.answer] }])) });
    request.submitted = true; this.state(id).version++;
    return { status: "submitted" };
  }
  snapshot(id, since = 0) {
    this.requireReady(); const state = this.state(id);
    const questions = []; let questionBytes = 0;
    for (const question of [...this.questions(id), ...this.asyncQuestions(id)]) {
      const bytes = Buffer.byteLength(JSON.stringify(question));
      if (questions.length >= 8 || questionBytes + bytes > 32000) break;
      questions.push(question); questionBytes += bytes;
    }
    const signature = JSON.stringify(questions);
    if (state.questionSignature !== signature) { if (state.questionSignature !== undefined || questions.length) state.version++; state.questionSignature = signature; }
    const changed = [...state.items.values()].filter(item => item.version > (since > state.version ? 0 : since)).sort((a, b) => a.version - b.version);
    const items = []; let bytes = 0;
    for (const item of changed) {
      const visible = { ...item }; delete visible.details; delete visible.incompleteDetails;
      const size = Buffer.byteLength(JSON.stringify(visible));
      if (items.length && bytes + size > 192 * 1024) break;
      items.push(visible); bytes += size;
    }
    const hasMore = items.length < changed.length;
    return { connected: true, version: hasMore ? items.at(-1).version : state.version, hasMore, activeTurnId: state.activeTurnId, turnStatus: state.turnStatus, error: state.error, settings: state.settings, tokenUsage: state.tokenUsage, ...(this.options.features ? { features: this.options.features } : {}), items,
      questions,
      approvalCount: [...this.requests.values()].filter(r => r.params.threadId === id && r.method !== "item/tool/requestUserInput").length,
      approvals: [...this.requests.values()].filter(r => r.params.threadId === id && r.method !== "item/tool/requestUserInput").slice(0, 2).map(request => {
        const item = state.items.get(`${request.params.turnId}:${request.params.itemId}`);
        const oversized = Buffer.byteLength(JSON.stringify(request.params)) > 8000;
        return { requestId: request.requestId, method: request.method, submitted: request.submitted, params: oversized ? { threadId: id, reason: "Approval request is too large to display here" } : request.params,
          decisions: request.params.availableDecisions?.filter(value => typeof value === "string") || ["accept", "decline"],
          details: item?.details, supported: request.supported && !oversized && (request.method !== "item/fileChange/requestApproval" || Boolean(item?.details && !item.incompleteDetails)) };
      }) };
  }
  async send(id, text, requestId, attachments = [], { resumeInterrupted = false } = {}) {
    this.requireReady();
    const input = await messageInput(text, attachments, id);
    if (typeof requestId !== "string" || requestId.length > 100 || !requestId) throw new Error("缺少发送请求 ID");
    const prior = this.sends.get(requestId);
    if (prior) {
      if (prior.id !== id || prior.resumeInterrupted !== resumeInterrupted || prior.hash !== crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex")) throw new Error("发送请求 ID 冲突");
      if (!prior.result) throw new Error("这次发送已提交，结果需核对，未重复发送");
      return prior.result;
    }
    const entry = { id, resumeInterrupted, hash: crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex") };
    this.sends.set(requestId, entry);
    if (this.sends.size > 128) this.sends.delete(this.sends.keys().next().value);
    await this.attach(id); await this.refreshTurn(id);
    const active = this.state(id).activeTurnId;
    if (resumeInterrupted && (active || this.state(id).turnStatus !== "interrupted")) throw new Error("This task is no longer interrupted. Refresh the conversation before continuing.");
    // The desktop uses this identity to display external steering as a user
    // message. Reuse the send ID so duplicate requests keep the same identity.
    const result = await this.client.call(active ? "turn/steer" : "turn/start", { threadId: id, input, clientUserMessageId: requestId, ...(active ? { expectedTurnId: active } : this.options.settings?.overrides(id) || {}) });
    const turnId = result.turn?.id || result.turnId;
    this.state(id).activeTurnId = turnId;
    this.state(id).turnStatus = "inProgress";
    this.state(id).version++;
    return entry.result = { status: active ? "steered" : "started", turnId };
  }
  async stop(id) {
    this.requireReady(); await this.attach(id); await this.refreshTurn(id);
    const turnId = this.state(id).activeTurnId;
    if (!turnId) return { status: "idle" };
    await this.client.call("turn/interrupt", { threadId: id, turnId });
    return { status: "interruptRequested", turnId };
  }
  reply(id, requestId, decision) {
    this.requireReady();
    const request = this.requests.get(String(requestId));
    if (!request || request.params.threadId !== id) throw new Error("审批已结束或不属于此会话");
    if (!request.supported || !["accept", "decline", "cancel"].includes(decision)) throw new Error("This approval is unsupported here; stop the task to cancel");
    if (Buffer.byteLength(JSON.stringify(request.params)) > 8000) throw new Error("Approval request is too large; stop the task to cancel");
    if (request.method === "item/fileChange/requestApproval") {
      const item = this.state(id).items.get(`${request.params.turnId}:${request.params.itemId}`);
      if (!item?.details || item.incompleteDetails) throw new Error("File changes cannot be fully displayed; stop the task to cancel");
    }
    if (request.params.availableDecisions && !request.params.availableDecisions.includes(decision)) throw new Error("后台未提供这个审批选项");
    if (request.submitted) throw new Error("审批答复已提交，等待原后台确认");
    this.client.respond(request.wireId, request.method === "item/permissions/requestApproval" ? { permissions: decision === "accept" ? request.params.permissions : {}, scope: "turn" } : { decision }); request.submitted = true;
    this.state(id).version++;
    return { status: "submitted" };
  }
}
module.exports = { CodexSessionControls };
