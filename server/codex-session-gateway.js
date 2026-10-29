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

const index = new CodexSessionIndex(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
const token = process.env.CLAW3D_GATEWAY_TOKEN;
if (!token) throw new Error("CLAW3D_GATEWAY_TOKEN is required");
const port = Number(process.env.CODEX_ADAPTER_PORT || 18790);
const reader = spawn(process.env.CLAW3D_CODEX_BIN || "codex", ["app-server", "--listen", "stdio://"], { stdio: ["pipe", "pipe", "inherit"] });
const pending = new Map(), clients = new Set();
let serial = 0, seq = 0, ready = false, stopping = false;
const call = (method, params = {}) => new Promise((resolve, reject) => {
  // Read operations only: the App owns all execution and original thread IDs.
  if (!["initialize", "thread/items/list"].includes(method)) return reject(new Error("Read-only App session view"));
  const id = ++serial;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error("Session history read timed out")); }, 15000);
  pending.set(id, { resolve, reject, timer });
  reader.stdin.write(JSON.stringify({ id, method, params }) + "\n");
});
readline.createInterface({ input: reader.stdout }).on("line", line => {
  let frame; try { frame = JSON.parse(line); } catch { return; }
  const request = pending.get(frame.id);
  if (!request) return;
  pending.delete(frame.id); clearTimeout(request.timer);
  if (frame.error) request.reject(new Error(frame.error.message));
  else request.resolve(frame.result);
});
reader.on("exit", () => { ready = false; if (!stopping) process.exit(1); });
reader.on("error", error => { console.error(error.message); process.exit(1); });
const rows = () => index.list();
const key = id => `agent:${id}:main`;
const get = id => { const row = rows().find(r => r.id === id); if (!row) throw new Error("Original App session is missing or archived"); return row; };
const fromKey = value => get(String(value).split(":")[1]);
const agents = () => rows().map(r => ({ ...r, role: r.project, identity: { name: r.name, emoji: "💬" } }));
async function history(row, cursor) {
  return loadSessionHistoryPage(call, row, cursor);
}
const methods = {
  "agents.list": async () => ({ defaultId: rows()[0]?.id, mainKey: "main", agents: agents(), projects: index.projects().map(({ id, name }) => ({ id, name })) }),
  "config.get": async () => ({ exists: true, hash: "codex-app-session-view", config: { gateway: { reload: { mode: "hot" } }, agents: { list: agents() } } }),
  "sessions.list": async p => ({ sessions: rows().filter(r => !p.agentId || r.id === p.agentId).map(r => ({ key: key(r.id), displayName: r.name, updatedAt: r.updatedAt, model: r.model, thinkingLevel: r.effort, execHost: "gateway", execSecurity: "deny", execAsk: "always" })) }),
  "sessions.preview": async p => ({ ts: Date.now(), previews: (p.keys || []).map(k => ({ key: k, status: "empty", items: [] })) }),
  "chat.history": async p => ({ sessionKey: p.sessionKey, ...await history(fromKey(p.sessionKey), p.cursor) }),
  "session.history": async p => history(get(p.threadId), p.cursor),
  "session.inspect": async p => { const row = get(p.threadId); return { ...row, statusSource: "App session events", readOnly: true,
    ...(p.includeHistory === false ? {} : await history(row)) }; },
  "models.list": async () => ({ models: [] }),
  "status": async () => ({ runtime: "Codex App session organizer", readOnly: true, sessions: { recent: rows().map(r => ({ key: key(r.id), updatedAt: r.updatedAt })) } }),
  "agents.files.get": async () => ({ file: { missing: true } }),
  "exec.approvals.get": async () => ({ file: { agents: Object.fromEntries(rows().map(r => [r.id, { security: "deny", ask: "always" }])) } }),
};
const server = http.createServer((_req, res) => { res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: ready, runtime: "Codex App session organizer", agents: rows().length, activeTurns: 0, readOnly: true })); });
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
          features: { methods: Object.keys(methods), events: ["tick"] },
          snapshot: { health: { agents: agents().map(r => ({ agentId: r.id, name: r.name })), defaultAgentId: rows()[0]?.id }, sessionDefaults: { mainKey: "main" } },
          auth: { role: "operator", scopes: ["operator.read"] }, policy: { maxPayload: 262144, maxBufferedBytes: 1048576, tickIntervalMs: 30000 } };
      } else {
        if (!connected) throw new Error("Connect first");
        if (!Object.hasOwn(methods, frame.method)) throw new Error("此视图整理 App 原会话，不新建、重置或接管会话。请在原 App 中继续操作。");
        result = await methods[frame.method](frame.params || {});
      }
      send({ type: "res", id: frame.id, ok: true, payload: result });
    } catch (error) { send({ type: "res", id: frame.id, ok: false, error: { code: "UNAVAILABLE", message: error.message } }); }
  });
  ws.on("close", () => clients.delete(ws)); ws.on("error", () => clients.delete(ws));
});
setInterval(() => {
  const frame = JSON.stringify({ type: "event", event: "tick", seq: seq++, payload: { ts: Date.now() } });
  for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(frame);
}, 30000).unref();
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { stopping = true; server.close(); for (const ws of clients) ws.close(1001, "Server stopping"); reader.stdin.end(); index.close(); });
call("initialize", { clientInfo: { name: "claw3d_session_reader", title: "Claw3D existing sessions", version: "1" } }).then(() => {
  reader.stdin.write(JSON.stringify({ method: "initialized" }) + "\n"); ready = true;
  server.listen(port, "127.0.0.1", () => console.log("[session-view] Existing App sessions; read-only; no thread/start or turn/start"));
}).catch(error => { console.error(error.message); reader.stdin.end(); process.exitCode = 1; });
