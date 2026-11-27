"use strict";
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");
const { BackendReservation, backendBlockers, reserveBackend, verifyBackend } = require("./codex-backend-state");
const { OfficeNotifications } = require("./office-notifications");
const { HEADER: PUSH_IDENTITY_HEADER } = require("./office-push-identity");
const { isDepartmentManager } = require("../src/lib/office/organization-structure");
const { CodexOfficeClient, officeEnvironment } = require("./codex-office-client");
const { CodexOfficeAccount } = require("./codex-office-account");
const { CodexOfficeStore } = require("./codex-office-store");
const { CodexSessionRefresh } = require("./codex-session-refresh");
const { refreshFacts } = require("./codex-session-refresh-facts");
const { refreshIntent } = require("./codex-refresh-intent");
const { version: conversationVersion } = require("./codex-conversations");
const { OFFICE_CHAT_TOOLS } = require("./codex-session-composer");
const { AgentStates } = require("./agent-state");
const { CodexSessionControls } = require("./codex-session-controls");
const { CodexSessionStream } = require("./codex-session-stream");
const { CodexSessionWorkspace } = require("./codex-session-workspace");
const { CodexOfficeVoice } = require("./codex-office-voice");
const { loadConversationHistoryPage } = require("./codex-session-history");
const { createOfficeDictation } = require("./office-model-services");
const { createOfficeVoicePreviews } = require("./office-voice-previews");
const { CodexSessionPredictions } = require("./codex-session-predictions");
const { readAiCenter } = require("./ai-center");
const { OfficeTokenUsage, userUsage } = require("./office-token-usage");
const { consumeOpenAiResetCredit } = require("./ai-center-openai");
const { questionReplyMessage } = require("./codex-session-questions");
const { OfficeTodos, activeDelegation, handlingAgentId, isPhaseTask, isTaskMetadataEdit } = require("./office-todos");
const { OfficeSchedules } = require("./office-schedules");
const { CodexSessionComposer } = require("./codex-session-composer");
const { CodexMessageSearch } = require("./codex-message-search");
const { OfficeCompany, WORKFLOW, TASK_WORKFLOW } = require("./office-company");
const { OfficeDelegation, taskNotification, directMessage } = require("./office-delegation");
const { OfficeReplyContext, taskReplyContext, sourceOf } = require("./office-reply-context");

const token = process.env.CLAW3D_GATEWAY_TOKEN;
if (!token) throw new Error("CLAW3D_GATEWAY_TOKEN is required");
const { OfficeDelivery } = require("./office-delivery");
const { OfficeUserSends } = require("./office-user-sends");
const { resendUserInput } = require("./office-user-send-recovery");
const directory = officeEnvironment(path.resolve(process.env.CLAW3D_OFFICE_DATA_DIR || path.join(process.env.CLAW3D_DATA_DIR || path.join(os.homedir(), ".local/share/claw3d"), "office-runtime"))).home;
const replyContext = new OfficeReplyContext(directory);
const clients = new Set(); let seq = 0, rosterTimer, stopping = false, controls, stream, store, workspace, voice, login, schedules, composer, todos, dictate, delegation, tokenUsage, delivery, refresh;
let restoredSessionStates = Promise.resolve();
const userSends = new OfficeUserSends(directory, { generation: () => native.scopeGeneration, changed: id => {
  if (!controls || !id) return;
  const state = controls.state(id); state.version++;
  if (userSends.blocked(id)) controls.cancelRetry(id);
  else { if (state.turnStateKnown && !state.activeTurnId) controls.scheduleRetry(id, { id: state.lastTurnId, status: state.turnStatus }); setImmediate(() => delivery?.notify(id)); }
  stream?.changed(id); changed();
} });
const reservation = new BackendReservation(directory, () => backendBlockers({ native,store,controls,voice,workspace,delivery,delegation,stopping }));
const features = { dictation: false, dictationHTTP: true, voice: true, prediction: false, terminal: true, schedules: true, todos: true, composer: true, accountVersion: 0 };
const broadcast = (event, payload) => { const frame = JSON.stringify({ type: "event", event, seq: seq++, payload }); for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(frame); };
function changed() { if (!rosterTimer) rosterTimer = setTimeout(() => { rosterTimer = null; broadcast("roster.updated", { ts: Date.now() }); }, 150); }
const native = new CodexOfficeClient({
  onScopeMetadata: value => tokenUsage?.observeScope(value),
  onNativeRetry: value => { const id = controls?.nativeRetry(value); if (id) stream?.changed(id); },
  onScopeGap: reason => tokenUsage?.scopeGap(reason),
  additionalInstructions: WORKFLOW + "\n" + TASK_WORKFLOW,
  env: { ...process.env, OFFICE_TASK_GATEWAY_URL: `ws://127.0.0.1:${process.env.CODEX_ADAPTER_PORT || 18790}`, OFFICE_TASK_GATEWAY_TOKEN: token },
  configOverrides: [
    `mcp_servers.office_tasks.command=${JSON.stringify(process.execPath)}`,
    `mcp_servers.office_tasks.args=${JSON.stringify([path.join(__dirname, "office-todo-mcp.js")])}`,
    'mcp_servers.office_tasks.env_vars=["OFFICE_TASK_GATEWAY_URL","OFFICE_TASK_GATEWAY_TOKEN"]',
    'mcp_servers.office_tasks.enabled=true',
    'mcp_servers.office_tasks.default_tools_approval_mode="auto"',
  ], home: process.env.CLAW3D_OFFICE_CODEX_HOME || path.join(directory, "codex"), onFrame(frame) {
  if (frame.method === "connection/closed") { if (!stopping) { console.error("Office Codex exited"); void close(1); } return; }
  if (["account/login/completed", "account/updated"].includes(frame.method)) accountContext.invalidate();
  if (frame.method === "account/login/completed") { login = null; features.accountVersion++; store.defaultModel = null; for (const state of controls.states.values()) state.version++; stream.refresh(); broadcast("office.account", { changed: true, success: frame.params.success, error: frame.params.error }); }
  if (["account/login/completed", "account/updated"].includes(frame.method)) dictate?.refresh({ reset: true });
  workspace?.handle(frame);
  if (["account/login/completed", "account/updated", "process/exited", "thread/realtime/closed"].includes(frame.method)) setImmediate(() => void delivery?.flush());
  if (composer?.handleToolCall(frame)) return;
  tokenUsage?.observeNative(frame, native.scopeGeneration);
  if (["thread/tokenUsage/updated", "turn/started", "turn/completed"].includes(frame.method)) tokenUsage?.hint(frame.params?.threadId);
  const mapped = store?.handle(frame); if (!mapped) return;
  voice?.handle(mapped);
  controls?.handle(mapped); if (mapped.params?.threadId) stream?.changed(mapped.params.threadId);
  schedules?.handle(mapped);
  if (mapped.method === "turn/completed") {
    todos?.finishTurn(mapped.params.threadId, mapped.params.turn?.status || "completed", mapped.params.turn?.id);
    setImmediate(() => void delegation?.flush());
  }
  if (mapped.id !== undefined || ["serverRequest/resolved", "turn/completed"].includes(mapped.method)) { changed(); setImmediate(() => void delivery?.flush()); }
} });
native.reservation = reservation;
const accountContext = new CodexOfficeAccount(native);
store = new CodexOfficeStore(directory, native, changed, id => Boolean(voice?.active?.threadId === id || controls?.state(id).activeTurnId || workspace?.snapshot(id)?.running || workspace?.starts.has(id)));
store.ensureCeo();
tokenUsage = new OfficeTokenUsage({ directory, home: native.home, sessions: () => store.data.sessions,
  tasks: () => todos?.rows || new Map(),
  listSources: p => native.call("thread/list", p),
  nativeVersion: null, runtimePending: true,
  resolveSource: async threadId => (await native.call("thread/read", { threadId, includeTurns: false })).thread?.path,
});
store.onTurnDispatch = value => {
  tokenUsage.bindTurn(value);
  const state = controls?.state(value.agentId);
  todos?.recordTurn(value, state?.lastTurnId === value.turnId ? state : store.get(value.agentId));
};
controls = new CodexSessionControls(store, id => store.pendingQuestions(id), { settings: store, features, replyContext, usageMetadata: true, nativeGeneration: () => native.scopeGeneration, conversationVersion: id => store.conversationVersion(id), userJournal: userSends, nativeThread: id => store.get(id).codexThreadId, reconcileUserSends: id => reconcileUserSends(id),
  changed: id => { stream?.changed(id); changed(); setImmediate(() => delivery?.notify(id)); },
  editBlocked: id => voice?.active?.threadId === id || store.starting.has(id),
  history: {
    read: id => store.get(id).historyEpoch,
    reset: (id, historyEpoch, removedTurnId) => {
      const row = store.get(id);
      if (removedTurnId) row.revertedTurnIds = [...new Set([...(row.revertedTurnIds || []), removedTurnId])].slice(-128);
      row.historyEpoch = historyEpoch; store.save();
      broadcast("session.historyReset", { threadId: id, historyEpoch });
    },
    reverted: id => store.reverted(id),
    refused: (id, turnId) => { const row = store.get(id); row.revertedTurnIds = (row.revertedTurnIds || []).filter(id => id !== turnId); store.save(); },
  },
  recovery: {
    read: id => store.data.sessions.find(row => row.id === id)?.recovery,
    write: (id, recovery) => { const row = store.data.sessions.find(row => row.id === id); if (row) { row.recovery = recovery; store.save(); } },
  },
  canRetry: async id => !userSends.blocked(id) && !reservation.held && !stopping && native.ready && !store.isBusy(id) && !store.starting.has(id)
    && !store.pendingQuestions(id).length && !controls.approvalCount(id) && !controls.questions(id).some(q => !q.submitted)
    && (await account()).loggedIn,
});
stream = new CodexSessionStream(controls);
const predictions = new CodexSessionPredictions(store, controls, { sample: value => tokenUsage.recordSample(value), unavailable: () => tokenUsage.sampleUnavailable() });
workspace = new CodexSessionWorkspace(native, { ended: id => delivery?.notify(id), commandExec: true, policy: id => store.overrides(id).sandboxPolicy, roots: row => store.sessionFolders(row) });
composer = new CodexSessionComposer(store, workspace); controls.options.composer = composer;
const messageSearch = new CodexMessageSearch(store, replyContext);
voice = new CodexOfficeVoice(store, controls, (ws, payload) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "event", event: "session.voice", payload }));
});
const agents = () => {
  const pending = schedules.pendingThreadIds();
  return store.list().map(row => ({ ...row, hasPendingSchedule: pending.has(row.id), status: controls.state(row.id).retry ? "running" : row.status, role: row.project, identity: { name: row.name, emoji: "💬" }, needsInput: Boolean(store.pendingQuestions(row.id).length || controls.questions(row.id).some(q => !q.submitted) || controls.approvalCount(row.id)) }));
};
const key = id => `agent:${id}:main`;
const history = (id, cursor, epoch, selectedVersion) => loadConversationHistoryPage({ store, controls, replyContext, userSends,
  journalUnavailable: () => { controls.state(id).version++; stream.changed(id); } }, id, cursor, epoch, selectedVersion);
async function reconcileUserSends(id) {
  let cursor; const epoch = controls.state(id).historyEpoch;
  for (let page = 0; page < 4 && userSends.blocked(id); page++) {
    const result = await history(id, cursor, epoch);
    if (!result.nextCursor) return { complete: true };
    cursor = result.nextCursor;
  }
  return { complete: false };
}
async function account(options) { const status = await accountContext.read(options); return { loggedIn: Boolean(status.account) || status.requiresOpenaiAuth === false, email: status.account?.email || null, requiresAuth: status.requiresOpenaiAuth !== false, loginFlow: process.env.CLAW3D_OFFICE_DESKTOP === "1" ? "browser" : "device", login }; }
// Preserve existing UI/service callers without actors. Office MCP uses the
// existing explicit actor convention, with no new target or department ACL.
function scheduleInput(p) {
  if (Object.hasOwn(p, "actorId")) {
    if (typeof p.actorId !== "string" || !p.actorId.trim()) throw new Error("Choose an existing Office actor");
    store.get(p.actorId);
  }
  return p;
}
schedules = new OfficeSchedules(directory, {
  getSession: id => store.get(id), dispatchAllowed: id => !refresh?.held(id) && !store.get(id).refreshNextRequest, changed: () => { broadcast("schedules.updated", {}); changed(); },
  canSend: async id => {
    if (refresh?.held(id) || userSends.blocked(id) || reservation.held || !native.ready || store.isBusy(id) || store.starting.has(id) || store.pendingQuestions(id).length) return false;
    await controls.attach(id); await controls.refreshTurn(id);
    if (store.isBusy(id) || controls.approvalCount(id) || controls.questions(id).some(q => !q.submitted)) return false;
    return (await account()).loggedIn;
  },
  send: (id, message, requestId, usage) => controls.send(id, message, requestId, [], { onlyIfIdle: true, usage }),
});
todos = new OfficeTodos(directory, { projects: () => store.projects(), agents, activeTurn: id => { const state = controls.states.get(id); return state?.turnStateKnown && !state.recovery.stopped ? state.activeTurnId : null; }, replyContext: id => controls.state(id).activeTurnId ? replyContext.forTask(id, controls.state(id).activeTurnId) : null, changed: id => { broadcast("todos.updated", { id }); refresh?.workChanged(id, todos?.rows.get(id)); } });
composer.todos = todos;
replyContext.options.task = id => todos.raw(id);
replyContext.options.recent = async id => (await history(id)).messages;
replyContext.options.source = async source => {
  const page = await messageSearch.context(source);
  return sourceOf(source.threadId, page.messages.find(item => item.id === page.messageId));
};
store.questionContext = (id, requestId) => {
  const result = replyContext.forModel(id, requestId), row = store.get(id);
  if (conversationVersion(row) > 1 && row.questionConversationVersion !== conversationVersion(row) && !replyContext.read(id).pending[requestId]?.context) return { ...result, answering: [], context: null };
  return result;
};
const company = new OfficeCompany(store);
store.companyContext = id => company.forTurn(id);
const agentStates = new AgentStates(path.join(directory, "agent-states"), id => store.get(id));
store.agentStateContext = id => agentStates.context(id);
store.initializePosition = (session, title) => company.initializePosition(session, title, async (key, id, position) => {
  // Use the existing settings owner/API, rather than adding a second file writer.
  const response = await fetch(`http://127.0.0.1:${process.env.CLAW3D_STUDIO_PORT || 3033}/api/studio`, {
    method: "PUT", signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/json", ...(process.env.CLAW3D_PROXY_TOKEN ? { "x-office-proxy-token": process.env.CLAW3D_PROXY_TOKEN } : {}) },
    body: JSON.stringify({ office: { [key]: { organization: { [id]: position } } } }),
  });
  if (!response.ok) throw new Error("Could not save the recruitment position; no employee was created");
  const saved = (await response.json()).settings?.office?.[key]?.organization?.[id];
  if (saved?.title !== position.title || JSON.stringify(saved?.reportsTo) !== JSON.stringify(position.reportsTo)) throw new Error("Recruitment position was not confirmed; no employee was created");
});
const notificationSecret = process.env.CLAW3D_PROXY_TOKEN || "";
const notificationOrigins = new Set((process.env.CLAW3D_PUBLIC_ORIGINS || "").split(",").map(s => s.trim()));
const notifications = new OfficeNotifications(directory, {
  actor: id => { const p = company.context(id); return { head: typeof p.title === "string" && isDepartmentManager(p), name: store.get(id).name }; },
  owner: async identity => {
    if (!notificationSecret) throw new Error("Website reminders require the authenticated web entry");
    if (identity && !notificationOrigins.has(identity.origin)) return { valid: false };
    const port = Number(process.env.CLAW3D_ACCESS_PORT || 3035);
    if (identity && identity.port !== port) return { valid: false };
    const response = await fetch(`http://127.0.0.1:${port}/internal/push-identity`, { method: "POST", headers: { "Content-Type": "application/json", "x-office-proxy-token": notificationSecret }, body: JSON.stringify(identity ? { owner: identity.owner, device: identity.device } : {}), signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error("Website notification identity is unavailable");
    const value = await response.json();
    if (!/^[a-f0-9]{64}$/.test(value.owner) || typeof value.valid !== "boolean") throw new Error("Website notification identity is unavailable");
    return value;
  }, changed: () => broadcast("notifications.updated", {}),
});
const browserIdentity = ws => notifications.identity(ws.pushIdentity, notificationSecret);

store.todoContext = id => ({ ...todos.context(id), communication: delivery?.summary(id), departmentId: store.get(id).projectId ?? null });
delegation = new OfficeDelegation({ store, todos, company, stopping: () => stopping || reservation.held,
  canRecall: async id => {
    if (store.data.sessions.find(row => row.id === id)?.archived) return true;
    await controls.attach(id); await controls.refreshTurn(id);
    return !store.isBusy(id) && !store.starting.has(id) && !controls.state(id).retry;
  },
  canSend: async id => {
    if (refresh?.held(id) || userSends.blocked(id) || reservation.held || stopping || !native.ready || store.isBusy(id) || store.starting.has(id)) return false;
    await controls.attach(id); await controls.refreshTurn(id);
    return !store.isBusy(id) && !store.starting.has(id) && !controls.state(id).retry && !controls.state(id).recovery.stopped
      && !store.pendingQuestions(id).length && !controls.approvalCount(id) && !controls.questions(id).some(q => !q.submitted) && (await account()).loggedIn;
  },
  send: (id, message, requestId, context, usage) => controls.send(id, message, requestId, [], { onlyIfIdle: true, replyContext: context, usage }),
});
controls.options.idleDispatchAllowed = id => !userSends.blocked(id) && !reservation.held && !stopping && !store.isBusy(id) && !store.starting.has(id)
  && voice.active?.threadId !== id && !workspace.snapshot(id)?.running
  && !store.pendingQuestions(id).length && !controls.approvalCount(id) && !controls.questions(id).some(q => !q.submitted);
delivery = new OfficeDelivery({ directory,
  sources: () => delegation.deliverySources(),
  update: (member, state, error) => todos.delivery(member.taskId, member.id, state, error),
  stopping: () => stopping || reservation.held,
  canSend: id => delegation.canSend(id),
  send: (id, message, requestId, context, urgent) => controls.send(id, message, requestId, [], {
    onlyIfIdle: !urgent, replyContext: context,
    usage: { purpose: "collaboration_mixed", trigger: "agentMessage", deliveryId: requestId },
  }),
  receipt: async (id, requestId) => {
    const previous = controls.sends.get(requestId)?.result;
    if (previous) return previous;
    const user = [...controls.state(id).items.values()].find(item => item.role === "user" && item.clientId === requestId);
    return user?.turnId ? { status: "accepted", turnId: user.turnId } : null;
  },
  changed: id => broadcast("office.delivery", { recipientId: id }),
});
delegation.deliveryCoordinator = delivery;
refresh = new CodexSessionRefresh({ store, native, controls, states: agentStates,
  facts: (id, trigger, mode) => refreshFacts({ store, controls, userSends, delivery, delegation, schedules, voice, workspace, todos, reservation, stopping: () => stopping }, id, trigger, mode),
  context: { tools: OFFICE_CHAT_TOOLS,
    taskRelated: (row, id) => Boolean(row && (row.ownerId === id || row.assigneeId === id || row.phases.some(p => p.assigneeId === id || p.acceptanceManagerId === id) || (row.delegations || []).some(h => h.managerId === id || h.workerId === id))),
    taskIds: id => [...todos.rows.values()].filter(row => row.ownerId === id || row.assigneeId === id || row.phases.some(p => p.assigneeId === id || p.acceptanceManagerId === id) || (row.delegations || []).some(h => h.managerId === id || h.workerId === id)).map(row => row.id),
    packet: (row, saved, company, tasks) => store.contextPacket(row, {
    tasks, company, agentState: { status: "available", ...saved }, questionContext: { answering: [], context: null, knownQuestions: [] },
  }) },
  committed: (id, epoch) => { controls.refreshed(id, epoch); predictions.cache.delete(id); broadcast("session.historyReset", { threadId: id, historyEpoch: epoch }); stream.changed(id); },
  changed: (id, operation) => { broadcast("session.refresh", { threadId: id, operation }); changed(); setImmediate(() => delivery.notify(id)); },
});
store.refreshFence = id => refresh.held(id);
controls.options.refreshBlocked = (id, requestId) => refresh.sendAllowed(id, requestId) ? false : refresh.held(id)
  ? "Session refresh is preparing. Nothing was sent; keep your draft." : "The exact next-topic message is reserved. Check refresh status or use Stop before sending another message.";
controls.options.assertRefreshAvailable = id => refresh.assertAvailable(id);
controls.options.cancelRefresh = id => refresh.cancel(id);
controls.options.refreshSettled = (id, requestId) => refresh.settleTrigger(id, requestId);
workspace.options.assertAvailable = id => refresh.assertAvailable(id);
const automaticRefresh = async (id, intent, requestId, sourceHash, queued = false) => {
  intent = refreshIntent(intent); if (!intent) return null;
  const row = store.get(id), cp = row.refreshCheckpoint;
  if (!cp || cp.id !== intent.checkpointId) { if (!queued) throw Object.assign(new Error("This new-topic checkpoint is no longer current. Nothing was sent; review State and keep your draft."), { code: "SESSION_REFRESH_INVALID" }); return { status: "skipped", reason: "No matching explicit checkpoint; current conversation kept." }; }
  const operationId = "auto-" + crypto.createHash("sha256").update(id + ":" + requestId).digest("hex").slice(0, 48);
  const previous = row.refreshOperations?.[operationId];
  if (previous?.triggerCancelled) return { status: "skipped", reason: "This checkpoint intent was cancelled by Stop; current conversation kept." };
  const result = await refresh.refresh({ threadId: id, requestId: operationId, mode: "automatic", expectedVersion: cp.version, stateRevision: cp.stateRevision,
    checkpointId: cp.id, independentNewTopic: true, triggerRequestId: requestId, triggerHash: sourceHash, ...(intent.nextScope ? { nextScope: intent.nextScope } : {}) });
  if (result.triggerCancelled) throw Object.assign(new Error("Stop cancelled this pending new-topic request. Nothing was sent; keep your draft."), { code: "SESSION_REFRESH_CANCELLED" });
  return result;
};
delivery.dispatchAllowed = (id, originalId) => !refresh.held(id) && (originalId === undefined || !store.get(id).refreshNextRequest || store.get(id).refreshNextRequest.id === originalId && !store.get(id).refreshNextRequest.dispatchRequestId);
delivery.beforeRefreshDispatch = (id, source) => automaticRefresh(id, source.refreshIntent, source.id, source.hash, true);
delivery.claimRefreshTrigger = (id, originalId, dispatchId) => refresh.claimTrigger(id, originalId, dispatchId);
delivery.settleRefreshTrigger = (id, requestId) => refresh.settleTrigger(id, requestId);

const methods = {
  "session.refresh.status": p => refresh.status(p.threadId || p.actorId, p.requestId),
  "session.refresh.checkpoint": p => refresh.checkpoint({ ...p, threadId: p.threadId || p.actorId }),
  "session.refresh": p => { if (p.mode && p.mode !== "manual") throw new Error("Automatic refresh is bound internally to one actual send request"); return refresh.refresh({ ...p, mode: "manual", threadId: p.threadId || p.actorId }); },
  "agent.state.get": p => { store.get(p.actorId); return agentStates.read(p.agentId ?? p.actorId); },
  "agent.state.save": p => agentStates.save(p.actorId, { sections: p.sections, revision: p.revision }),
  "question.context": async p => {
    const row = store.get(p.actorId), selected = Boolean(p.answering || p.questions?.length);
    const result = await replyContext.context(p.actorId, p);
    if (selected) { row.questionConversationVersion = conversationVersion(row); store.save(); }
    return !selected && conversationVersion(row) > 1 && row.questionConversationVersion !== conversationVersion(row) ? { ...result, answering: [], context: null } : result;
  },
  "todo.organization": p => company.context(p.actorId, p),
  "todo.department_assets": p => company.departmentAssets(p),
  "todo.recruit": p => company.recruit(p),
  "todo.delegate": p => delegation.delegate(p),
  "todo.submit": p => delegation.submit(p),
  "todo.review": p => delegation.review(p),
  "todo.recall": p => delegation.recall(p),
  "todo.list": p => todos.list(p),
  "todo.get": p => todos.get(p),
  "todo.create": p => {
    const result = todos.create(p), turnId = p.actorId && controls.state(p.actorId).activeTurnId;
    if (turnId) replyContext.bindTask(p.actorId, result.todo, turnId);
    return result;
  },
  ...Object.fromEntries(["edit", "start", "pause", "complete", "reopen", "archive", "restore"].map(action => [`todo.${action}`, p => {
    const result = todos.change(p, action);
    if (p.actorId && result.todo.status === "running" && !(action === "edit" && isTaskMetadataEdit(p)) && (action === "start" || !isPhaseTask(result.todo))) {
      const context = todos.context(p.actorId), turnId = controls.state(p.actorId).activeTurnId;
      if (context.todoId === result.todo.id && (!isPhaseTask(result.todo) || context.runningPhaseId === p.phaseId) && turnId) {
        todos.recordTurn({ agentId: p.actorId, taskId: result.todo.id, phaseId: isPhaseTask(result.todo) ? p.phaseId : undefined, ...context, activityRole: context.activityRole, turnId });
        if (action === "start") replyContext.bindTask(p.actorId, result.todo, turnId, isPhaseTask(result.todo) ? p.phaseId : undefined);
      }
    }
    return result;
  }])),
  "todo.run": p => isPhaseTask(todos.raw(p.id)) ? delegation.run(p) : store.once(p, async () => {
    const row = todos.raw(p.id);
    if (row.revision !== p.revision) throw new Error("This to-do changed. Refresh it before starting");
    const recipient = handlingAgentId(row), entry = activeDelegation(row);
    if (!recipient) throw new Error("Assign an agent before starting work");
    store.get(recipient);
    if (!(await account()).loggedIn) throw new Error("Sign in to Codex for Office before sending");
    await controls.attach(recipient); await controls.refreshTurn(recipient);
    if (store.isBusy(recipient) || store.starting.has(recipient) || store.pendingQuestions(recipient).length || controls.approvalCount(recipient) || controls.questions(recipient).some(q => !q.submitted)) throw new Error("This agent is busy or waiting for input. Open its conversation first");
    if (todos.raw(p.id).revision !== p.revision) throw new Error("This to-do changed. Refresh it before starting");
    const delivery = activeDelegation(row)?.delivery;
    if (delivery?.recipientId === recipient) todos.delivery(row.id, delivery.requestId, "sending");
    todos.startForAgent(recipient, row.id, undefined, p.requestId, true);
    try {
      const result = await controls.send(recipient, taskNotification(todos.raw(row.id), undefined, undefined, todos.actor(p)), p.requestId, [], { onlyIfIdle: true, replyContext: entry?.replyContext || taskReplyContext(row), usage: { senderId: todos.actor(p)?.source === "agent" ? todos.actor(p).id : null, purpose: "collaboration_mixed", trigger: "todoRun", originId: entry?.id || row.id } });
      if (result.status === "busy") throw new Error("Agent became busy; the task was not sent");
      if (delivery?.recipientId === recipient) todos.delivery(row.id, delivery.requestId, "sent");
      return { id: row.id, threadId: recipient };
    } catch (error) { if (delivery?.recipientId === recipient) todos.delivery(row.id, delivery.requestId, "uncertain", error.message); delegation.pauseAttempt(row.id, undefined, recipient, p.requestId, "failed to start"); throw error; }
  }),
  "office.account": account,
  "office.notify": p => notifications.notify(p),
  "office.notifications.settings": async (_p, ws) => notifications.settings(await browserIdentity(ws)),
  "office.notifications.subscribe": async (p, ws) => notifications.subscribe(await browserIdentity(ws), p.subscription),
  "office.notifications.unsubscribe": async (_p, ws) => notifications.unsubscribe(await browserIdentity(ws)),
  "office.notifications.detail": async (p, ws) => notifications.detail(await browserIdentity(ws), p.notificationId),
  "office.usage": () => readAiCenter(native),
  "office.usage.detail": p => tokenUsage.detail(p),
  "office.resetCredit.consume": p => consumeOpenAiResetCredit(native, p),
  "schedule.list": p => { scheduleInput(p); return { ...schedules.list(), sessions: store.list().map(({ id, name, project }) => ({ id, name, project })) }; },
  "schedule.create": p => store.once(p, () => ({ id: schedules.create(scheduleInput(p)).task.id })),
  "schedule.update": p => store.once(p, () => ({ id: schedules.update(scheduleInput(p)).task.id })),
  "schedule.delete": p => store.once(p, () => schedules.remove(scheduleInput(p))),
  "schedule.run": p => store.once(p, () => schedules.runNow(p)),
  "office.login": async p => { if ((await account({ refresh: true })).loggedIn) return { loggedIn: true }; if (login?.loginId) await native.call("account/login/cancel", { loginId: login.loginId }); const browser = process.env.CLAW3D_OFFICE_DESKTOP === "1" && p.flow !== "device"; login = await native.call("account/login/start", { type: browser ? "chatgpt" : "chatgptDeviceCode" }, 30000); return login; },
  "office.backend.status": async () => { await restoredSessionStates; return { version: native.identity?.version || null, source: native.identity?.source || "unknown", startedAt: native.identity?.startedAt || null, ready: native.ready, reservation: reservation.value ? { jobId: reservation.value.jobId, at: reservation.value.at } : null, blockers: reservation.blockers() }; },
  "office.backend.reserve": p => reserveBackend({ restored:restoredSessionStates,reservation,controls,store,native },p),
  "office.backend.verify": p => verifyBackend({ restored:restoredSessionStates,reservation,controls,store,delivery },p),
  "office.backend.release": p => reservation.release(p.jobId),
  "office.snapshot": async () => { await restoredSessionStates; const listed = agents(); return { defaultId: listed[0]?.id, mainKey: "main", agents: listed, projects: store.projects(), creationAvailable: native.ready }; },
  "agents.list": async () => methods["office.snapshot"](),
  "project.create": p => store.createProject(p),
  "project.inspect": p => store.inspectProject(p.projectId),
  "project.update": async p => { const result = await store.updateProject(p); broadcast("project.updated", { projectId: result.project.id }); return result; },
  "project.folders.list": async p => {
    const directory = store.directory(p.path || os.homedir());
    const result = await native.call("fs/readDirectory", { path: directory });
    return { directory, parent: path.dirname(directory) === directory ? null : path.dirname(directory),
      entries: result.entries.filter(e => e.isDirectory && typeof e.fileName === "string" && e.fileName && !/[\/\\\0\r\n]/.test(e.fileName) && !e.fileName.startsWith(".")).map(e => e.fileName).sort().slice(0, 300) };
  },
  "session.create": p => store.createSession(p),
  "recruitment.list": () => store.recruitmentTemplates(),
  "recruitment.choices": p => store.recruitmentChoices(p),
  "recruitment.save": p => store.saveRecruitmentTemplate(p),
  "recruitment.delete": p => store.deleteRecruitmentTemplate(p),
  "recruitment.default": p => store.setRecruitmentDefault(p),
  "session.fork": p => store.forkSession(p),
  "session.new": p => { const row = store.get(p.threadId); return store.createSession({ name: p.name || "New chat", projectId: row.projectId, workspace: row.workspace, requestId: p.requestId }); },
  "session.firefighter": () => store.firefighter(),
  "session.rename": p => store.renameSession(p),
  "session.reassign": p => store.reassignSession(p),
  "session.archive": async p => {
    if (voice.active?.threadId === p.threadId) throw new Error("End the voice call before archiving");
    if (controls.state(p.threadId).activeTurnId) throw new Error("Stop the active task before archiving");
    todos.assertCanArchiveAgent(p.threadId);
    const result = await store.archiveSession(p);
    schedules.pauseForSession(p.threadId);
    return result;
  },
  "config.get": async () => ({ exists: true, hash: "office-codex-1", config: { gateway: { reload: { mode: "hot" } }, agents: { list: agents() } } }),
  "sessions.list": async p => ({ sessions: store.list().filter(r => !p.agentId || p.agentId === r.id).map(r => ({ key: key(r.id), displayName: r.name, updatedAt: r.updatedAt, model: r.model, thinkingLevel: r.effort })) }),
  "sessions.preview": async p => ({ ts: Date.now(), previews: (p.keys || []).map(key => ({ key, status: "empty", items: [] })) }),
  "chat.history": async p => ({ sessionKey: p.sessionKey, ...await history(String(p.sessionKey).split(":")[1], p.cursor) }),
  "session.history": p => history(p.threadId, p.cursor, p.historyEpoch, p.conversationVersion),
  "session.search": p => messageSearch.search(p),
  "session.messageContext": p => messageSearch.context(p),
  "session.inspect": async p => { store.get(p.threadId); return { ...store.list().find(row => row.id === p.threadId), historyEpoch: controls.state(p.threadId).historyEpoch, statusSource: "Office Codex runtime", runtime: "office", terminalAvailable: true, readOnly: false, controlsAvailable: native.ready, ...(p.includeHistory === false ? {} : await history(p.threadId)) }; },
  "session.attach": async p => { store.get(p.threadId); await controls.attach(p.threadId); return controls.snapshot(p.threadId); },
  "session.subscribe": (p, ws) => { store.get(p.threadId); return stream.subscribe(ws, p.threadId, p.subscriptionId); },
  "session.unsubscribe": (p, ws) => stream.unsubscribe(ws, p.subscriptionId),
  "session.delivery": p => { store.get(p.actorId); return { deliveries: delivery.status(p.actorId, p.threadId), inbox: delivery.summary(p.actorId), batches: delivery.receipts(p.actorId) }; },
  "session.sends.list": p => { store.get(p.threadId); return { threadId: p.threadId, ...userSends.list(p.threadId, p.cursor) }; },
  "session.sends.read": p => { store.get(p.threadId); return userSends.read(p.threadId, p.requestId); },
  "session.sends.reconcile": async p => { store.get(p.threadId); await controls.refreshTurn(p.threadId); return reconcileUserSends(p.threadId); },
  "session.sends.resend": p => resendUserInput({ store, userSends, controls, native, account, reconcileUserSends }, p),
  "session.send": async p => {
    if (Object.hasOwn(p, "actorId")) {
      store.get(p.threadId);
      const message = directMessage(store, p), sender = store.get(p.actorId);
      if (p.actorId === p.threadId) throw new Error("Continue your current work directly; do not send yourself another model message");
      if (p.attachments?.length || p.references?.length) throw new Error("Agent delivery accepts message text only");
      const scope = todos.context(sender.id);
      const context = { ...(replyContext.current(sender.id) || {}), ...(scope.todoId ? {
        origin: { taskId: scope.todoId, phaseId: scope.runningPhaseId, handoffId: scope.handoffId, role: scope.activityRole },
      } : {}) };
      // A new contribution carries its own Q/origin, not a recursively copied
      // inbox of earlier correspondents.
      delete context.deliveries;
      return delivery.enqueue({ ...p, recipient: p.threadId, message,
        originalMessage: p.message, sender: { source: "agent", id: sender.id, name: sender.name }, context });
    }
    const message = directMessage(store, p), admission = refresh.inputBoundary(p.threadId); if (!(await account()).loggedIn) throw new Error("Sign in to Codex for Office before sending");
    refresh.assertInputBoundary(p.threadId, admission);
    const refreshResult = p.refreshIntent ? await automaticRefresh(p.threadId, p.refreshIntent, p.requestId, crypto.createHash("sha256").update(JSON.stringify({ message: p.message, attachments: p.attachments || [], references: p.references || [], sourcePurpose: p.sourcePurpose ?? null })).digest("hex")) : null;
    const usage = { ...userUsage(p.sourcePurpose), ...(p.actorId ? { senderId: p.actorId, trigger: "agentMessage" } : {}) }; store.get(p.threadId); const pending = store.pendingQuestions(p.threadId).map(q => q.requestId); const result = await controls.send(p.threadId, message, p.requestId, p.attachments, { references: p.references || [], usage, userSend: { sourcePurpose: p.sourcePurpose ?? null, acknowledgeUnconfirmed: p.acknowledgeUnconfirmed === true } }); store.clearQuestions(p.threadId, pending); return { ...result, ...(refreshResult ? { refresh: refreshResult } : {}) }; },
  "session.edit.prepare": p => { store.get(p.threadId); return controls.prepareEdit(p.threadId); },
  "session.edit.commit": async p => {
    store.get(p.threadId);
    if (!(await account()).loggedIn) throw new Error("Sign in to Codex for Office before sending");
    return store.once(p, () => controls.commitEdit(p.threadId, p));
  },
  "session.composer.options": p => composer.options(p.threadId, p.kind, p.query),
  "session.compact": p => { store.get(p.threadId); if (voice.active?.threadId === p.threadId) throw new Error("End the voice call before compacting"); return store.once(p, () => controls.compact(p.threadId)); },
  "session.mcp": async p => { store.get(p.threadId); const result = await native.call("mcpServerStatus/list", { limit: 50 }); return { servers: result.data.map(server => ({ name: server.name, status: server.runtimeStatus || server.authStatus, tools: Object.keys(server.tools || {}).length })) }; },
  "session.continue": async p => { store.get(p.threadId); if (!(await account()).loggedIn) throw new Error("Sign in to Codex for Office before sending"); const pending = store.pendingQuestions(p.threadId).map(q => q.requestId); const result = await controls.send(p.threadId, "Continue where you left off.", p.requestId, [], { resumeInterrupted: true }); store.clearQuestions(p.threadId, pending); return result; },
  "session.stop": async p => { store.get(p.threadId); try { return await controls.stop(p.threadId, p.turnId); } finally { const row = todos.bound(p.threadId); if (row) broadcast("todos.updated", { id: row.id }); } },
  "session.settings.choices": p => { store.get(p.threadId); return controls.choices(p.threadId); },
  "session.settings.update": p => { store.get(p.threadId); if (voice.active?.threadId === p.threadId) throw new Error("End the voice call before changing settings"); return controls.updateSettings(p.threadId, p.settings); },
  "session.voice.options": () => voice.choices(),
  "session.voice.previews": p => voicePreviews.read(p),
  "session.voice.start": async (p, ws) => { store.get(p.threadId); if (!(await account()).loggedIn) throw new Error("Sign in to Codex for Office before calling"); if (controls.state(p.threadId).editUncertain && !await controls.reconcileEdit(p.threadId)) throw new Error("A previous rewind is still unconfirmed. Wait before calling."); if (controls.state(p.threadId).editCommit) throw new Error("Wait for the edit to finish before calling"); const brief = p.notificationId === undefined ? undefined : notifications.detail(await browserIdentity(ws), p.notificationId);
    if (brief && brief.headId !== p.threadId) throw new Error("Open the Head associated with this reminder");
    return voice.start(ws, p.threadId, p.sdp, p.voiceId, p.voice, brief); },
  "session.voice.stop": (p, ws) => { store.get(p.threadId); return voice.stop(ws, p.threadId, p.voiceId); },
  "session.question.reply": async p => {
    store.get(p.threadId);
    const request = store.pendingQuestions(p.threadId).find(q => q.requestId === p.promptId);
    if (!request) { const result = controls.replyQuestions(p.threadId, p.promptId, p.answers); changed(); return result; }
    if (!(await account()).loggedIn) throw new Error("Sign in to Codex for Office before answering");
    const result = await controls.send(p.threadId, questionReplyMessage(request, p.answers), p.requestId, [], { usage: { purpose: "chat_work", trigger: "questionReply" } });
    store.clearQuestions(p.threadId, [request.requestId]); return result;
  },
  "session.approval.reply": p => { store.get(p.threadId); const result = controls.reply(p.threadId, p.requestId, p.decision); changed(); return result; },
  "session.workspace.list": p => workspace.files(store.get(p.threadId), p.path, p.root),
  "session.workspace.read": p => workspace.file(store.get(p.threadId), p.path, p.root),
  "session.terminal.subscribe": (p, ws) => workspace.subscribe(ws, store.get(p.threadId).id),
  "session.terminal.unsubscribe": (_p, ws) => { workspace.disconnected(ws); return {}; },
  "session.terminal.start": p => workspace.start(store.get(p.threadId)),
  "session.terminal.write": p => workspace.write(store.get(p.threadId).id, p.handle, p.dataBase64),
  "session.terminal.resize": p => workspace.resize(store.get(p.threadId).id, p.handle, p.cols, p.rows),
  "session.terminal.stop": p => workspace.stop(store.get(p.threadId).id, p.handle),
  "session.prediction": async (p, ws) => {
    store.get(p.threadId); if (!features.prediction) return null;
    if (typeof p.requestId !== "string" || p.requestId.length > 100) throw new Error("Invalid suggestion request");
    void predictions.suggest(p.threadId).then(prediction => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: "event", event: "session.prediction", payload: { threadId: p.threadId, requestId: p.requestId, prediction } })); }, () => {});
    return { pending: true };
  },
  "models.list": async () => ({ models: (await native.call("model/list", {})).data.map(m => ({ id: m.model, name: m.displayName, provider: "openai" })) }),
  "status": async () => ({ runtime: "Office-owned Codex", readOnly: false, features, sessions: { recent: store.list().map(r => ({ key: key(r.id), updatedAt: r.updatedAt })) } }),
  "agents.files.get": async () => ({ file: { missing: true } }),
  "exec.approvals.get": async () => ({ file: { agents: {} } }),
};
const voicePreviews = createOfficeVoicePreviews({ home: native.home,
  readVoices: async () => (await voice.choices()).voices,
  refreshAuth: () => native.call("account/read", { refreshToken: true }),
});
dictate = createOfficeDictation({ token, onUsage: value => tokenUsage.recordDictation(value), findThread: id => store.get(id), home: native.home,
  refreshAuth: () => native.call("account/read", { refreshToken: true }),
  onStatus: status => {
    Object.assign(features, status);
    for (const state of controls.states.values()) state.version++;
    stream.refresh();
  },
});
const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url?.split("?")[0] === "/dictation") return void dictate(req, res);
  const { rules, defaults, warnings } = native.profile;
  res.writeHead(native.ready ? 200 : 503, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: native.ready, backendVersion: native.identity?.version || null, backendReservation: reservation.value?.jobId || null, runtime: "Office-owned Codex", agents: store.list().length, readOnly: false, features, configuration: { rules, defaults, extraSkillRoots: native.profile.skillRoots.length, warnings } }));
});
const wss = new WebSocketServer({ server, maxPayload: 256 * 1024 });
wss.on("connection", (ws, req) => {
  ws.pushIdentity = req.headers[PUSH_IDENTITY_HEADER];
  let connected = false;
  const send = frame => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame)); };
  send({ type: "event", event: "connect.challenge", payload: { nonce: crypto.randomUUID() } });
  ws.on("message", async raw => {
    let frame; try { frame = JSON.parse(String(raw)); } catch { return ws.close(1003, "Invalid JSON"); }
    if (frame.type !== "req" || typeof frame.id !== "string") return;
    try {
      let result;
      if (frame.method === "connect") {
        const given = Buffer.from(frame.params?.auth?.token || ""), expected = Buffer.from(token);
        if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new Error("Invalid gateway token");
        if (!native.ready) throw new Error("Office Codex is starting");
        connected = true; clients.add(ws);
        result = { type: "hello-ok", protocol: 3, adapterType: "openclaw", server: { version: "office-codex-1", connId: crypto.randomUUID() }, features: { methods: Object.keys(methods), events: ["tick", "session.stream", "session.historyReset", "session.refresh", "session.terminal", "session.voice", "roster.updated", "project.updated", "office.account", "session.prediction", "schedules.updated", "todos.updated"] }, snapshot: { health: { agents: agents().map(r => ({ agentId: r.id, name: r.name })), defaultAgentId: store.list()[0]?.id }, sessionDefaults: { mainKey: "main" } }, auth: { role: "operator", scopes: ["operator.read", "operator.write", "operator.approvals"] }, policy: { maxPayload: 262144, maxBufferedBytes: 1048576, tickIntervalMs: 30000, requestTimeoutMs: 20000 } };
      } else {
        if (!connected) throw new Error("Connect first");
        if (!Object.hasOwn(methods, frame.method)) throw new Error("This feature is not available in Office");
        const params = frame.params || {};
        if (params.threadId && !(frame.method === "session.send" && params.actorId) && ["session.send", "session.sends.resend", "session.edit.prepare", "session.edit.commit", "session.compact", "session.continue", "session.settings.update", "session.voice.start", "session.terminal.start", "session.rename", "session.reassign", "session.archive", "session.fork", "session.new"].includes(frame.method)) refresh.assertAvailable(params.threadId);
        result = await methods[frame.method](frame.params || {}, ws);
        if (frame.params?.threadId) stream.changed(frame.params.threadId);
      }
      send({ type: "res", id: frame.id, ok: true, payload: result });
    } catch (error) { send({ type: "res", id: frame.id, ok: false, error: { code: ["SESSION_REFRESHING", "SESSION_REFRESH_CANCELLED", "SESSION_REFRESH_INVALID", "SESSION_VERSION_CHANGED"].includes(error.code) ? error.code : "UNAVAILABLE", message: error.message } }); }
  });
  ws.on("close", () => { clients.delete(ws); voice.disconnected(ws); stream.disconnected(ws); workspace.disconnected(ws); }); ws.on("error", () => { clients.delete(ws); voice.disconnected(ws); stream.disconnected(ws); workspace.disconnected(ws); });
});
const checkpoint = setInterval(() => { try { todos.checkpoint(); } catch (error) { console.error("Could not save task timer:", error.message); } }, 15000); checkpoint.unref();
const tick = setInterval(() => broadcast("tick", { ts: Date.now() }), 30000); tick.unref();
async function close(code = 0) {
  if (stopping) return; stopping = true; delivery?.close(); clearInterval(tick); clearInterval(checkpoint); todos?.close(); await notifications.close(); clearTimeout(rosterTimer); const dictationClosed = Promise.all([dictate.close(), voicePreviews.close()]); schedules.close(); controls.close();
  for (const ws of clients) { stream.disconnected(ws); ws.close(1001, "Office stopping"); }
  wss.close(); server.close(); await dictationClosed; await tokenUsage.close(); await workspace.close(); await native.close(); process.exitCode = code;
}
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => void close());
async function restoreSessionStates() {
  // Reconcile the original native turn before recovering a failed/interrupted
  // task. Stop intent and the retry budget persist across gateway restarts.
  const rows = store.list().filter(row => row.codexThreadId);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
    while (next < rows.length && !stopping) {
      const row = rows[next++];
      try { await controls.recover(row.id); stream.changed(row.id); }
      catch (error) { console.warn(`Could not restore Office session status ${row.id}: ${error.message}`); }
    }
  }));
  changed();
  if (!stopping && !reservation.held) await delegation.flush();
}
native.initialize().then(() => {
  tokenUsage.setRuntimeVersion(native.identity.version);
  void account().catch(() => {});
  restoredSessionStates = restoreSessionStates();
  server.listen(Number(process.env.CODEX_ADAPTER_PORT || 18790), "127.0.0.1", () => {
    schedules.start();
    console.log(`[office-codex] Configuration discovered: ${native.profile.rules.filter(r => r.status === "shared").length} shared rule files, ${native.profile.defaults.length} inherited defaults`);
    for (const warning of native.profile.warnings) console.warn(`[office-codex] ${warning}`);
    console.log("[office-codex] Independent stdio runtime ready");
  });
}).catch(error => { console.error(error.message); void close(1); });
