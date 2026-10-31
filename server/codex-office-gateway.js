"use strict";
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");
const { CodexOfficeClient, officeEnvironment } = require("./codex-office-client");
const { CodexOfficeStore } = require("./codex-office-store");
const { CodexSessionControls } = require("./codex-session-controls");
const { CodexSessionStream } = require("./codex-session-stream");
const { CodexSessionWorkspace } = require("./codex-session-workspace");
const { loadSessionHistoryPage } = require("./codex-session-history");
const { createOfficeDictation, suggestNextMessage } = require("./office-model-services");

const token = process.env.CLAW3D_GATEWAY_TOKEN;
if (!token) throw new Error("CLAW3D_GATEWAY_TOKEN is required");
const directory = officeEnvironment(path.resolve(process.env.CLAW3D_OFFICE_DATA_DIR || path.join(process.env.CLAW3D_DATA_DIR || path.join(os.homedir(), ".local/share/claw3d"), "office-runtime"))).home;
const clients = new Set(); let seq = 0, rosterTimer, stopping = false, controls, stream, store, workspace, login;
const features = { dictation: Boolean(process.env.OPENAI_API_KEY), dictationHTTP: true, voice: false, prediction: Boolean(process.env.OPENAI_API_KEY), terminal: true, accountVersion: 0 };
const broadcast = (event, payload) => { const frame = JSON.stringify({ type: "event", event, seq: seq++, payload }); for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(frame); };
function changed() { if (!rosterTimer) rosterTimer = setTimeout(() => { rosterTimer = null; broadcast("roster.updated", { ts: Date.now() }); }, 150); }
const native = new CodexOfficeClient({ home: process.env.CLAW3D_OFFICE_CODEX_HOME || path.join(directory, "codex"), onFrame(frame) {
  if (frame.method === "connection/closed") { if (!stopping) { console.error("Office Codex exited"); void close(1); } return; }
  if (frame.method === "account/login/completed") { login = null; features.accountVersion++; store.defaultModel = null; for (const state of controls.states.values()) state.version++; stream.refresh(); broadcast("office.account", { changed: true, success: frame.params.success, error: frame.params.error }); }
  workspace?.handle(frame);
  const mapped = store?.handle(frame); if (!mapped) return;
  controls?.handle(mapped); if (mapped.params?.threadId) stream?.changed(mapped.params.threadId);
} });
store = new CodexOfficeStore(directory, native, changed);
controls = new CodexSessionControls(store, () => [], { settings: store, features });
stream = new CodexSessionStream(controls);
workspace = new CodexSessionWorkspace(native, { commandExec: true, policy: id => store.overrides(id).sandboxPolicy });
const agents = () => store.list().map(row => ({ ...row, role: row.project, identity: { name: row.name, emoji: "💬" }, needsInput: Boolean(controls.questions(row.id).some(q => !q.submitted) || controls.snapshot(row.id).approvalCount) }));
const key = id => `agent:${id}:main`;
const history = (id, cursor) => loadSessionHistoryPage(store.call.bind(store), store.get(id), cursor);
async function account() { const status = await native.call("account/read", { refreshToken: false }); return { loggedIn: Boolean(status.account) || status.requiresOpenaiAuth === false, email: status.account?.email || null, requiresAuth: status.requiresOpenaiAuth !== false, login }; }
const methods = {
  "office.account": account,
  "office.login": async () => { if ((await account()).loggedIn) return { loggedIn: true }; if (login?.loginId) await native.call("account/login/cancel", { loginId: login.loginId }); login = await native.call("account/login/start", { type: "chatgptDeviceCode" }, 30000); return login; },
  "office.snapshot": async () => { const listed = agents(); return { defaultId: listed[0]?.id, mainKey: "main", agents: listed, projects: store.projects(), creationAvailable: native.ready }; },
  "agents.list": async () => methods["office.snapshot"](),
  "project.create": p => store.createProject(p),
  "session.create": p => store.createSession(p),
  "session.rename": p => store.renameSession(p),
  "session.reassign": p => store.reassignSession(p),
  "session.archive": p => { if (controls.state(p.threadId).activeTurnId) throw new Error("Stop the active task before archiving"); return store.archiveSession(p); },
  "config.get": async () => ({ exists: true, hash: "office-codex-1", config: { gateway: { reload: { mode: "hot" } }, agents: { list: agents() } } }),
  "sessions.list": async p => ({ sessions: store.list().filter(r => !p.agentId || p.agentId === r.id).map(r => ({ key: key(r.id), displayName: r.name, updatedAt: r.updatedAt, model: r.model, thinkingLevel: r.effort })) }),
  "sessions.preview": async p => ({ ts: Date.now(), previews: (p.keys || []).map(key => ({ key, status: "empty", items: [] })) }),
  "chat.history": async p => ({ sessionKey: p.sessionKey, ...await history(String(p.sessionKey).split(":")[1], p.cursor) }),
  "session.history": p => history(p.threadId, p.cursor),
  "session.inspect": async p => { store.get(p.threadId); return { ...store.list().find(row => row.id === p.threadId), statusSource: "Office Codex runtime", runtime: "office", terminalAvailable: true, readOnly: false, controlsAvailable: native.ready, ...(p.includeHistory === false ? {} : await history(p.threadId)) }; },
  "session.attach": async p => { store.get(p.threadId); await controls.attach(p.threadId); return controls.snapshot(p.threadId); },
  "session.subscribe": (p, ws) => { store.get(p.threadId); return stream.subscribe(ws, p.threadId, p.subscriptionId); },
  "session.unsubscribe": (p, ws) => stream.unsubscribe(ws, p.subscriptionId),
  "session.send": async p => { store.get(p.threadId); if (!(await account()).loggedIn) throw new Error("Sign in to Codex for Office before sending"); return controls.send(p.threadId, p.message, p.requestId, p.attachments); },
  "session.stop": p => { store.get(p.threadId); return controls.stop(p.threadId); },
  "session.settings.choices": p => { store.get(p.threadId); return controls.choices(p.threadId); },
  "session.settings.update": p => { store.get(p.threadId); return controls.updateSettings(p.threadId, p.settings); },
  "session.question.reply": p => { store.get(p.threadId); return controls.replyQuestions(p.threadId, p.promptId, p.answers); },
  "session.approval.reply": p => { store.get(p.threadId); return controls.reply(p.threadId, p.requestId, p.decision); },
  "session.workspace.list": p => workspace.files(store.get(p.threadId), p.path),
  "session.workspace.read": p => workspace.file(store.get(p.threadId), p.path),
  "session.terminal.subscribe": (p, ws) => workspace.subscribe(ws, store.get(p.threadId).id),
  "session.terminal.unsubscribe": (_p, ws) => { workspace.disconnected(ws); return {}; },
  "session.terminal.start": p => workspace.start(store.get(p.threadId)),
  "session.terminal.write": p => workspace.write(store.get(p.threadId).id, p.handle, p.dataBase64),
  "session.terminal.resize": p => workspace.resize(store.get(p.threadId).id, p.handle, p.cols, p.rows),
  "session.terminal.stop": p => workspace.stop(store.get(p.threadId).id, p.handle),
  "session.prediction": async (p, ws) => {
    store.get(p.threadId); if (!features.prediction) return null;
    if (typeof p.requestId !== "string" || p.requestId.length > 100) throw new Error("Invalid suggestion request");
    void history(p.threadId).then(h => suggestNextMessage(h.messages)).then(prediction => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: "event", event: "session.prediction", payload: { threadId: p.threadId, requestId: p.requestId, prediction } })); }, () => {});
    return { pending: true };
  },
  "models.list": async () => ({ models: (await native.call("model/list", {})).data.map(m => ({ id: m.model, name: m.displayName, provider: "openai" })) }),
  "status": async () => ({ runtime: "Office-owned Codex", readOnly: false, features, sessions: { recent: store.list().map(r => ({ key: key(r.id), updatedAt: r.updatedAt })) } }),
  "agents.files.get": async () => ({ file: { missing: true } }),
  "exec.approvals.get": async () => ({ file: { agents: {} } }),
};
const dictate = createOfficeDictation({ token, findThread: id => store.get(id) });
const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url?.split("?")[0] === "/dictation") return void dictate(req, res);
  res.writeHead(native.ready ? 200 : 503, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: native.ready, runtime: "Office-owned Codex", agents: store.list().length, readOnly: false, features }));
});
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
        if (!native.ready) throw new Error("Office Codex is starting");
        connected = true; clients.add(ws);
        result = { type: "hello-ok", protocol: 3, adapterType: "openclaw", server: { version: "office-codex-1", connId: crypto.randomUUID() }, features: { methods: Object.keys(methods), events: ["tick", "session.stream", "session.terminal", "roster.updated", "office.account", "session.prediction"] }, snapshot: { health: { agents: agents().map(r => ({ agentId: r.id, name: r.name })), defaultAgentId: store.list()[0]?.id }, sessionDefaults: { mainKey: "main" } }, auth: { role: "operator", scopes: ["operator.read", "operator.write", "operator.approvals"] }, policy: { maxPayload: 262144, maxBufferedBytes: 1048576, tickIntervalMs: 30000, requestTimeoutMs: 20000 } };
      } else {
        if (!connected) throw new Error("Connect first");
        if (!Object.hasOwn(methods, frame.method)) throw new Error("This feature is not available in Office");
        result = await methods[frame.method](frame.params || {}, ws);
        if (frame.params?.threadId) stream.changed(frame.params.threadId);
      }
      send({ type: "res", id: frame.id, ok: true, payload: result });
    } catch (error) { send({ type: "res", id: frame.id, ok: false, error: { code: "UNAVAILABLE", message: error.message } }); }
  });
  ws.on("close", () => { clients.delete(ws); stream.disconnected(ws); workspace.disconnected(ws); }); ws.on("error", () => { clients.delete(ws); stream.disconnected(ws); workspace.disconnected(ws); });
});
const tick = setInterval(() => broadcast("tick", { ts: Date.now() }), 30000); tick.unref();
async function close(code = 0) {
  if (stopping) return; stopping = true; clearInterval(tick); clearTimeout(rosterTimer); dictate.close();
  for (const ws of clients) { stream.disconnected(ws); ws.close(1001, "Office stopping"); }
  wss.close(); server.close(); await workspace.close(); await native.close(); process.exitCode = code;
}
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => void close());
native.initialize().then(() => server.listen(Number(process.env.CODEX_ADAPTER_PORT || 18790), "127.0.0.1", () => console.log("[office-codex] Independent stdio runtime ready"))).catch(error => { console.error(error.message); void close(1); });
