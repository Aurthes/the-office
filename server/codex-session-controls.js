"use strict";
const crypto = require("node:crypto");
const { sessionItem, realtimeSessionItem, clipText } = require("./codex-session-items");
const { interruptedInput } = require("./codex-session-edit");
const { answerQuestions } = require("./codex-session-questions");
const { messageInput } = require("./codex-session-uploads");
const { sessionSettings, sessionChoices, settingsPatch } = require("./codex-session-settings");
const supportedApprovals = new Set(["item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval"]);
const RETRY_DELAY_MS = 15000;
const MAX_AUTO_RETRIES = 3;

class CodexSessionControls {
  constructor(client, asyncQuestions = () => [], options = {}) { this.client = client; this.asyncQuestions = asyncQuestions; this.options = options; this.states = new Map(); this.requests = new Map(); this.sends = new Map(); this.attaching = new Map(); }
  state(id) {
    if (!this.states.has(id)) this.states.set(id, { version: 0, turnVersion: 0, turnStateKnown: false, activeTurnId: null, activeTurnStartedAt: null, items: new Map(), turnStatus: null, error: null, historyEpoch: this.options.history?.read(id) || "0", pendingSends: 0, discardedTurns: new Set(),
      recovery: { attempts: 0, stopped: false, ...this.options.recovery?.read(id) } });
    return this.states.get(id);
  }
  saveRecovery(id, patch) {
    const state = this.state(id), next = { ...state.recovery, ...patch };
    if (JSON.stringify(next) === JSON.stringify(state.recovery)) return;
    state.recovery = next; this.options.recovery?.write(id, next);
  }
  requireReady() { if (!this.client?.ready) throw new Error("Codex is disconnected"); }
  retryChanged(id) { this.state(id).version++; this.options.changed?.(id); }
  cancelRetry(id) {
    const state = this.state(id);
    if (!state.retry) return;
    clearTimeout(state.retry.timer); state.retry = null; this.retryChanged(id);
  }
  scheduleRetry(id, turn) {
    const state = this.state(id);
    if (this.closed || !turn?.id || !["failed", "interrupted"].includes(turn.status) || state.recovery.stopped
      || state.editCommit || state.editUncertain || state.recovery.attempts >= MAX_AUTO_RETRIES || state.retryHandledTurnId === turn.id) return;
    this.cancelRetry(id);
    const retry = { turnId: turn.id, at: Date.now() + RETRY_DELAY_MS, dispatching: false };
    state.retryHandledTurnId = turn.id; state.retry = retry;
    retry.timer = setTimeout(() => {
      retry.dispatching = true; this.retryChanged(id);
      // Count before dispatch so a restart cannot reset the limit. Every attempt
      // rechecks the latest native turn; original inputs are never replayed.
      void Promise.resolve().then(() => {
        if (this.closed || state.retry !== retry) return;
        this.saveRecovery(id, { attempts: state.recovery.attempts + 1 });
        return this.send(id, "Continue where you left off.", `retry-${crypto.randomUUID()}`, [], { automaticRetry: retry });
      }).catch(error => { if (state.retry === retry) { state.error = error.message; retry.failed = true; } })
        .finally(() => {
          if (state.retry !== retry) return;
          this.cancelRetry(id);
          if (retry.failed) {
            state.retryHandledTurnId = null;
            this.scheduleRetry(id, { id: state.lastTurnId, status: state.turnStatus });
          }
        });
    }, RETRY_DELAY_MS);
    retry.timer.unref?.(); this.retryChanged(id);
  }
  close() { this.closed = true; for (const id of this.states.keys()) this.cancelRetry(id); }
  async recover(id) {
    const turn = await this.refreshTurn(id);
    if (turn) this.scheduleRetry(id, turn);
  }
  async attach(id) {
    this.requireReady();
    if (!this.attaching.has(id)) {
      // Native resume rejoins a loaded thread or restores the same stored
      // thread. Omit overrides so Codex restores its tools and configuration.
      const entry = { ready: false };
      entry.pending = this.client.call("thread/resume", { threadId: id, excludeTurns: true }).then(async result => {
        if (!this.state(id).settings) this.saveSettings(id, result);
        await this.refreshTurn(id); entry.ready = true;
      }).catch(error => { if (this.attaching.get(id) === entry) this.attaching.delete(id); throw error; });
      this.attaching.set(id, entry);
    }
    const entry = this.attaching.get(id), refreshed = !entry.ready;
    await entry.pending;
    return refreshed;
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
    const state = this.state(id), version = state.turnVersion;
    const result = await this.client.call("thread/turns/list", { threadId: id, limit: 1, itemsView: "notLoaded", sortDirection: "desc" });
    // Token usage, questions and item updates do not supersede a turn read.
    // Only a newer turn lifecycle event can make its status obsolete.
    if (state.turnVersion !== version) return;
    state.turnStateKnown = true;
    const turn = result.data[0];
    state.lastTurnId = turn?.id;
    const sameTurn = state.activeTurnId === turn?.id;
    state.activeTurnStartedAt = turn?.status === "inProgress"
      ? Number.isFinite(turn.startedAt) ? turn.startedAt * 1000 : sameTurn ? state.activeTurnStartedAt : null
      : null;
    state.activeTurnId = turn?.status === "inProgress" ? turn.id : null;
    state.turnStatus = turn?.status || null; state.error = turn?.error?.message || null;
    if (turn?.status === "completed") this.saveRecovery(id, { attempts: 0 });
    state.version++;
    return turn;
  }
  handle(frame) {
    const p = frame.params || {}, id = p.threadId;
    if (frame.method === "connection/closed") { this.attaching.clear(); this.close(); return; }
    if (!id) return;
    if (frame.method === "thread/closed" || (frame.method === "thread/status/changed" && p.status?.type === "notLoaded")) this.attaching.delete(id);
    const state = this.state(id);
    if (state.discardedTurns.has(p.turnId || p.turn?.id)) return;
    if (frame.method === "thread/reverted") { state.revertCount = (state.revertCount || 0) + 1; state.editUncertain = null; this.resetHistory(id); return; }
    if (frame.method === "thread/tokenUsage/updated") { state.tokenUsage = p.tokenUsage; state.version++; return; }
    if (frame.method === "thread/settings/updated") { this.saveSettings(id, p.threadSettings); return; }
    if (frame.id !== undefined) {
      this.requests.set(String(frame.id), { requestId: String(frame.id), wireId: frame.id, method: frame.method, params: p, supported: supportedApprovals.has(frame.method) });
      state.version++; return;
    }
    if (frame.method === "serverRequest/resolved") { this.requests.delete(String(p.requestId)); state.version++; return; }
    if (frame.method === "turn/started") {
      state.turnStateKnown = true;
      state.turnVersion++;
      // Start notifications can follow their RPC response. They never reset
      // recovery metadata; only explicit new input or successful completion can.
      this.cancelRetry(id); state.lastTurnId = p.turn.id;
      state.activeTurnStartedAt = Number.isFinite(p.turn.startedAt) ? p.turn.startedAt * 1000
        : state.activeTurnId === p.turn.id ? state.activeTurnStartedAt : Date.now();
      state.activeTurnId = p.turn.id; state.turnStatus = "inProgress"; state.error = null; state.version++;
    }
    if (frame.method === "turn/completed") {
      state.turnVersion++;
      if (state.activeTurnId === p.turn.id || (!state.activeTurnId && !state.lastTurnId)) {
        state.turnStateKnown = true;
        state.lastTurnId = p.turn.id; state.activeTurnId = null; state.activeTurnStartedAt = null; state.turnStatus = p.turn.status; state.error = p.turn.error?.message || null;
        if (p.turn.status === "completed") this.saveRecovery(id, { attempts: 0 });
        this.scheduleRetry(id, p.turn);
      }
      for (const [key, request] of this.requests) if (request.params.threadId === id && request.params.turnId === p.turn.id) this.requests.delete(key);
      state.version++;
    }
    const item = p.item;
    if (frame.method === "item/agentMessage/delta") {
      const key = `${p.turnId}:${p.itemId}`, previous = state.items.get(key);
      const text = (previous?.content || "") + p.delta;
      state.items.set(key, { ...previous, id: key, turnId: p.turnId, role: "assistant", ...clipText(text, 64 * 1024), truncated: Buffer.byteLength(text) > 64 * 1024 || previous?.truncated, version: ++state.version });
      this.options.replyContext?.record(id, state.items.get(key));
    } else if (frame.method === "thread/realtime/item/completed") {
      const normalized = realtimeSessionItem(item);
      if (!normalized) return;
      state.items.set(normalized.id, { ...normalized, ...clipText(normalized.content, 64 * 1024), version: ++state.version });
    } else if (["item/started", "item/completed"].includes(frame.method) && item) {
      const previous = state.items.get(`${p.turnId}:${item.id}`);
      const normalized = sessionItem({ ...item, startedAtMs: item.startedAtMs ?? p.startedAtMs ?? previous?.timestamp,
        completedAtMs: item.completedAtMs ?? p.completedAtMs }, p.turnId);
      if (!normalized) return;
      const key = normalized.id;
      this.options.replyContext?.record(id, normalized, item.clientId);
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
  approvalCount(id) {
    let count = 0;
    for (const request of this.requests.values()) if (request.params.threadId === id && request.method !== "item/tool/requestUserInput") count++;
    return count;
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
      const visible = { ...(this.options.replyContext?.decorate(id, [item])[0] || item) }; delete visible.details; delete visible.incompleteDetails;
      const size = Buffer.byteLength(JSON.stringify(visible));
      if (items.length && bytes + size > 192 * 1024) break;
      items.push(visible); bytes += size;
    }
    const hasMore = items.length < changed.length;
    return { connected: true, historyEpoch: state.historyEpoch, version: hasMore ? items.at(-1).version : state.version, hasMore, activeTurnId: state.activeTurnId, activeTurnStartedAt: state.activeTurnStartedAt, turnStatus: state.turnStatus, error: state.error, retryAt: state.retry?.at ?? null, retrying: Boolean(state.retry?.dispatching),
      retryExhausted: !state.retry && !state.recovery.stopped && state.recovery.attempts >= MAX_AUTO_RETRIES && ["failed", "interrupted"].includes(state.turnStatus),
      settings: state.settings, tokenUsage: state.tokenUsage, ...(this.options.features ? { features: { ...this.options.features, ...(this.options.composer ? { chatReferences: this.options.composer.canReference(id) } : {}) } } : {}), items,
      questions,
      approvalCount: this.approvalCount(id),
      approvals: [...this.requests.values()].filter(r => r.params.threadId === id && r.method !== "item/tool/requestUserInput").slice(0, 2).map(request => {
        const item = state.items.get(`${request.params.turnId}:${request.params.itemId}`);
        const oversized = Buffer.byteLength(JSON.stringify(request.params)) > 8000;
        return { requestId: request.requestId, method: request.method, submitted: request.submitted, params: oversized ? { threadId: id, reason: "Approval request is too large to display here" } : request.params,
          decisions: request.params.availableDecisions?.filter(value => typeof value === "string") || ["accept", "decline"],
          details: item?.details, supported: request.supported && !oversized && (request.method !== "item/fileChange/requestApproval" || Boolean(item?.details && !item.incompleteDetails)) };
      }) };
  }
  async send(id, text, requestId, attachments = [], options = {}) {
    const state = this.state(id);
    if (state.editCommit) throw new Error("An edit is being committed. Wait before sending.");
    if (state.editUncertain && options.automaticRetry) return { status: "cancelled" };
    state.pendingSends++;
    try {
      // A timed-out revert may arrive later and cut off a newly started turn.
      // New user input is NOT proof that the old destructive request ended.
      if (state.editUncertain && !await this.reconcileEdit(id)) throw new Error("A previous rewind is still unconfirmed. No new input was sent; check the conversation before retrying.");
      return await this.sendInput(id, text, requestId, attachments, options);
    }
    finally { state.pendingSends--; }
  }
  async sendInput(id, text, requestId, attachments = [], { resumeInterrupted = false, onlyIfIdle = false, automaticRetry = null, references = [], replyContext = null, usage = null } = {}) {
    this.requireReady();
    const usageEntry = usage ? { ...usage, entryAt: Date.now(), entryId: requestId } : null;
    if (!automaticRetry) this.cancelRetry(id);
    const prepared = this.options.composer ? await this.options.composer.prepare(id, text, references) : { text, items: [] };
    const input = [...await messageInput(prepared.text, attachments, id), ...prepared.items];
    if (typeof requestId !== "string" || requestId.length > 100 || !requestId) throw new Error("缺少发送请求 ID");
    const prior = this.sends.get(requestId);
    if (prior) {
      if (prior.id !== id || prior.resumeInterrupted !== resumeInterrupted || prior.hash !== crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex")) throw new Error("发送请求 ID 冲突");
      if (!prior.result) throw new Error("这次发送已提交，结果需核对，未重复发送");
      return prior.result;
    }
    const entry = { id, clientId: requestId, resumeInterrupted, hash: crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex") };
    this.sends.set(requestId, entry);
    if (this.sends.size > 128) this.sends.delete(this.sends.keys().next().value);
    if (!automaticRetry) this.saveRecovery(id, { attempts: 0, stopped: false });
    const refreshed = await this.attach(id);
    // Live lifecycle notifications keep ordinary sends current. Exceptional
    // dispatches still verify native state; uncertain outcomes require a read.
    if (!this.state(id).turnStateKnown || (!refreshed && (automaticRetry || onlyIfIdle || resumeInterrupted))) await this.refreshTurn(id);
    const active = this.state(id).activeTurnId;
    if (automaticRetry) {
      const allowed = !this.options.canRetry || await this.options.canRetry(id);
      const state = this.state(id);
      if (this.closed || !allowed || state.recovery.stopped || state.retry !== automaticRetry || active || state.activeTurnId) return { status: "cancelled" };
      if (state.lastTurnId !== automaticRetry.turnId || !["failed", "interrupted"].includes(state.turnStatus)) {
        this.cancelRetry(id);
        this.scheduleRetry(id, { id: state.lastTurnId, status: state.turnStatus });
        return { status: "cancelled" };
      }
    }
    if (onlyIfIdle && active) { this.sends.delete(requestId); return { status: "busy" }; }
    if (resumeInterrupted && (active || this.state(id).turnStatus !== "interrupted")) throw new Error("This task is no longer interrupted. Refresh the conversation before continuing.");
    // The desktop uses this identity to display external steering as a user
    // message. Reuse the send ID so duplicate requests keep the same identity.
    const submittedAt = Date.now();
    this.options.replyContext?.prepare(id, requestId, replyContext || ((automaticRetry || resumeInterrupted) ? this.options.replyContext.current(id) : null), (automaticRetry || resumeInterrupted) ? "continue" : replyContext ? "handoff" : "user");
    const current = this.state(id);
    const previousTurnId = current.lastTurnId;
    let result;
    if (automaticRetry) current.autoStarting = automaticRetry;
    current.turnStateKnown = false;
    try {
      entry.dispatched = true;
      const metadata = automaticRetry || resumeInterrupted ? { trigger: automaticRetry ? "automaticRetry" : "continue", inheritTurnId: automaticRetry?.turnId || previousTurnId, entryId: requestId, entryAt: submittedAt } : usageEntry;
      const params = { threadId: id, input, clientUserMessageId: requestId, ...(active ? { expectedTurnId: active } : this.options.settings?.overrides(id) || {}) };
      // The third argument belongs only to the local Office store. It is never
      // a native RPC parameter (or native client's timeout argument).
      result = await this.client.call(active ? "turn/steer" : "turn/start", params, ...(this.options.usageMetadata && metadata ? [metadata] : []));
    } catch (error) {
      current.turnStateKnown = false; throw error;
    } finally { if (current.autoStarting === automaticRetry) current.autoStarting = null; }
    const turnId = result.turn?.id || result.turnId;
    const state = this.state(id);
    // Native completion can arrive before the start RPC resolves. Its terminal
    // state (and next retry timer) must win over the delayed start response.
    if (state.lastTurnId === previousTurnId || state.activeTurnId === turnId) {
      state.activeTurnStartedAt = Number.isFinite(result.turn?.startedAt) ? result.turn.startedAt * 1000
        : state.activeTurnId === turnId ? state.activeTurnStartedAt : active ? null : submittedAt;
      state.activeTurnId = turnId; state.turnStatus = "inProgress"; state.error = null;
      state.turnStateKnown = true;
    }
    this.state(id).version++;
    // Stop can arrive after turn/start was sent but before its result. Interrupt
    // that exact returned turn rather than allowing the cancelled retry to run.
    if (automaticRetry?.stopRequested && !automaticRetry.interruptRequested && state.activeTurnId === turnId) {
      automaticRetry.interruptRequested = true;
      state.turnStateKnown = false;
      await this.client.call("turn/interrupt", { threadId: id, turnId });
    }
    return entry.result = { status: active ? "steered" : "started", turnId };
  }
  resetHistory(id, targetTurnId) {
    const state = this.state(id);
    this.cancelRetry(id);
    const removedTurnId = targetTurnId || state.lastTurnId || state.edit?.turnId;
    if (removedTurnId) state.discardedTurns.add(removedTurnId);
    while (state.discardedTurns.size > 128) state.discardedTurns.delete(state.discardedTurns.values().next().value);
    state.historyEpoch = crypto.randomUUID(); state.items.clear(); state.turnVersion++;
    state.turnStateKnown = false; state.lastTurnId = null; state.activeTurnId = null; state.activeTurnStartedAt = null;
    state.turnStatus = null; state.error = null; state.tokenUsage = null;
    for (const [key, request] of this.requests) if (request.params.threadId === id) this.requests.delete(key);
    this.options.history?.reset(id, state.historyEpoch, removedTurnId);
    state.version++; this.options.changed?.(id);
  }
  async reconcileEdit(id) {
    const state = this.state(id), pending = state.editUncertain;
    if (!pending) return true;
    let cursor;
    for (let page = 0; page < 64; page++) {
      const result = await this.client.call("thread/turns/list", { threadId: id, limit: 100, itemsView: "notLoaded", sortDirection: "desc", ...(cursor ? { cursor } : {}) });
      if (state.editUncertain !== pending) return !state.editUncertain;
      if (result.data.some(turn => turn.id === pending.turnId)) return false;
      if (!result.nextCursor) {
        // Only a complete authoritative read proves the target is gone. A
        // different latest turn alone is insufficient (target may be older).
        state.editUncertain = null; state.edit = null;
        this.options.history?.reverted?.(id); this.resetHistory(id, pending.turnId);
        return true;
      }
      cursor = result.nextCursor;
    }
    return false;
  }
  async prepareEdit(id) {
    this.requireReady();
    const state = this.state(id);
    if (state.editUncertain && !await this.reconcileEdit(id)) throw new Error("The previous rewind is not confirmed. Check the conversation before editing again.");
    if (state.editCommit || state.pendingSends || this.options.editBlocked?.(id)) throw new Error("Wait for pending input or the voice call to finish before editing.");
    await this.attach(id);
    const version = state.turnVersion;
    const input = await interruptedInput(this.client, id);
    if (version !== state.turnVersion || state.pendingSends) throw new Error("The conversation changed. Stop it and prepare the edit again.");
    for (const entry of this.sends.values()) if (entry.id === id && entry.dispatched && !entry.result && !input.clientIds.includes(entry.clientId)) throw new Error("A previous send is not confirmed. Check the conversation before editing.");
    this.saveRecovery(id, { stopped: true }); this.cancelRetry(id);
    const prepared = { ...input, token: crypto.randomUUID(), historyEpoch: state.historyEpoch };
    state.edit = prepared;
    return { token: prepared.token, turnId: input.turnId, text: input.text, inputCount: input.inputCount };
  }
  async commitEdit(id, { token, message, requestId }) {
    this.requireReady();
    // Validate everything recoverable before the destructive RPC.
    await messageInput(message, [], id);
    if (typeof requestId !== "string" || !requestId || requestId.length > 100) throw new Error("An edit request ID is required");
    const state = this.state(id), prepared = state.edit;
    if (this.sends.has(requestId)) throw new Error("A fresh send identity is required for the edited turn");
    if (!prepared || prepared.token !== token) throw new Error("This edit has expired. Prepare it again.");
    if (state.editCommit || state.editUncertain || state.pendingSends || this.options.editBlocked?.(id)) throw new Error("Pending input or an unresolved edit prevents resending. Check the conversation.");
    state.editCommit = true;
    this.saveRecovery(id, { stopped: true }); this.cancelRetry(id);
    try {
      const version = state.turnVersion;
      const current = await interruptedInput(this.client, id);
      if (state.turnVersion !== version || state.historyEpoch !== prepared.historyEpoch || current.fingerprint !== prepared.fingerprint) throw new Error("The conversation changed. Nothing was rewound; prepare the edit again.");
      // Persist invalidation BEFORE dispatch, including crashes or an unknown
      // revert result. Re-reading unchanged history after refusal is harmless.
      this.resetHistory(id, prepared.turnId);
      const observedReverts = state.revertCount || 0;
      try { await this.client.call("thread/revert", { threadId: id, beforeTurnId: prepared.turnId }); }
      catch (error) {
        if (typeof error.code === "number") {
          state.discardedTurns.delete(prepared.turnId);
          this.options.history?.refused?.(id, prepared.turnId);
          await this.refreshTurn(id).catch(() => {});
          return { status: "revert_failed", message: `History was not rewound: ${error.message}` };
        }
        state.editUncertain = (state.revertCount || 0) > observedReverts ? null : { turnId: prepared.turnId };
        // Reconcile by native event or a complete read, never by resubmitting.
        const targetDeleted = !state.editUncertain || await this.reconcileEdit(id).catch(() => false);
        return { status: "revert_unknown", message: targetDeleted
          ? "History was rewound, but the revert receipt was lost. Edited text was not sent. Check the conversation before sending again."
          : "The rewind outcome is unknown. Edited text was not sent. Check the conversation before sending again." };
      }
      state.edit = null;
      this.options.history?.reverted?.(id);
      this.resetHistory(id, prepared.turnId);
      try {
        const result = await this.sendInput(id, message, requestId, [], { onlyIfIdle: true, usage: { purpose: "chat_work", trigger: "edit" } });
        if (result.status === "busy") throw new Error("A new turn is already running");
        return { ...result, status: "edited", historyEpoch: state.historyEpoch };
      } catch (error) {
        this.saveRecovery(id, { stopped: true }); this.cancelRetry(id);
        return { status: typeof error.code === "number" ? "send_failed" : "send_unknown", message: `History was rewound; ${typeof error.code === "number" ? "edited text was rejected" : "edited text delivery was not confirmed"}. Keep this text and check the conversation before sending again. ${error.message}` };
      }
    } finally {
      state.editCommit = false;
      this.scheduleRetry(id, { id: state.lastTurnId, status: state.turnStatus });
    }
  }
  async stop(id, expectedTurnId) {
    this.requireReady();
    if (this.state(id).editCommit) throw new Error("Wait for the edit to finish before stopping.");
    // Task controls carry the observed turn: a late click cannot stop newer work.
    if (expectedTurnId !== undefined) {
      if (typeof expectedTurnId !== "string" || !expectedTurnId) throw new Error("Choose the current execution turn.");
      if (!await this.attach(id)) await this.refreshTurn(id);
      if (this.state(id).activeTurnId !== expectedTurnId) throw new Error("This execution changed. Refresh before stopping.");
      const retry = this.state(id).retry || this.state(id).autoStarting;
      if (retry) { retry.stopRequested = true; retry.interruptRequested = true; }
      this.saveRecovery(id, { stopped: true }); this.cancelRetry(id);
      this.state(id).turnStateKnown = false;
      await this.client.call("turn/interrupt", { threadId: id, turnId: expectedTurnId });
      return { status: "interruptRequested", turnId: expectedTurnId };
    }
    const retry = this.state(id).retry || this.state(id).autoStarting;
    if (retry) retry.stopRequested = true;
    this.saveRecovery(id, { stopped: true });
    this.cancelRetry(id); if (!await this.attach(id)) await this.refreshTurn(id);
    const turnId = this.state(id).activeTurnId;
    if (!turnId) return { status: "idle" };
    if (retry) retry.interruptRequested = true;
    this.state(id).turnStateKnown = false;
    await this.client.call("turn/interrupt", { threadId: id, turnId });
    return { status: "interruptRequested", turnId };
  }
  async compact(id) {
    this.requireReady();
    if (this.state(id).editCommit || this.state(id).editUncertain) throw new Error("Finish or reconcile the edit before compacting."); if (!await this.attach(id)) await this.refreshTurn(id);
    if (this.state(id).activeTurnId) throw new Error("Wait for the current task to finish before compacting");
    this.cancelRetry(id);
    this.state(id).turnStateKnown = false;
    await this.client.call("thread/compact/start", { threadId: id });
    return { status: "compactionRequested" };
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
