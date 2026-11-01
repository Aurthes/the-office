#!/usr/bin/env node
// Opt-in integration check: actual Codex, disposable Office state, loopback model.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
const require = createRequire(import.meta.url);
const { saveUpload } = require("../server/codex-session-uploads.js");
const binary = process.argv[process.argv.indexOf("--codex") + 1];
if (!process.argv.includes("--codex") || !binary) throw new Error("Usage: node scripts/check-office-codex.mjs --codex /path/to/codex");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-live-"));
const data = path.join(root, "office"), home = path.join(data, "codex"), workspace = path.join(root, "workspace"), secondary = path.join(root, "repo-b"), excluded = path.join(root, "unattached"), uploads = path.join(root, "uploads"), foreign = path.join(root, "native");
for (const p of [home, workspace, secondary, excluded, foreign]) fs.mkdirSync(p, { recursive: true });
fs.writeFileSync(path.join(foreign, "sentinel"), "native state unchanged");
fs.writeFileSync(path.join(foreign, "AGENTS.md"), "OFFICE_GLOBAL_RULE_MARKER");
fs.writeFileSync(path.join(foreign, "config.toml"), 'model_reasoning_effort="high"\nsqlite_home="/must-not-be-used"\ncli_auth_credentials_store="keyring"\nsandbox_mode="danger-full-access"\n');
const legacySkill = path.join(foreign, "skills", "office-profile-probe"), disabledSkill = path.join(foreign, "skills", "disabled-profile-probe");
fs.mkdirSync(legacySkill, { recursive: true }); fs.mkdirSync(disabledSkill, { recursive: true });
fs.writeFileSync(path.join(legacySkill, "SKILL.md"), '---\nname: office-profile-probe\ndescription: OFFICE_LEGACY_SKILL_MARKER\n---\nA temporary skill used only by the local Office integration fixture.\n');
fs.writeFileSync(path.join(disabledSkill, "SKILL.md"), '---\nname: disabled-profile-probe\ndescription: OFFICE_DISABLED_SKILL_MARKER\n---\nDisabled test fixture.\n');
fs.appendFileSync(path.join(foreign, "config.toml"), `[[skills.config]]\npath=${JSON.stringify(path.join(disabledSkill, "SKILL.md"))}\nenabled=false\n`);
function sourceSnapshot(directory = foreign) {
  return fs.readdirSync(directory).sort().flatMap(name => { const file = path.join(directory, name); return fs.statSync(file).isDirectory() ? sourceSnapshot(file) : [[path.relative(foreign, file), crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")]]; });
}
let sourceBefore = JSON.stringify(sourceSnapshot());
const payloads = [], checks = []; let gateway, socket;
let diagnosticClient, gatewayErrors = "";
const provider = http.createServer((request, response) => {
  let body = ""; request.on("data", data => { body += data; }); request.on("end", () => {
    const payload = JSON.parse(body); payloads.push(payload);
    response.writeHead(200, { "content-type": "text/event-stream" });
    const id = `resp_${payloads.length}`, emit = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
    emit({ type: "response.created", response: { id } });
    const last = [...(payload.input || [])].reverse().find(item => item.role === "user");
    if (JSON.stringify(last).includes("OFFICE_HOLD")) return;
    if (JSON.stringify(last).includes("OFFICE_QUESTION") && !payload.input.some(i => i.type === "function_call_output" && i.call_id === "async-question-1")) {
      const item = { id: "fc_question", type: "function_call", namespace: "functions", name: "request_user_input_async", call_id: "async-question-1", arguments: JSON.stringify({ questions: [{ title: "Choose a test route", options: ["First route", "Second route"] }] }) };
      emit({ type: "response.output_item.done", output_index: 0, item });
      emit({ type: "response.completed", response: { id, output: [item] } }); response.end(); return;
    }
    const item = { id: `msg_${payloads.length}`, type: "message", role: "assistant", content: [{ type: "output_text", text: "OFFICE_CHECK_OK" }] };
    emit({ type: "response.output_item.done", output_index: 0, item });
    emit({ type: "response.completed", response: { id, output: [item], usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 } } }); response.end();
  });
});
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(predicate, label, timeout = 20000) { const end = Date.now() + timeout; while (!predicate()) { if (Date.now() > end) throw new Error(label); await pause(20); } }
function check(name, pass) { if (!pass) throw new Error(name); checks.push(name); console.log(JSON.stringify({ check: name, passed: true })); }
class BrowserClient {
  constructor(ws) {
    this.ws = ws; this.pending = new Map(); this.serial = 0; this.events = [];
    ws.on("message", raw => { const f = JSON.parse(String(raw)); if (f.type === "event") return this.events.push(f); const p = this.pending.get(f.id); if (!p) return; clearTimeout(p.timer); this.pending.delete(f.id); if (f.ok) p.resolve(f.payload); else p.reject(new Error(f.error?.message)); });
  }
  call(method, params = {}) { return new Promise((resolve, reject) => { const id = String(++this.serial), timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 20000); this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ type: "req", id, method, params })); }); }
}
const token = crypto.randomBytes(32).toString("hex"); let port;
async function start(useBundled = false) {
  const env = { ...process.env, CODEX_HOME: foreign, CLAW3D_CODEX_CONFIG_HOME: foreign, CODEX_SQLITE_HOME: foreign, CODEX_APP_SERVER_WS_URL: "ws://127.0.0.1:1", CLAW3D_GATEWAY_TOKEN: token, CLAW3D_CODEX_BIN: binary, CLAW3D_OFFICE_DATA_DIR: data, CLAW3D_OFFICE_CODEX_HOME: home, CLAW3D_UPLOAD_DIR: uploads, CODEX_ADAPTER_PORT: String(port) };
  delete env.OPENAI_API_KEY;
  if (useBundled) delete env.CLAW3D_CODEX_BIN;
  gateway = spawn(process.execPath, [fileURLToPath(new URL("../server/codex-office-gateway.js", import.meta.url))], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", exited = false; gateway.stdout.on("data", data => { output += data; }); gateway.stderr.on("data", data => { gatewayErrors = (gatewayErrors + data).slice(-3000); }); gateway.once("exit", () => { exited = true; });
  await until(() => output.includes("runtime ready") || exited, "Office gateway did not start"); if (exited) throw new Error("Office gateway exited before readiness");
  socket = new WebSocket(`ws://127.0.0.1:${port}`); const client = new BrowserClient(socket); await once(socket, "open");
  await client.call("connect", { auth: { token } }); diagnosticClient = client; return client;
}
async function stop() {
  socket?.terminate();
  if (!gateway || gateway.exitCode !== null) return;
  gateway.kill("SIGTERM"); await until(() => gateway.exitCode !== null, "Gateway cleanup failed", 10000);
}
try {
  provider.listen(0, "127.0.0.1"); await once(provider, "listening");
  fs.writeFileSync(path.join(home, "config.toml"), `model = "gpt-6.1-sol"\nmodel_provider = "office_check"\n[model_providers.office_check]\nname = "Local test fixture"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`);
  const portProbe = net.createServer(); portProbe.listen(0, "127.0.0.1"); await once(portProbe, "listening"); port = portProbe.address().port; await new Promise(r => portProbe.close(r));
  let client = await start(true);
  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  check("configuration is automatically discovered", health.configuration.rules.some(r => r.name === "AGENTS.md" && r.status === "shared") && health.configuration.defaults.includes("model_reasoning_effort") && health.configuration.warnings.length === 0);
  check("clean independent roster", (await client.call("office.snapshot")).agents.length === 0);
  const { project } = await client.call("project.create", { name: "Check project", rootPaths: [workspace, secondary], requestId: "project-1" });
  check("project references multiple existing folders", project.rootPaths.length === 2 && project.rootPaths[0] === fs.realpathSync(workspace));
  check("host folder picker uses public directory API", (await client.call("project.folders.list", { path: root })).entries.includes("repo-b"));
  const { threadId } = await client.call("session.create", { name: "Check chat", projectId: project.id, requestId: "session-1" });
  check("empty chat is durable Office state", (await client.call("session.inspect", { threadId })).messages.length === 0);
  await stop(); client = await start();
  check("empty chat survives restart", (await client.call("office.snapshot")).agents[0].id === threadId);
  const choices = await client.call("session.settings.choices", { threadId });
  check("model and access catalogs", choices.models.length > 0 && choices.accessModes.some(p => p.id === ":read-only"));
  await client.call("session.settings.update", { threadId, settings: { accessMode: ":read-only", model: choices.models[0].id } });
  fs.writeFileSync(path.join(workspace, "check.txt"), "OFFICE_FILE_OK");
  check("public workspace listing and file read", (await client.call("session.workspace.list", { threadId, path: "" })).entries.some(e => e.name === "check.txt") && (await client.call("session.workspace.read", { threadId, path: "check.txt" })).content === "OFFICE_FILE_OK");
  fs.writeFileSync(path.join(secondary, "secondary.txt"), "SECONDARY_OK");
  check("select and read secondary repo", (await client.call("session.workspace.list", { threadId, root: fs.realpathSync(secondary), path: "" })).entries.some(e => e.name === "secondary.txt") && (await client.call("session.workspace.read", { threadId, root: fs.realpathSync(secondary), path: "secondary.txt" })).content === "SECONDARY_OK");
  let outsideRejected = false;
  try { await client.call("session.workspace.list", { threadId, root: excluded, path: "" }); } catch { outsideRejected = true; }
  check("unattached file-browser root is rejected", outsideRejected);
  await client.call("session.terminal.subscribe", { threadId });
  const terminal = await client.call("session.terminal.start", { threadId });
  await client.call("session.terminal.write", { threadId, handle: terminal.handle, dataBase64: Buffer.from("printf 'OFFICE_%s_OK\\n' 'TERMINAL'\n").toString("base64") });
  await until(() => client.events.filter(e => e.event === "session.terminal").map(e => Buffer.from(e.payload.dataBase64 || "", "base64").toString()).join("").includes("OFFICE_TERMINAL_OK"), "No terminal output");
  await client.call("session.terminal.resize", { threadId, handle: terminal.handle, cols: 100, rows: 30 });
  await client.call("session.terminal.stop", { threadId, handle: terminal.handle });
  check("public terminal execution, write, resize and stop", true);
  await client.call("session.subscribe", { threadId, subscriptionId: "check-1" });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGMwqthCEmIY1TCqYfhqAACQaV4Qe+XGAAAAAABJRU5ErkJggg==", "base64");
  const attachment = await saveUpload(new Request("http://localhost/upload", { method: "POST", body: png }), threadId, "check.png", { root: uploads, key: token });
  await client.call("session.send", { threadId, message: "OFFICE_FIRST_MARKER", attachments: [attachment.ref], requestId: "send-1" });
  // Item updates and completion may arrive in separate bounded stream frames.
  await until(() => client.events.some(e => e.event === "session.stream" && e.payload.items.some(i => i.content === "OFFICE_CHECK_OK")) && client.events.some(e => e.event === "session.stream" && e.payload.turnStatus === "completed"), "No streamed reply");
  const imagePresent = payloads.some(p => JSON.stringify(p.input).includes("input_image"));
  if (!imagePresent) console.log(JSON.stringify({ diagnostic: payloads.map(p => ({ model: p.model, userContent: p.input?.filter(i => i.role === "user").flatMap(i => i.content || []).map(c => ({ type: c.type, text: c.text?.slice(-350) })) })) }));
  check("actual Codex reply and image input", imagePresent);
  check("Codex loads shared global instructions", JSON.stringify(payloads.at(-1).input).includes("OFFICE_GLOBAL_RULE_MARKER"));
  check("Codex discovers legacy skills through the public extra-roots API", JSON.stringify(payloads.at(-1).input).includes("OFFICE_LEGACY_SKILL_MARKER"));
  check("source per-skill disables remain effective", !JSON.stringify(payloads.at(-1).input).includes("OFFICE_DISABLED_SKILL_MARKER"));
  check("project context reaches Codex without appearing as a user message", payloads.some(p => p.input?.some(i => i.role === "developer" && JSON.stringify(i).includes(fs.realpathSync(secondary)))) && !(await client.call("session.history", { threadId })).messages.some(m => m.content.includes("Current Office project context")));
  await client.call("project.update", { projectId: project.id, name: "Updated project", rootPaths: [workspace], requestId: "remove-secondary" });
  check("saved history", (await client.call("session.history", { threadId })).messages.some(m => m.content === "OFFICE_CHECK_OK"));
  const originalNativeId = JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].codexThreadId;
  fs.writeFileSync(path.join(foreign, "AGENTS.md"), "OFFICE_UPDATED_GLOBAL_RULE_MARKER"); sourceBefore = JSON.stringify(sourceSnapshot());
  await stop(); client = await start();
  await client.call("session.send", { threadId, message: "OFFICE_SECOND_MARKER", requestId: "send-2" });
  await until(() => payloads.length >= 2, "Continuation did not reach the provider");
  check("resumed chats load updated shared rules after restart", JSON.stringify(payloads.at(-1).input).includes("OFFICE_UPDATED_GLOBAL_RULE_MARKER"));
  const contexts = payloads.at(-1).input.filter(i => i.role === "developer" && JSON.stringify(i).includes("Current Office project context"));
  check("project edits replace folder context after restart", contexts.length > 0 && !JSON.stringify(contexts.at(-1)).includes(fs.realpathSync(secondary)));
  await until(() => JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].status === "idle", "Second turn did not finish");
  await client.call("project.update", { projectId: project.id, name: "Updated project", rootPaths: [secondary], workspaces: { [threadId]: fs.realpathSync(secondary) }, requestId: "replace-cwd" });
  check("cwd replacement keeps conversation identity", (await client.call("session.inspect", { threadId, includeHistory: false })).workspace === fs.realpathSync(secondary));
  check("restart retains model-visible history and identity", JSON.stringify(payloads.at(-1).input).includes("OFFICE_FIRST_MARKER") && JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].codexThreadId === originalNativeId);
  await client.call("session.send", { threadId, message: "OFFICE_QUESTION", requestId: "send-question" });
  await until(() => JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].pendingQuestions?.length > 0, "No structured async question from actual Codex");
  await until(() => JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].status === "idle", "Question turn did not finish");
  let question = (await client.call("session.attach", { threadId })).questions[0];
  check("public asynchronous questions retain their choices", question.questions[0].options[1].label === "Second route");
  check("pending question sets yellow input marker", (await client.call("office.snapshot")).agents[0].needsInput === true);
  await stop(); client = await start();
  question = (await client.call("session.attach", { threadId })).questions[0];
  check("pending choice cards survive gateway restart", question.requestId === "async:async-question-1");
  await client.call("session.question.reply", { threadId, promptId: question.requestId, requestId: "answer-question", answers: { [question.questions[0].id]: "Second route" } });
  await until(() => JSON.stringify(payloads.at(-1).input).includes("Second route") && JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].status === "idle", "Choice answer did not reach Codex");
  check("choice reply reaches the same conversation and clears its input marker", !(await client.call("office.snapshot")).agents[0].needsInput && (await client.call("session.attach", { threadId })).questions.length === 0);
  check("completed result is available for browser unread marker", (await client.call("office.snapshot")).agents[0].completedResult?.unread === true);
  await client.call("session.send", { threadId, message: "OFFICE_HOLD", requestId: "send-3" });
  await until(() => JSON.stringify(payloads.at(-1)).includes("OFFICE_HOLD"), "Hold did not start");
  check("stop own active turn", (await client.call("session.stop", { threadId })).status === "interruptRequested");
  await until(() => JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].status === "idle", "Interrupted turn did not finish");
  check("interrupted turn is available for Play", (await client.call("session.attach", { threadId })).turnStatus === "interrupted" && !(await client.call("office.snapshot")).agents[0].completedResult);
  await client.call("session.continue", { threadId, requestId: "play-continue" });
  await until(() => JSON.stringify(payloads.at(-1).input).includes("Continue where you left off.") && JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].status === "idle", "Play continuation did not finish");
  check("Play continues with original history and native identity", JSON.stringify(payloads.at(-1).input).includes("OFFICE_FIRST_MARKER") && JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].codexThreadId === originalNativeId);
  await client.call("session.archive", { threadId, requestId: "archive-1" });
  check("own archive", (await client.call("office.snapshot")).agents.length === 0);
  check("foreign state untouched", JSON.stringify(sourceSnapshot()) === sourceBefore);
  console.log(JSON.stringify({ passed: checks.length, syntheticModelOnly: true, userAppHomeUsed: false }));
} catch (error) {
  console.log(JSON.stringify({ diagnostic: { error: error.message, socketState: socket?.readyState, requests: payloads.length, events: diagnosticClient?.events.slice(-8).map(e => ({ event: e.event, turnStatus: e.payload?.turnStatus, error: e.payload?.error, itemCount: e.payload?.items?.length })), gatewayErrors } }));
  throw error;
} finally {
  await stop(); provider.closeAllConnections(); await new Promise(r => provider.close(r));
  if (!gateway || gateway.exitCode !== null) fs.rmSync(root, { recursive: true, force: true });
}
