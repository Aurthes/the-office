"use strict";
const crypto = require("node:crypto");
const { ACCESS } = require("./codex-office-store");
const { version, conversations } = require("./codex-conversations");
const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const error = (message, code = "SESSION_REFRESH_INVALID") => Object.assign(new Error(message), { code });
const identity = (value, name) => { if (typeof value !== "string" || !value || value.length > 100 || ["__proto__", "prototype", "constructor"].includes(value)) throw error(`A stable ${name} is required`); return value; };
const terminal = status => ["completed", "failed", "interrupted"].includes(status);
class CodexSessionRefresh {
  constructor({ store, native, controls, states, facts, context, changed = () => {}, committed = () => {}, now = Date.now }) {
    Object.assign(this, { store, native, controls, states, facts, context, changed, committed, now });
    this.fences = new Map(); this.inflight = new Map();
    for (const row of store.data.sessions) for (const op of Object.values(row.refreshOperations || {})) if (op.status === "preparing") {
      // The mapping and completed receipt commit together. Never resume a
      // candidate creation or replay a business input after a process restart.
      Object.assign(op, { status: "uncertain", finishedAt: now(), oldConversationUsable: row.codexThreadId === op.oldNativeThreadId,
        reason: "Office restarted during preparation. Inspect this operation; no refresh or message was replayed." });
      store.save({ durable: true });
    }
  }
  held(id) { return this.fences.has(id); }
  inputBoundary(id) { return { version: version(this.store.get(id)), stop: this.controls.state(id).inputStopVersion || 0, generation: this.native.scopeGeneration }; }
  assertInputBoundary(id, boundary) {
    const current = this.inputBoundary(id);
    if (current.stop !== boundary.stop) throw error("Stop cancelled this pending input. Nothing was sent; keep your draft.", "SESSION_REFRESH_CANCELLED");
    if (current.version !== boundary.version || current.generation !== boundary.generation) throw error("Conversation changed before input admission. Nothing was sent; keep your draft.", "SESSION_VERSION_CHANGED");
  }
  workChanged(taskId, row) { for (const fence of this.fences.values()) if (fence.taskIds.has(taskId) || this.context.taskRelated?.(row, fence.employeeId)) fence.cancelled = true; }
  assertAvailable(id) { if (this.held(id)) throw error("Session refresh is preparing. Nothing was sent; keep your draft.", "SESSION_REFRESHING"); }
  cancel(id) {
    const fence = this.fences.get(id); if (fence) { fence.cancelled = true; fence.stopped = true; const op = this.store.get(id).refreshOperations?.[fence.id]; if (op) { op.triggerCancelled = true; this.store.save({ durable: true }); } }
    const row = this.store.get(id), lease = row.refreshNextRequest;
    if (lease) {
      row.refreshNextRequest = null;
      const op = row.refreshOperations?.[lease.operationId]; if (op) op.triggerCancelled = true;
      this.store.save({ durable: true });
    }
  }
  sendAllowed(id, requestId) {
    if (this.held(id)) return false;
    const lease = this.store.get(id).refreshNextRequest;
    return !lease || requestId === (lease.dispatchRequestId || lease.id);
  }
  claimTrigger(id, originalId, dispatchId) {
    const row = this.store.get(id), lease = row.refreshNextRequest;
    if (lease?.id !== originalId) return;
    if (lease.dispatchRequestId && lease.dispatchRequestId !== dispatchId) throw error("The exact new-topic input already has a dispatch receipt; it must not be replayed.");
    row.refreshNextRequest = { ...lease, dispatchRequestId: dispatchId }; this.store.save({ durable: true });
  }
  settleTrigger(id, requestId) {
    const row = this.store.get(id), lease = row.refreshNextRequest;
    if (lease && (lease.dispatchRequestId || lease.id) === requestId) { row.refreshNextRequest = null; this.store.save({ durable: true }); }
  }
  snapshot(id) {
    const row = this.store.get(id), state = this.controls.state(id);
    const saved = this.states.read(id);
    if (row.codexThreadId && this.store.data.sessions.filter(other => conversations(other).some(entry => entry.nativeThreadId === row.codexThreadId)).length !== 1) throw error("Current native conversation ownership is ambiguous");
    const company = this.store.companyContext?.(id);
    if (!company || typeof company !== "object" || company.unavailable) throw error("Current role/organization could not be verified");
    return { company, taskContext: this.store.todoContext?.(id), settings: { ...row.settings }, folders: this.store.sessionFolders(row), workspace: row.workspace, lastTurnId: state.lastTurnId, turnVersion: state.turnVersion, stateFingerprint: digest(saved), nativeThreadId: row.codexThreadId || null, version: version(row), stateRevision: saved.revision,
      stopVersion: state.inputStopVersion || 0, generation: this.native.scopeGeneration,
      configuration: digest({ settings: row.settings, name: row.name, projectId: row.projectId, workspace: row.workspace,
        folders: this.store.sessionFolders(row), company }), saved };
  }
  checkpoint(p) {
    const row = this.store.get(p.threadId); this.assertAvailable(row.id);
    if (row.refreshNextRequest) throw error("The previous exact next-topic input is still reserved. Inspect its receipt or use Stop first.");
    identity(p.requestId, "checkpoint request ID");
    const snap = this.snapshot(row.id), state = this.controls.state(row.id);
    if (p.expectedVersion !== snap.version || p.stateRevision !== snap.stateRevision) throw error("Conversation or State revision changed. Review it before checkpointing.");
    if (!snap.nativeThreadId || !p.turnId || p.turnId !== (state.activeTurnId || state.lastTurnId || row.lastTurnId)) throw error("Checkpoint must identify this conversation's actual latest turn.");
    if (!snap.stateRevision || !Object.values(snap.saved.sections).some(text => text.trim())) throw error("Save a nonempty Agent State before checkpointing.");
    if (p.stateVerified !== true || p.noUntrackedWork !== true || p.noPendingReports !== true) throw error("Explicitly verify this State revision and declare no unrecorded work or pending reports.");
    if (!p.closedScope || typeof p.closedScope !== "object" || !["conversation", "task"].includes(p.closedScope.kind)) throw error("Declare the scope concluded at this checkpoint.");
    const scope = p.closedScope.kind === "conversation" ? { kind: "conversation", turnId: p.turnId }
      : { kind: "task", taskId: identity(p.closedScope.taskId, "closed task ID"), ...(p.closedScope.phaseId ? { phaseId: identity(p.closedScope.phaseId, "closed phase ID") } : {}) };
    const value = { id: p.requestId, nativeThreadId: snap.nativeThreadId, version: snap.version, stateRevision: snap.stateRevision,
      turnId: p.turnId, closedScope: scope, stateFingerprint: snap.stateFingerprint, configuration: snap.configuration, declared: { stateVerified: true, noUntrackedWork: true, noPendingReports: true }, createdAt: this.now() };
    const previous = row.refreshCheckpoint;
    if (previous?.id === value.id) { if (digest({ ...previous, createdAt: 0 }) !== digest({ ...value, createdAt: 0 })) throw error("Checkpoint request ID conflict"); return previous; }
    row.refreshCheckpoint = value;
    try { this.store.save({ durable: true }); } catch (failure) { row.refreshCheckpoint = previous; throw failure; }
    return value;
  }
  async blockers(id, trigger, fresh = false) {
    const row = this.store.get(id), reasons = [];
    if (!this.native.ready) reasons.push("Native backend is not ready");
    if (fresh && row.codexThreadId) {
      try { await this.controls.attach(id); await this.controls.refreshTurn(id); }
      catch { reasons.push("Current native execution could not be verified"); }
    }
    const s = this.controls.state(id);
    if (!s.turnStateKnown && row.codexThreadId || s.activeTurnId || s.turnStatus && !terminal(s.turnStatus)) reasons.push("Current execution is active or unconfirmed");
    if (s.pendingSends || s.startDispatch || s.retry || s.autoStarting || s.editCommit || s.editUncertain || this.store.starting.has(id) || this.store.inflight.has(id)) reasons.push("A send, retry, edit or native startup is in flight");
    if (this.store.mutableOperations?.get(id)?.size) reasons.push("A settings or conversation mutation is in flight");
    if (this.controls.approvalCount(id) || this.controls.questions(id).some(q => !q.submitted) || this.store.pendingQuestions(id).length) reasons.push("An approval or question is unresolved");
    try {
      const saved = this.states.read(id);
      if (!saved.revision || !Object.values(saved.sections).some(text => text.trim())) reasons.push("Save and review a nonempty Agent State first");
    } catch { reasons.push("Agent State is unavailable or invalid"); }
    try { reasons.push(...this.facts(id, trigger)); } catch { reasons.push("Refresh safety facts are unavailable"); }
    return [...new Set(reasons)];
  }
  async status(id, requestId) {
    const row = this.store.get(id);
    return { threadId: id, conversationVersion: version(row), nativeThreadId: row.codexThreadId || null,
      stateRevision: this.states.context(id).revision ?? null, lastTurnId: this.controls.state(id).lastTurnId || row.lastTurnId || null,
      checkpoint: row.refreshCheckpoint || null, operation: requestId ? row.refreshOperations?.[requestId] || null : Object.values(row.refreshOperations || {}).at(-1) || null,
      preparing: this.held(id), nextRequest: row.refreshNextRequest || null, blockers: await this.blockers(id, null, !this.held(id)),
      conversations: conversations(row).map(({ turnIds, ...entry }) => ({ ...entry, turnCount: turnIds?.length ?? null })) };
  }
  put(row, op) {
    const before = row.refreshOperations;
    row.refreshOperations = { ...before, [op.id]: op };
    const settled = Object.values(row.refreshOperations).filter(entry => !["preparing", "uncertain"].includes(entry.status));
    for (const old of settled.slice(0, -64)) delete row.refreshOperations[old.id];
    try { this.store.save({ durable: true }); } catch (failure) { row.refreshOperations = before; throw failure; }
    try { this.changed(row.id, op); } catch { /* UI notifications are not the transaction. */ }
    return op;
  }
  async refresh(p) {
    const row = this.store.get(p.threadId), id = identity(p.requestId, "refresh request ID");
    if (!["manual", "automatic"].includes(p.mode) || !Number.isSafeInteger(p.expectedVersion) || p.expectedVersion < 1 || p.expectedVersion >= Number.MAX_SAFE_INTEGER || !Number.isSafeInteger(p.stateRevision) || p.stateRevision < 0) throw error("Choose refresh mode and the reviewed conversation/State versions.");
    // Receipt identity is the operation's semantics, independent of JSON key
    // order, actor defaults or transport-specific optional fields.
    const hash = digest([p.mode, p.expectedVersion, p.stateRevision, p.stateVerified === true, p.noUntrackedWork === true, p.noPendingReports === true,
      p.mode === "automatic" ? [p.checkpointId, p.independentNewTopic === true, p.triggerRequestId, p.triggerHash ?? null, p.nextScope?.taskId ?? null, p.nextScope?.phaseId ?? null] : null]);
    const previous = row.refreshOperations?.[id];
    const running = this.inflight.get(`${row.id}:${id}`);
    if (running) { if (this.fences.get(row.id)?.hash !== hash) throw error("Refresh request ID conflicts with its original operation"); return running; }
    if (previous) {
      if (previous.hash !== hash) throw error("Refresh request ID conflicts with its original operation");
      return this.inflight.get(`${row.id}:${id}`) || Promise.resolve(previous);
    }
    if (row.refreshNextRequest) return Promise.resolve({ id, status: "blocked", reasons: ["The exact new-topic input is still reserved. Inspect its receipt or use Stop to cancel the reservation."] });
    if (this.held(row.id)) return Promise.resolve({ id, status: "blocked", reasons: ["Another refresh is preparing; inspect that operation before retrying."] });
    const fence = { id, hash, employeeId: row.id, taskIds: new Set(this.context.taskIds?.(row.id) || []), cancelled: false }; this.fences.set(row.id, fence);
    const promise = this.run(row, p, hash, fence).finally(() => {
      if (this.fences.get(row.id) === fence) this.fences.delete(row.id);
      this.inflight.delete(`${row.id}:${id}`);
      try { this.changed(row.id, row.refreshOperations?.[id]); } catch { /* A later status read is authoritative. */ }
    });
    this.inflight.set(`${row.id}:${id}`, promise); return promise;
  }
  async run(row, p, hash, fence) {
    const op = { id: p.requestId, hash, mode: p.mode, status: "preparing", startedAt: this.now(), oldNativeThreadId: row.codexThreadId || null, oldVersion: version(row) };
    let committed = false;
    try {
      if (!row.codexThreadId) return this.put(row, { ...op, status: "completed", noChange: true, finishedAt: this.now(), conversationVersion: version(row) });
      const trigger = p.mode === "automatic" ? { requestId: p.triggerRequestId, sourceHash: p.triggerHash, nextScope: p.nextScope } : null;
      const reasons = await this.blockers(row.id, trigger, true);
      const snap = this.snapshot(row.id);
      if (snap.version !== p.expectedVersion || snap.stateRevision !== p.stateRevision) reasons.push("Reviewed State or conversation version changed");
      const cp = row.refreshCheckpoint;
      if (p.mode === "automatic") {
        if (p.independentNewTopic !== true || typeof p.triggerRequestId !== "string" || !p.triggerRequestId || !cp || p.checkpointId !== cp.id
          || cp.version !== snap.version || cp.nativeThreadId !== snap.nativeThreadId || cp.stateRevision !== snap.stateRevision || cp.invalidated || cp.stateFingerprint !== snap.stateFingerprint || cp.configuration !== snap.configuration
          || cp.turnId !== this.controls.state(row.id).lastTurnId || this.controls.state(row.id).turnStatus !== "completed") reasons.push("Automatic refresh needs a current explicit checkpoint and one exact independent-new-topic request");
        if (cp?.consumedBy && cp.consumedBy !== p.triggerRequestId) reasons.push("This checkpoint was already consumed by another request");
      } else if (p.stateVerified !== true || p.noUntrackedWork !== true || p.noPendingReports !== true) reasons.push("Verify the current State and explicitly declare no unrecorded work or pending reports");
      if (fence.cancelled) throw error("Refresh was cancelled before preparation; the original conversation remains current.", "SESSION_REFRESH_CANCELLED");
      if (reasons.length) return this.put(row, { ...op, status: "blocked", reasons: [...new Set(reasons)], finishedAt: this.now(), oldConversationUsable: true });
      const packet = this.context.packet(row, snap.saved, snap.company, snap.taskContext);
      op.phase = "indexing"; this.put(row, op);
      const guard = () => {
        const now = this.snapshot(row.id);
        if (fence.cancelled || this.fences.get(row.id) !== fence || now.nativeThreadId !== snap.nativeThreadId || now.version !== snap.version
          || now.lastTurnId !== snap.lastTurnId || now.turnVersion !== snap.turnVersion || now.stateRevision !== snap.stateRevision || now.stateFingerprint !== snap.stateFingerprint || now.stopVersion !== snap.stopVersion || now.generation !== snap.generation || now.configuration !== snap.configuration) throw error("Refresh boundary changed; the original conversation remains current.", "SESSION_REFRESH_CANCELLED");
      };
      const turnIds = []; let cursor;
      do {
        const page = await this.native.call("thread/turns/list", { threadId: snap.nativeThreadId, limit: 100, itemsView: "notLoaded", sortDirection: "asc", ...(cursor ? { cursor } : {}) });
        guard();
        if (!Array.isArray(page.data) || page.data.some(turn => typeof turn.id !== "string" || turn.status === "inProgress")) throw error("Old history is incomplete or execution changed");
        turnIds.push(...page.data.map(turn => turn.id));
        if (turnIds.length > 200000 || page.nextCursor && page.nextCursor === cursor) throw error("Old history exceeds the verified refresh index bound; no history was discarded");
        cursor = page.nextCursor;
      } while (cursor);
      if (!turnIds.length) return this.put(row, { ...op, status: "completed", noChange: true, finishedAt: this.now(), conversationVersion: snap.version });
      const effective = await this.native.call("thread/resume", { threadId: snap.nativeThreadId, excludeTurns: true }); guard();
      if (typeof effective.model !== "string" || !effective.model || typeof effective.modelProvider !== "string" || !effective.modelProvider
        || !(effective.reasoningEffort === null || typeof effective.reasoningEffort === "string")) throw error("Actual model/provider/effort could not be verified; no defaults were guessed");
      const access = ACCESS[snap.settings.accessMode];
      op.phase = "creating"; this.put(row, op);
      const created = await this.native.call("thread/start", { cwd: snap.workspace, sandbox: access.sandbox, approvalPolicy: access.approvalPolicy,
        model: effective.model, modelProvider: effective.modelProvider,
        config: { ...(effective.reasoningEffort === null ? {} : { model_reasoning_effort: effective.reasoningEffort }),
          ...(access.policy === "workspaceWrite" ? { sandbox_workspace_write: { writable_roots: snap.folders, network_access: false } } : {}) }, dynamicTools: this.context.tools });
      if (typeof created.thread?.id !== "string" || !created.thread.id || this.store.data.sessions.some(other => conversations(other).some(c => c.nativeThreadId === created.thread.id))) throw error("Candidate native identity is not a new, unowned conversation");
      op.candidateNativeThreadId = created.thread.id; op.phase = "candidateReady"; this.put(row, op); guard();
      if (created.model !== effective.model || created.modelProvider !== effective.modelProvider || created.reasoningEffort !== effective.reasoningEffort) throw error("Candidate model/provider/effort differ from the current conversation");
      await this.native.call("thread/inject_items", { threadId: created.thread.id, items: packet.items }); guard();
      const empty = await this.native.call("thread/turns/list", { threadId: created.thread.id, limit: 1, itemsView: "notLoaded" }); guard();
      if (!Array.isArray(empty.data) || empty.data.length || empty.nextCursor) throw error("Candidate is not a clean conversation");
      const final = await this.blockers(row.id, trigger); guard();
      if (final.length) throw error(final.join("; "), "SESSION_REFRESH_CANCELLED");
      const before = { ...row };
      const epoch = crypto.randomUUID(), nextVersion = snap.version + 1;
      const done = { ...op, status: "completed", finishedAt: this.now(), conversationVersion: nextVersion, nativeThreadId: created.thread.id, historyEpoch: epoch, oldConversationUsable: false, oldHistoryReadable: true };
      Object.assign(row, { codexThreadId: created.thread.id, conversationVersion: nextVersion, historyEpoch: epoch,
        previousConversations: [...(row.previousConversations || []), { version: snap.version, nativeThreadId: snap.nativeThreadId, historyEpoch: row.historyEpoch || "0", retiredAt: this.now(), turnIds: [...new Set(turnIds)] }],
        recovery: { ...row.recovery, attempts: 0, modelIssue: null }, hasTurns: false, attemptedTurn: false, status: "idle", turnStatus: null, lastTurnId: null, completionKey: null, pendingQuestions: [],
        projectContext: null, questionContextHash: null, contextThreadId: null, questionConversationVersion: snap.version,
        refreshCheckpoint: cp ? { ...cp, ...(p.mode === "automatic" ? { consumedBy: p.triggerRequestId } : { invalidated: true }) } : null,
        refreshNextRequest: p.mode === "automatic" ? { id: p.triggerRequestId, operationId: op.id, version: nextVersion } : null,
        refreshOperations: { ...row.refreshOperations, [op.id]: done } });
      try { this.store.save({ durable: true }); committed = true; }
      catch (failure) { for (const key of Object.keys(row)) delete row[key]; Object.assign(row, before); throw failure; }
      this.committed(row.id, epoch, nextVersion); this.changed(row.id, done); return done;
    } catch (failure) {
      if (committed) return row.refreshOperations[op.id];
      if (fence.stopped) op.triggerCancelled = true;
      const unknown = op.phase === "creating" && !op.candidateNativeThreadId && failure.code === undefined;
      return this.put(row, { ...op, status: unknown ? "uncertain" : "failed", finishedAt: this.now(), reason: "Refresh did not commit. The original conversation remains available. " + String(failure.message).slice(0, 800), oldConversationUsable: row.codexThreadId === op.oldNativeThreadId });
    }
  }
}
module.exports = { CodexSessionRefresh };
