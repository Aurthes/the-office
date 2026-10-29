"use strict";

// Minimal OpenClaw wire-protocol v3 adapter; execution belongs to Codex app-server.
// Protocol reference: openclaw/openclaw f0401d55f085c921883a982512605ec8add8833b,
// packages/gateway-protocol/src/schema/{frames,logs-chat}.ts (MIT).
// Claw3D's MIT-licensed demo adapter supplies the compatible envelope conventions.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const crypto = require("node:crypto");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const { WebSocketServer, WebSocket } = require("ws");

const ROOT = process.env.CLAW3D_DATA_DIR || path.join(os.homedir(), ".local/share/claw3d");
const STATE = path.join(ROOT, "state.json");
const TOKEN = process.env.CLAW3D_GATEWAY_TOKEN;
const CODEX = process.env.CLAW3D_CODEX_BIN || "codex";
const PORT = Number(process.env.CODEX_ADAPTER_PORT || 18790);
const uid = () => crypto.randomUUID();
const clients = new Set();
const pending = new Map();
const running = new Map();
const loaded = new Set();
let serial = 0, sequence = 0, ready = false;
fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
let state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {
  agents: [{ id: "codex", name: "Codex", workspace: path.join(ROOT, "workspace") }], sessions: {},
};
state.requests ||= {};
const save = () => {
  fs.writeFileSync(STATE + ".tmp", JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(STATE + ".tmp", STATE);
};
for (const agent of state.agents) fs.mkdirSync(agent.workspace, { recursive: true });
save();
if (!TOKEN) throw new Error("CLAW3D_GATEWAY_TOKEN is required");

const codex = spawn(CODEX, ["app-server", "--listen", "stdio://"], { stdio: ["pipe", "pipe", "inherit"] });
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++serial;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Codex ${method} timed out; reconcile before retry`)); }, 120000);
  pending.set(id, { resolve, reject, timer });
  codex.stdin.write(JSON.stringify({ id, method, params }) + "\n");
});
const emit = (event, payload) => {
  const message = JSON.stringify({ type: "event", event, seq: sequence++, payload });
  for (const client of clients) if (client.readyState === WebSocket.OPEN) client.send(message);
};
const lifecycle = (run, phase) => emit("agent", { runId: run.runId, sessionKey: run.key, agentId: run.agentId, stream: "lifecycle", data: { phase } });
const chat = (run, status, extra = {}) => emit("chat", { runId: run.runId, sessionKey: run.key, state: status, ...extra });
const textOf = (item) => item.text || (item.content || []).filter(x => x.type === "text" || x.type === "inputText").map(x => x.text).join("\n");
const finalText = (run) => [...run.messages.values()].join("\n\n");
function finish(run, status, error) {
  if (!running.has(run.threadId)) return;
  running.delete(run.threadId);
  const session = state.sessions[run.key];
  if (session) session.updatedAt = Date.now();
  if (state.requests[run.runId]) state.requests[run.runId].status = status;
  save();
  chat(run, status === "completed" ? "final" : status === "interrupted" ? "aborted" : "error", {
    message: { role: "assistant", content: finalText(run) }, errorMessage: error || undefined, stopReason: status,
  });
  lifecycle(run, status === "failed" ? "error" : "end");
  emit("presence", {});
  console.log(`[codex] ${run.runId} ${status} thread=${run.threadId}`);
}
readline.createInterface({ input: codex.stdout }).on("line", (line) => {
  let frame;
  try { frame = JSON.parse(line); } catch { return; }
  if (frame.id !== undefined && !frame.method) {
    const request = pending.get(frame.id);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(frame.id);
    if (frame.error) request.reject(new Error(frame.error.message)); else request.resolve(frame.result);
    return;
  }
  // This deployment uses native workspace-write + approvalPolicy=never. Never
  // silently approve an unexpected server request or fabricate tool results.
  if (frame.id !== undefined) {
    codex.stdin.write(JSON.stringify({ id: frame.id, error: { code: -32601, message: "Interactive requests are unavailable in this minimal adapter" } }) + "\n");
    return;
  }
  const p = frame.params || {}, run = running.get(p.threadId);
  if (!run) return;
  if (frame.method === "item/agentMessage/delta") {
    run.messages.set(p.itemId, (run.messages.get(p.itemId) || "") + p.delta);
    chat(run, "delta", { message: { role: "assistant", content: finalText(run) } });
  } else if (frame.method === "item/completed" && p.item?.type === "agentMessage") {
    run.messages.set(p.item.id, textOf(p.item));
  } else if (["item/started", "item/completed"].includes(frame.method) && ["commandExecution", "fileChange", "mcpToolCall", "webSearch"].includes(p.item?.type)) {
    emit("agent", { runId: run.runId, sessionKey: run.key, agentId: run.agentId, stream: "tool", data: {
      phase: frame.method === "item/started" ? "start" : "result", toolCallId: p.item.id,
      name: p.item.type, args: { command: p.item.command, changes: p.item.changes }, result: p.item.aggregatedOutput?.slice(-12000),
    } });
  } else if (frame.method === "turn/completed") {
    finish(run, p.turn.status, p.turn.error?.message);
  }
});
codex.on("exit", (code) => {
  ready = false;
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Codex app-server exited")); }
  pending.clear();
  for (const run of [...running.values()]) finish(run, "failed", "Codex app-server exited; task was not retried");
  if (!stopping) process.exit(code || 1);
});
codex.on("error", (error) => { console.error(error.message); process.exit(1); });

const getAgent = (id) => {
  const agent = state.agents.find(x => x.id === id);
  if (!agent) throw new Error("Unknown agent");
  return agent;
};
function sessionFor(key) {
  if (typeof key !== "string" || key.length > 256) throw new Error("Invalid session key");
  const agent = getAgent(key.split(":")[1]);
  return state.sessions[key] ||= { key, agentId: agent.id, updatedAt: null };
}
async function threadFor(session) {
  const agent = getAgent(session.agentId);
  const params = { cwd: agent.workspace, approvalPolicy: "never", sandbox: "workspace-write", model: session.model || null };
  if (!session.threadId) {
    const result = await call("thread/start", params);
    session.threadId = result.thread.id;
    session.model = result.model;
    save();
    loaded.add(session.threadId);
  } else if (!loaded.has(session.threadId)) {
    await call("thread/resume", { ...params, threadId: session.threadId });
    loaded.add(session.threadId);
  }
  return session.threadId;
}
async function history(key) {
  const session = sessionFor(key);
  if (!session.threadId) return [];
  const result = await call("thread/turns/list", { threadId: session.threadId, limit: 50, sortDirection: "desc", itemsView: "full" });
  return result.data.toReversed().flatMap(turn => (turn.items || []).filter(item => ["userMessage", "agentMessage"].includes(item.type)).map(item => ({
    role: item.type === "userMessage" ? "user" : "assistant", content: textOf(item), timestamp: turn.startedAt ? (turn.startedAt < 1e12 ? turn.startedAt * 1000 : turn.startedAt) : session.updatedAt,
  })));
}
const agentList = () => state.agents.map(a => ({ ...a, identity: { name: a.name, emoji: "🤖" }, role: "Codex" }));
const sessionList = () => state.agents.map(a => sessionFor(`agent:${a.id}:main`)).concat(Object.values(state.sessions)).filter((s, i, all) => all.findIndex(x => x.key === s.key) === i).map(s => ({
  ...s, displayName: getAgent(s.agentId).name, modelProvider: "openai", origin: { label: "Codex app-server", provider: "openai" },
}));
const config = () => ({ gateway: { reload: { mode: "hot" } }, agents: { defaults: { workspace: path.join(ROOT, "workspace") }, list: agentList() } });
const assertIdle = (agentId) => { if ([...running.values()].some(r => r.agentId === agentId)) throw new Error("Agent is busy; stop its task first"); };
const methods = {
  "agents.list": async () => ({ defaultId: state.agents[0]?.id, mainKey: "main", agents: agentList() }),
  "agents.create": async (p) => {
    if (!p.name?.trim()) throw new Error("Name required");
    const id = (p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "codex") + "-" + uid().slice(0, 6);
    const agent = { id, name: p.name.trim(), workspace: p.workspace ? path.resolve(p.workspace.replace(/^~(?=\/)/, os.homedir())) : path.join(ROOT, "workspace-" + id) };
    fs.mkdirSync(agent.workspace, { recursive: true }); state.agents.push(agent); save(); emit("presence", {});
    return { ok: true, agentId: id, ...agent };
  },
  "agents.update": async (p) => {
    const agent = getAgent(p.agentId); assertIdle(agent.id);
    if (p.name?.trim()) agent.name = p.name.trim();
    if (p.workspace) { agent.workspace = path.resolve(p.workspace); fs.mkdirSync(agent.workspace, { recursive: true }); }
    save(); return { ok: true, removedBindings: 0 };
  },
  "agents.delete": async (p) => {
    const agent = getAgent(p.agentId); assertIdle(agent.id);
    if (state.agents.length === 1) throw new Error("Keep at least one agent");
    state.agents = state.agents.filter(a => a.id !== agent.id);
    for (const [key, s] of Object.entries(state.sessions)) if (s.agentId === agent.id) { if (s.threadId) await call("thread/archive", { threadId: s.threadId }); delete state.sessions[key]; }
    save(); emit("presence", {}); return { ok: true, removedBindings: 0 };
  },
  "config.get": async () => ({ path: STATE, exists: true, config: config(), hash: crypto.createHash("sha256").update(JSON.stringify(config())).digest("hex") }),
  "models.list": async () => { const result = await call("model/list", {}); return { models: result.data.map(m => ({ id: m.model, name: m.displayName, provider: "openai" })) }; },
  "sessions.list": async (p) => ({ sessions: sessionList().filter(s => !p.agentId || p.agentId === s.agentId) }),
  "sessions.preview": async (p) => ({ ts: Date.now(), previews: await Promise.all((p.keys || []).map(async key => ({ key, status: "ok", items: (await history(key)).slice(-8).map(m => ({ ...m, text: m.content })) }))) }),
  "sessions.patch": async (p) => {
    const s = sessionFor(p.key); assertIdle(s.agentId);
    if (p.model !== undefined) s.model = p.model?.replace(/^openai\//, "") || null;
    if (p.thinkingLevel !== undefined) s.effort = p.thinkingLevel;
    save(); return { ok: true, key: s.key, entry: { thinkingLevel: s.effort }, resolved: { model: s.model, modelProvider: "openai" } };
  },
  "sessions.reset": async (p) => { const s = sessionFor(p.key); assertIdle(s.agentId); if (s.threadId) await call("thread/archive", { threadId: s.threadId }); delete state.sessions[p.key]; save(); return { ok: true }; },
  "chat.history": async (p) => ({ sessionKey: p.sessionKey, messages: await history(p.sessionKey) }),
  "chat.send": async (p) => {
    if (!p.message?.trim()) throw new Error("Message required");
    if (p.attachments?.length) throw new Error("This minimal adapter supports text tasks; attachments are not enabled");
    if (p.idempotencyKey && state.requests[p.idempotencyKey]) throw new Error("This request was already accepted; inspect its chat history before sending another task");
    const s = sessionFor(p.sessionKey); assertIdle(s.agentId);
    // Reserve the agent before asynchronous thread creation; never start duplicate turns.
    const reservation = "pending:" + s.agentId;
    const run = { runId: p.idempotencyKey || uid(), key: s.key, agentId: s.agentId, messages: new Map() };
    state.requests[run.runId] = { sessionKey: s.key, status: "accepted" };
    for (const id of Object.keys(state.requests).slice(0, -100)) delete state.requests[id];
    save();
    running.set(reservation, run);
    try {
      const threadId = await threadFor(s); run.threadId = threadId;
      running.delete(reservation); running.set(threadId, run);
      lifecycle(run, "start");
      const result = await call("turn/start", { threadId, cwd: getAgent(s.agentId).workspace, input: [{ type: "text", text: p.message }], model: s.model || null, effort: s.effort || null });
      run.turnId = result.turn.id; s.updatedAt = Date.now(); save();
      console.log(`[codex] ${run.runId} started thread=${threadId}`);
      return { status: "started", runId: run.runId };
    } catch (error) { running.delete(reservation); if (run.threadId) finish(run, "failed", error.message); throw error; }
  },
  "chat.abort": async (p) => {
    const runs = [...running.values()].filter(r => p.runId ? r.runId === p.runId : r.key === p.sessionKey);
    for (const r of runs) { if (!r.turnId) throw new Error("Task is starting; retry Stop in a moment"); await call("turn/interrupt", { threadId: r.threadId, turnId: r.turnId }); }
    return { ok: true, aborted: runs.length };
  },
  "agent.wait": async (p) => { const end = Date.now() + Math.min(p.timeoutMs || 30000, 60000); while ([...running.values()].some(r => r.runId === p.runId) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 100)); return { status: [...running.values()].some(r => r.runId === p.runId) ? "running" : "done" }; },
  "status": async () => ({ runtime: "Codex app-server", sessions: { recent: sessionList().filter(s => s.updatedAt).map(s => ({ key: s.key, updatedAt: s.updatedAt })), byAgent: state.agents.map(a => ({ agentId: a.id, recent: sessionList().filter(s => s.agentId === a.id && s.updatedAt) })) } }),
  "agents.files.get": async (p) => { const file = path.join(getAgent(p.agentId).workspace, "AGENTS.md"); return { file: p.name === "AGENTS.md" && fs.existsSync(file) ? { content: fs.readFileSync(file, "utf8"), path: file } : { missing: true } }; },
  "agents.files.set": async (p) => { if (p.name !== "AGENTS.md") throw new Error("Only AGENTS.md is supported by this Codex adapter"); const agent = getAgent(p.agentId); assertIdle(agent.id); fs.writeFileSync(path.join(agent.workspace, "AGENTS.md"), p.content || ""); return {}; },
  "cron.list": async () => ({ jobs: [] }),
  "wake": async () => ({ ok: true }),
};

let stopping = false;
const server = http.createServer((_req, res) => { res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: ready, runtime: "Codex app-server", agents: state.agents.length, activeTurns: running.size })); });
const wss = new WebSocketServer({ server, maxPayload: 256 * 1024 });
wss.on("connection", (ws) => {
  let connected = false;
  const send = frame => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame)); };
  send({ type: "event", event: "connect.challenge", payload: { nonce: uid() } });
  ws.on("message", async raw => {
    let frame;
    try { frame = JSON.parse(raw.toString()); } catch { return ws.close(1003, "Invalid JSON"); }
    if (frame.type !== "req" || typeof frame.id !== "string") return;
    const p = frame.params || {};
    try {
      let payload;
      if (frame.method === "connect") {
        const supplied = Buffer.from(p.auth?.token || ""), expected = Buffer.from(TOKEN);
        if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw new Error("Invalid gateway token");
        if (!ready) throw new Error("Codex is starting");
        connected = true; clients.add(ws);
        payload = { type: "hello-ok", protocol: 3, adapterType: "openclaw", server: { version: "codex-minimal-1", connId: uid() },
          features: { methods: Object.keys(methods), events: ["chat", "agent", "presence", "tick"] },
          snapshot: { health: { agents: agentList().map(a => ({ agentId: a.id, name: a.name, isDefault: a.id === state.agents[0].id })), defaultAgentId: state.agents[0].id }, sessionDefaults: { mainKey: "main" } },
          auth: { role: "operator", scopes: ["operator.admin"] }, policy: { maxPayload: 262144, maxBufferedBytes: 1048576, tickIntervalMs: 30000 } };
      } else {
        if (!connected) throw new Error("Connect first");
        if (!methods[frame.method]) throw new Error(`Not included in this minimal Codex adapter: ${frame.method}`);
        payload = await methods[frame.method](p);
      }
      send({ type: "res", id: frame.id, ok: true, payload });
    } catch (error) { send({ type: "res", id: frame.id, ok: false, error: { code: "UNAVAILABLE", message: error.message } }); }
  });
  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
});
setInterval(() => emit("tick", { ts: Date.now() }), 30000).unref();
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { stopping = true; server.close(); for (const ws of clients) ws.close(1001, "Server stopping"); codex.stdin.end(); });
call("initialize", { clientInfo: { name: "claw3d_codex", title: "Claw3D Codex", version: "1.0" } }).then(() => {
  codex.stdin.write(JSON.stringify({ method: "initialized" }) + "\n"); ready = true;
  server.listen(PORT, "127.0.0.1", () => console.log(`[codex-gateway] ws://127.0.0.1:${PORT}; native Codex app-server, no OpenClaw runtime`));
}).catch(error => { console.error(error); codex.stdin.end(); process.exitCode = 1; });
