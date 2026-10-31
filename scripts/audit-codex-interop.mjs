#!/usr/bin/env node
// Opt-in compatibility experiment. Every writer uses a fresh temporary Codex
// home and a loopback synthetic model. Never opens the user's Codex databases.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { WebSocket } from "ws";

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const binary = args.includes("--codex") ? option("--codex") : process.env.CLAW3D_NATIVE_CODEX_BIN;
const output = args.includes("--output") ? path.resolve(option("--output")) : null;
if (!binary || !output) {
  console.error("Usage: node scripts/audit-codex-interop.mjs --codex /path/to/codex --output /path/to/results.json");
  process.exit(2);
}
const version = execFileSync(binary, ["--version"], { encoding: "utf8" }).trim();
const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-codex-interop-"));
fs.chmodSync(root, 0o700);
const workspace = path.join(root, "workspace");
fs.mkdirSync(workspace);
const results = { version, experimentalApi: false, experimentalProjectsInSeparateHome: true, syntheticModelOnly: true, userHomeUsed: false, checks: [], processesCleaned: false };
const processes = [], clients = [], requests = [];
const held = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function record(name, outcome, evidence) {
  results.checks.push({ name, outcome, evidence });
  console.log(JSON.stringify(results.checks.at(-1)));
}
async function until(predicate, message, timeout = 10000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(message);
    await pause(20);
  }
}

class Client {
  constructor(socket) {
    this.events = []; this.pending = new Map(); this.serial = 0;
    this.ws = new WebSocket(`ws+unix://${socket}:/rpc`, { handshakeTimeout: 3000 });
    this.ws.on("error", () => {});
    this.ws.on("message", raw => {
      const frame = JSON.parse(String(raw));
      if (frame.method) { this.events.push(frame); return; }
      const entry = this.pending.get(frame.id);
      if (!entry) return;
      clearTimeout(entry.timer); this.pending.delete(frame.id);
      if (frame.error) entry.reject(Object.assign(new Error(frame.error.message), { code: frame.error.code }));
      else entry.resolve(frame.result);
    });
    this.ws.on("close", () => {
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error("Audit connection closed")); }
      this.pending.clear();
    });
    clients.push(this);
  }
  async ready(experimentalApi = false) {
    if (this.ws.readyState !== WebSocket.OPEN) await once(this.ws, "open");
    await this.call("initialize", { clientInfo: { name: "the_office_interop_audit", title: "Office interoperability audit", version: "1" }, capabilities: { experimentalApi } });
    this.ws.send(JSON.stringify({ method: "initialized" }));
    return this;
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Audit RPC timed out: ${method}`)); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async completed(id) {
    await until(() => this.events.some(e => e.method === "turn/completed" && e.params?.turn?.id === id), "Synthetic turn did not complete");
    const turn = this.events.find(e => e.method === "turn/completed" && e.params?.turn?.id === id).params.turn;
    if (turn.status !== "completed") throw new Error(`Synthetic turn ${turn.status}: ${JSON.stringify(turn.error)}`);
  }
  close() { this.ws.terminate(); }
}

const provider = http.createServer((request, response) => {
  let body = "";
  request.on("data", data => { body += String(data); });
  request.on("end", () => {
    const payload = JSON.parse(body);
    requests.push(payload);
    const n = requests.length, id = `response_${n}`;
    response.writeHead(200, { "content-type": "text/event-stream" });
    const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
    event({ type: "response.created", response: { id } });
    const finish = () => {
      if (response.destroyed) return;
      const item = { id: `message_${n}`, type: "message", role: "assistant", content: [{ type: "output_text", text: `AUDIT_REPLY_${n}` }] };
      event({ type: "response.output_item.done", output_index: 0, item });
      event({ type: "response.completed", response: { id, output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
      response.end();
    };
    const lastUser = [...(payload.input || [])].reverse().find(item => item.role === "user");
    if (JSON.stringify(lastUser).includes("AUDIT_HOLD_TURN")) held.push(finish); else finish();
  });
});

function home(name, port) {
  const directory = path.join(root, name); fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "config.toml"), `model = "interop-fixture"\nmodel_provider = "interop_fixture"\napproval_policy = "on-request"\nsandbox_mode = "read-only"\n[model_providers.interop_fixture]\nname = "Loopback interoperability fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`, { mode: 0o600 });
  return directory;
}
async function start(name, codexHome, experimentalApi = false) {
  const socket = path.join(root, `${name}.sock`);
  const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "SHELL", "LANG"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  env.CODEX_HOME = codexHome;
  const child = spawn(binary, ["app-server", "--listen", `unix://${socket}`], { cwd: workspace, env, stdio: ["ignore", "ignore", "pipe"] });
  const server = { child, socket, stderr: "", exited: false };
  child.stderr.on("data", data => { server.stderr = (server.stderr + String(data)).slice(-8000); });
  child.once("exit", () => { server.exited = true; });
  child.once("error", error => { server.stderr = error.message; server.exited = true; });
  processes.push(server);
  await until(() => fs.existsSync(socket) || server.exited, `Server ${name} did not create its socket`);
  if (server.exited) throw new Error(server.stderr);
  server.client = await new Client(socket).ready(experimentalApi);
  return server;
}
async function stop(server) {
  if (server.exited) return;
  server.client?.close(); server.child.kill("SIGTERM");
  await until(() => server.exited, "Audit server did not exit");
}
const threadList = client => client.call("thread/list", { limit: 50, cwd: workspace, modelProviders: [], sourceKinds: [] });
const readThread = (client, id) => client.call("thread/read", { threadId: id, includeTurns: false });
const turn = (client, id, text) => client.call("turn/start", { threadId: id, input: [{ type: "text", text }] });

async function main() {
  provider.listen(0, "127.0.0.1"); await once(provider, "listening");
  const port = provider.address().port, sharedHome = home("shared-home", port);
  const a = await start("a", sharedHome), b = await start("b", sharedHome);
  const created = await a.client.call("thread/start", { cwd: workspace, sandbox: "read-only", approvalPolicy: "on-request" });
  const id = created.thread.id;
  await a.client.call("thread/name/set", { threadId: id, name: "Office audit fixture" });
  const first = await turn(a.client, id, "AUDIT_FIRST_TURN"); await a.client.completed(first.turn.id);
  const listed = await threadList(b.client);
  record("separate-process-saved-session-visible", listed.data.some(t => t.id === id) ? "pass" : "fail", { matches: listed.data.filter(t => t.id === id).length });
  const history = await b.client.call("thread/turns/list", { threadId: id, limit: 10, itemsView: "full" });
  record("separate-process-saved-history-readable", history.data.some(t => t.id === first.turn.id) ? "pass" : "fail", { turns: history.data.length });

  const before = a.client.events.length;
  await b.client.call("thread/name/set", { threadId: id, name: "Renamed by B" });
  await pause(300);
  const aRead = await readThread(a.client, id);
  record("rename-B-to-A-readback", aRead.thread.name === "Renamed by B" ? "pass" : "diverged", { observedName: aRead.thread.name });
  record("cross-process-rename-push", a.client.events.slice(before).some(e => e.method === "thread/name/updated") ? "observed" : "not-observed", { observationMs: 300 });
  await a.client.call("thread/name/set", { threadId: id, name: "Renamed by A" });
  const bRead = await readThread(b.client, id);
  record("rename-A-to-B-readback", bRead.thread.name === "Renamed by A" ? "pass" : "diverged", { observedName: bRead.thread.name });

  // Demonstrate the documented experimental gate without enabling it.
  const projects = await b.client.call("project/list", {}).then(r => ({ accepted: true, result: r }), error => ({ accepted: false, code: error.code, message: error.message }));
  record("project-API-without-experimental-opt-in", projects.accepted ? "unexpectedly-accepted" : "rejected", projects);

  const heldTurn = await turn(a.client, id, "AUDIT_HOLD_TURN");
  await until(() => held.length > 0, "Held fixture did not reach the local provider");
  const competing = await b.client.call("thread/resume", { threadId: id, excludeTurns: true }).then(r => ({ accepted: true, status: r.thread.status }), error => ({ accepted: false, code: error.code, message: error.message }));
  record("resume-while-another-process-executes", competing.accepted ? "accepted-unsafe-for-independent-execution" : "blocked", competing);
  held.splice(0).forEach(release => release()); await a.client.completed(heldTurn.turn.id);
  const idleResume = await b.client.call("thread/resume", { threadId: id, excludeTurns: true }).then(r => ({ accepted: true, status: r.thread.status }), error => ({ accepted: false, code: error.code, message: error.message }));
  record("resume-after-turn-idle-but-owner-loaded", idleResume.accepted ? "accepted" : "blocked-until-owner-releases", idleResume);

  await stop(a);
  const resumed = await b.client.call("thread/resume", { threadId: id, excludeTurns: true });
  const continued = await turn(b.client, id, "AUDIT_CONTINUE_ON_B"); await b.client.completed(continued.turn.id);
  const continuedHistory = await b.client.call("thread/turns/list", { threadId: id, limit: 10, itemsView: "full" });
  record("sequential-handoff-after-owner-exits", resumed.thread.id === id && continuedHistory.data.some(t => t.id === first.turn.id) && continuedHistory.data.some(t => t.id === continued.turn.id) ? "pass" : "fail", { sameThreadId: resumed.thread.id === id, turns: continuedHistory.data.length });
  const continuedBody = requests.at(-1);
  record("handoff-retains-model-visible-history", JSON.stringify(continuedBody.input).includes("AUDIT_FIRST_TURN") ? "pass" : "fail", { originalPromptPresent: JSON.stringify(continuedBody.input).includes("AUDIT_FIRST_TURN") });

  await b.client.call("thread/archive", { threadId: id });
  const c = await start("c", sharedHome);
  const archived = await c.client.call("thread/list", { archived: true, limit: 50, modelProviders: [], sourceKinds: [] });
  record("archive-visible-to-fresh-reader", archived.data.some(t => t.id === id) ? "pass" : "fail", {});
  await b.client.call("thread/unarchive", { threadId: id });
  record("unarchive-visible-to-other-process", (await threadList(c.client)).data.some(t => t.id === id) ? "pass" : "fail", {});
  await stop(b);
  await c.client.call("thread/name/set", { threadId: id, name: "Reverse handoff" });
  await c.client.call("thread/archive", { threadId: id });
  const d = await start("d", sharedHome);
  const reverse = await d.client.call("thread/list", { archived: true, limit: 50, modelProviders: [], sourceKinds: [] });
  record("reverse-rename-and-archive-after-release", reverse.data.some(t => t.id === id && t.name === "Reverse handoff") ? "pass" : "fail", {});

  const isolated = await start("isolated", home("independent-home", port));
  record("independent-home-separates-sessions", (await threadList(isolated.client)).data.some(t => t.id === id) ? "fail" : "pass", {});
  const secondClient = await new Client(d.socket).ready();
  const fresh = await d.client.call("thread/start", { cwd: workspace, sandbox: "read-only", approvalPolicy: "on-request" });
  const empty = await secondClient.call("thread/resume", { threadId: fresh.thread.id, excludeTurns: true }).then(() => ({ resumed: true }), error => ({ resumed: false, message: error.message }));
  record("empty-thread-durability-before-first-turn", empty.resumed ? "resumed" : "not-yet-persisted", empty);
  const seed = await turn(d.client, fresh.thread.id, "AUDIT_PERSIST_SAME_SERVER_FIXTURE"); await d.client.completed(seed.turn.id);
  const observerBefore = secondClient.events.length;
  await secondClient.call("thread/resume", { threadId: fresh.thread.id, excludeTurns: true });
  const sharedTurn = await turn(d.client, fresh.thread.id, "AUDIT_SAME_SERVER"); await d.client.completed(sharedTurn.turn.id);
  await pause(100);
  record("two-clients-one-server-turn-push", secondClient.events.slice(observerBefore).some(e => e.method === "turn/completed" && e.params?.turn?.id === sharedTurn.turn.id) ? "pass" : "not-observed", {});

  // Experimental project mechanics are tested only in another disposable home.
  // Success here does not establish a Desktop sidebar synchronization contract.
  const projectHome = home("experimental-project-home", port);
  const projectA = await start("project-a", projectHome, true);
  const projectB = await start("project-b", projectHome, true);
  const project = (await projectA.client.call("project/create", { idempotencyKey: "office-project-fixture", name: "Project fixture", roots: [{ path: workspace }] })).project;
  const projectList = await projectB.client.call("project/list", {});
  const projectRead = await projectB.client.call("project/read", { projectId: project.id });
  record("experimental-project-create-list-read", projectList.data.some(p => p.id === project.id) && projectRead.project.id === project.id ? "pass" : "fail", { experimentalApi: true, sameHomePeers: true });
  await projectB.client.call("project/update", { projectId: project.id, name: "Renamed project fixture" });
  const projectUpdated = await projectA.client.call("project/read", { projectId: project.id });
  record("experimental-project-update-readback", projectUpdated.project.name === "Renamed project fixture" ? "pass" : "fail", { experimentalApi: true });
  const member = (await projectA.client.call("thread/start", { projectId: project.id, cwd: workspace, sandbox: "read-only", approvalPolicy: "on-request" })).thread;
  const memberTurn = await turn(projectA.client, member.id, "AUDIT_PROJECT_MEMBER"); await projectA.client.completed(memberTurn.turn.id);
  const members = await projectB.client.call("thread/list", { projectId: project.id, modelProviders: [], sourceKinds: [] });
  record("experimental-project-thread-membership", members.data.some(t => t.id === member.id) ? "pass" : "fail", { experimentalApi: true, projectIdOnStartResponse: member.projectId === project.id });
  await projectB.client.call("project/delete", { projectId: project.id });
  const projectsAfterDelete = await projectA.client.call("project/list", {});
  const memberAfterDelete = await readThread(projectB.client, member.id);
  record("experimental-project-delete", projectsAfterDelete.data.some(p => p.id === project.id) ? "fail" : "pass", { experimentalApi: true, memberThreadStillReadable: memberAfterDelete.thread.id === member.id, memberProjectId: memberAfterDelete.thread.projectId ?? null });
}

main().catch(error => { results.error = error.stack; process.exitCode = 1; }).finally(async () => {
  held.splice(0).forEach(release => release());
  clients.forEach(client => client.close());
  const cleanup = await Promise.allSettled(processes.map(stop));
  results.processesCleaned = processes.every(server => server.exited);
  results.cleanupErrors = cleanup.filter(r => r.status === "rejected").map(r => r.reason.message);
  provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(results, null, 2) + "\n");
  if (!results.processesCleaned) process.exitCode = 1;
  if (results.checks.some(check => ["fail", "diverged", "unexpectedly-accepted", "accepted-unsafe-for-independent-execution"].includes(check.outcome))) process.exitCode = 1;
  if (results.processesCleaned) fs.rmSync(root, { recursive: true, force: true });
  console.log(JSON.stringify({ resultFile: output, processesCleaned: results.processesCleaned, error: results.error || null }));
});
