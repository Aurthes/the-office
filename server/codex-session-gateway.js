"use strict";
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const { WebSocketServer, WebSocket } = require("ws");
const { CodexSessionIndex } = require("./codex-session-index");
const { loadSessionHistoryPage } = require("./codex-session-history");
const { CodexSharedClient } = require("./codex-shared-client");
const { CodexSessionControls } = require("./codex-session-controls");
const { CodexSessionVoice } = require("./codex-session-voice");
const { CodexSessionStream } = require("./codex-session-stream");
const { CodexRosterSync } = require("./codex-roster-sync");
const { CodexWorkspaceActions } = require("./codex-workspace-actions");

const index = new CodexSessionIndex(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
const token = process.env.CLAW3D_GATEWAY_TOKEN;
if (!token) throw new Error("CLAW3D_GATEWAY_TOKEN is required");
const port = Number(process.env.CODEX_ADAPTER_PORT || 18790);
let controls, voice, stream, rosterSync;
const liveNotifications = new Map();
function notifyLive(threadId) {
  stream?.changed(threadId);
  if (!threadId || liveNotifications.has(threadId)) return;
  liveNotifications.set(threadId, setTimeout(() => {
    liveNotifications.delete(threadId);
    // Legacy notifications have no global sequence: only clients that actually
    // use session.live receive them. Other tabs must not see false event gaps.
    const frame = JSON.stringify({ type: "event", event: "session.updated", payload: { threadId } });
    for (const ws of clients) if (ws.legacySessionUpdates && ws.readyState === WebSocket.OPEN) ws.send(frame);
  }, 50));
}
const shared = process.env.CLAW3D_CODEX_CONTROL_SOCKET ? new CodexSharedClient(process.env.CLAW3D_CODEX_CONTROL_SOCKET, frame => {
  const threadId = frame.params?.threadId, previous = threadId ? controls?.state(threadId).version : null;
  controls?.handle(frame);
  voice?.handle(frame);
  rosterSync?.native(frame);
  if (threadId && previous !== controls?.state(threadId).version) notifyLive(threadId);
  if (frame.method === "connection/closed" && !stopping) process.exit(1);
}) : null;
controls = shared ? new CodexSessionControls(shared, id => index.pendingQuestions(id)) : null;
stream = controls ? new CodexSessionStream(controls) : null;
voice = shared ? new CodexSessionVoice(shared, controls, (ws, payload) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "event", event: "session.voice", payload }));
}) : null;
const reader = shared ? null : spawn(process.env.CLAW3D_CODEX_BIN || "codex", ["app-server", "--listen", "stdio://"], { stdio: ["pipe", "pipe", "inherit"] });
const pending = new Map(), clients = new Set();
let serial = 0, seq = 0, ready = false, stopping = false;
const call = (method, params = {}) => new Promise((resolve, reject) => {
  if (shared) return shared.call(method, params).then(resolve, reject);
  // Read operations only: the App owns all execution and original thread IDs.
  if (!["initialize", "thread/turns/list"].includes(method)) return reject(new Error("Read-only App session view"));
  const id = ++serial;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error("Session history read timed out")); }, 15000);
  pending.set(id, { resolve, reject, timer });
  reader.stdin.write(JSON.stringify({ id, method, params }) + "\n");
});
if (reader) readline.createInterface({ input: reader.stdout }).on("line", line => {
  let frame; try { frame = JSON.parse(line); } catch { return; }
  const request = pending.get(frame.id);
  if (!request) return;
  pending.delete(frame.id); clearTimeout(request.timer);
  if (frame.error) request.reject(new Error(frame.error.message));
  else request.resolve(frame.result);
});
reader?.on("exit", () => { ready = false; if (!stopping) process.exit(1); });
reader?.on("error", error => { console.error(error.message); process.exit(1); });
const rows = () => index.list();
const key = id => `agent:${id}:main`;
const get = id => { const row = rows().find(r => r.id === id); if (!row) throw new Error("Original App session is missing or archived"); return row; };
const fromKey = value => get(String(value).split(":")[1]);
const agents = () => rows().map(({ pendingQuestions, ...r }) => ({ ...r, needsInput: Boolean(pendingQuestions?.length || controls?.questions(r.id).some(q => !q.submitted)), role: r.project, identity: { name: r.name, emoji: "💬" } }));
const workspaceActions = new CodexWorkspaceActions(shared);
rosterSync = new CodexRosterSync(index, payload => {
  stream?.refresh();
  const frame = JSON.stringify({ type: "event", event: "roster.updated", seq: seq++, payload });
  for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(frame);
}, id => Boolean(controls?.questions(id).some(q => !q.submitted)));
async function history(row, cursor) {
  if (controls && !cursor) {
    try { await controls.attach(row.id); }
    catch (error) { if (error.code !== "APP_THREAD_NOT_LOADED") throw error; }
  }
  return loadSessionHistoryPage(call, row, cursor);
}
const { answerQuestions } = require("./codex-session-questions");
const methods = {
  "office.snapshot": async () => {
    const listed = agents();
    return { defaultId: listed[0]?.id, mainKey: "main", agents: listed,
      projects: index.projects(), creationAvailable: Boolean(shared?.ready) };
  },
  "agents.list": async () => ({ defaultId: rows()[0]?.id, mainKey: "main", agents: agents(), projects: index.projects(), creationAvailable: Boolean(shared?.ready) }),
  "project.create": async p => { const result = await workspaceActions.createProject(p); rosterSync.changed(); return result; },
  "session.create": async p => { const result = await workspaceActions.createSession(p); rosterSync.changed(); return result; },
  "config.get": async () => ({ exists: true, hash: "codex-app-session-view", config: { gateway: { reload: { mode: "hot" } }, agents: { list: agents() } } }),
  "sessions.list": async p => ({ sessions: rows().filter(r => !p.agentId || r.id === p.agentId).map(r => ({ key: key(r.id), displayName: r.name, updatedAt: r.updatedAt, model: r.model, thinkingLevel: r.effort, execHost: "gateway", execSecurity: "deny", execAsk: "always" })) }),
  "sessions.preview": async p => ({ ts: Date.now(), previews: (p.keys || []).map(k => ({ key: k, status: "empty", items: [] })) }),
  "chat.history": async p => ({ sessionKey: p.sessionKey, ...await history(fromKey(p.sessionKey), p.cursor) }),
  "session.history": async p => history(get(p.threadId), p.cursor),
  "session.inspect": async p => { const row = get(p.threadId); return { ...row, statusSource: "App session events", readOnly: !shared, controlsAvailable: Boolean(shared?.ready),
    ...(p.includeHistory === false ? {} : await history(row)) }; },
  "session.attach": async p => { const row = get(p.threadId); if (!controls) throw new Error("当前仍为只读，原 App 共享控制未启用"); await controls.attach(row.id); return controls.snapshot(row.id); },
  "session.subscribe": async (p, ws) => { const row = get(p.threadId); if (!stream) throw new Error("当前仍为只读，原 App 共享控制未启用"); return stream.subscribe(ws, row.id, p.subscriptionId); },
  "session.unsubscribe": async (p, ws) => stream?.unsubscribe(ws, p.subscriptionId) ?? { unsubscribed: true },
  "session.live": async (p, ws) => { const row = get(p.threadId); if (!controls) throw new Error("当前仍为只读"); ws.legacySessionUpdates = true; return controls.snapshot(row.id, Number(p.since) || 0); },
  "session.send": async p => { const row = get(p.threadId); if (!controls) throw new Error("当前仍为只读"); const result = await controls.send(row.id, p.message, p.requestId, p.attachments); notifyLive(row.id); return result; },
  "session.question.reply": async p => {
    const row = get(p.threadId);
    if (!controls) throw new Error("原会话控制未连接");
    const question = row.pendingQuestions?.find(q => q.requestId === p.promptId);
    if (!question) { const result = controls.replyQuestions(row.id, p.promptId, p.answers); notifyLive(row.id); rosterSync.changed(); return result; }
    const answers = answerQuestions(question, p.answers);
    const result = await controls.send(row.id, "<send_user_message_question_reply>\n" + JSON.stringify(answers).replace(/</g, "\\u003c") + "\n</send_user_message_question_reply>", p.requestId);
    rosterSync.changed(); return result;
  },
  "session.settings.choices": async p => { const row = get(p.threadId); if (!controls) throw new Error("原会话设置未连接"); return controls.choices(row.id); },
  "session.settings.update": async p => { const row = get(p.threadId); if (!controls) throw new Error("原会话设置未连接"); return controls.updateSettings(row.id, p.settings); },
  "session.voice.start": async (p, ws) => { const row = get(p.threadId); if (!voice) throw new Error("原生语音未连接"); return voice.start(ws, row.id, p.sdp, p.voiceId); },
  "session.voice.stop": async (p, ws) => { const row = get(p.threadId); if (!voice) throw new Error("原生语音未连接"); return voice.stop(ws, row.id, p.voiceId); },
  "session.stop": async p => { const row = get(p.threadId); if (!controls) throw new Error("当前仍为只读"); return controls.stop(row.id); },
  "session.approval.reply": async p => { const row = get(p.threadId); if (!controls) throw new Error("当前仍为只读"); const result = controls.reply(row.id, p.requestId, p.decision); notifyLive(row.id); return result; },
  "models.list": async () => ({ models: [] }),
  "status": async () => ({ runtime: "Codex App session organizer", readOnly: !shared, sessions: { recent: rows().map(r => ({ key: key(r.id), updatedAt: r.updatedAt })) } }),
  "agents.files.get": async () => ({ file: { missing: true } }),
  "exec.approvals.get": async () => ({ file: { agents: Object.fromEntries(rows().map(r => [r.id, { security: "deny", ask: "always" }])) } }),
};
const server = http.createServer((_req, res) => { res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: ready, runtime: "Codex App session organizer", agents: rows().length, readOnly: !shared })); });
const wss = new WebSocketServer({ server, maxPayload: 256 * 1024 });
wss.on("connection", ws => {
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
        if (!ready) throw new Error("Session reader is starting");
        connected = true; clients.add(ws);
        result = { type: "hello-ok", protocol: 3, adapterType: "openclaw", server: { version: "codex-app-session-view-1", connId: crypto.randomUUID() },
          features: { methods: Object.keys(methods), events: ["tick", "session.updated", "session.stream", "session.voice", "roster.updated"] },
          snapshot: { health: { agents: agents().map(r => ({ agentId: r.id, name: r.name })), defaultAgentId: rows()[0]?.id }, sessionDefaults: { mainKey: "main" } },
          auth: { role: "operator", scopes: shared ? ["operator.read", "operator.write", "operator.approvals"] : ["operator.read"] }, policy: { maxPayload: 262144, maxBufferedBytes: 1048576, tickIntervalMs: 30000, requestTimeoutMs: 20000 } };
      } else {
        if (!connected) throw new Error("Connect first");
        if (!Object.hasOwn(methods, frame.method)) throw new Error("此操作暂不支持，请在 Codex App 中处理。");
        result = await methods[frame.method](frame.params || {}, ws);
      }
      send({ type: "res", id: frame.id, ok: true, payload: result });
    } catch (error) { send({ type: "res", id: frame.id, ok: false, error: { code: "UNAVAILABLE", message: error.message } }); }
  });
  ws.on("close", () => { clients.delete(ws); voice?.disconnected(ws); stream?.disconnected(ws); }); ws.on("error", () => { clients.delete(ws); stream?.disconnected(ws); });
});
setInterval(() => {
  const frame = JSON.stringify({ type: "event", event: "tick", seq: seq++, payload: { ts: Date.now() } });
  for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(frame);
}, 30000).unref();
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { stopping = true; rosterSync.close(); server.close(); for (const ws of clients) ws.close(1001, "Server stopping"); reader?.stdin.end(); shared?.close(); index.close(); });
(shared ? shared.initialize() : call("initialize", { clientInfo: { name: "claw3d_session_reader", title: "Claw3D existing sessions", version: "1" } })).then(() => {
  reader?.stdin.write(JSON.stringify({ method: "initialized" }) + "\n"); rosterSync.start(); ready = true;
  server.listen(port, "127.0.0.1", () => console.log(`[session-view] ${shared ? "Shared App owner connected" : "Read-only reader; controls disabled"}`));
}).catch(error => { console.error(error.message); reader?.stdin.end(); shared?.close(); process.exitCode = 1; });
