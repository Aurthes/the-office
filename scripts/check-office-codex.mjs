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
const appDirectory = process.argv.includes("--app-dir") ? path.resolve(process.argv[process.argv.indexOf("--app-dir") + 1]) : fileURLToPath(new URL("..", import.meta.url));
const runtimeRequire = createRequire(path.join(appDirectory, "package.json"));
const { saveUpload } = runtimeRequire("./server/codex-session-uploads.js");
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
const payloads = [], checks = []; let gateway, socket, referenceTargetId;
let diagnosticClient, gatewayErrors = "";
const provider = http.createServer((request, response) => {
  let body = ""; request.on("data", data => { body += data; }); request.on("end", () => {
    const payload = JSON.parse(body); payloads.push(payload);
    const last = [...(payload.input || [])].reverse().find(item => item.role === "user");
    if (JSON.stringify(last).includes("OFFICE_GENERIC_FAILURE")) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Synthetic non-capacity failure", type: "invalid_request_error", code: "synthetic_error" } })); return;
    }
    if (JSON.stringify(last).includes("OFFICE_CAPACITY")) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Selected model is at capacity. Please try a different model.", type: "server_error", code: "server_is_overloaded" } })); return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    const id = `resp_${payloads.length}`, emit = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
    emit({ type: "response.created", response: { id } });
    if (JSON.stringify(last).includes("OFFICE_HOLD")) return;
    const referenceMarker = JSON.stringify(last).match(/OFFICE_READ_REFERENCE(?:_RESTART|_FORK)?/)?.[0];
    const referenceCallId = referenceMarker && "read-" + referenceMarker;
    if (referenceCallId && !payload.input.some(item => item.type === "function_call_output" && item.call_id === referenceCallId)) {
      const item = { id: "reference-call-" + payloads.length, type: "function_call", namespace: "office", name: "read_thread", call_id: referenceCallId, arguments: JSON.stringify({ threadId: referenceTargetId }) };
      emit({ type: "response.output_item.done", output_index: 0, item });
      emit({ type: "response.completed", response: { id, output: [item] } }); response.end(); return;
    }
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
  gateway = spawn(process.execPath, [path.join(appDirectory, "server/codex-office-gateway.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
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
  fs.writeFileSync(path.join(home, "config.toml"), `model = "gpt-6.1-sol"\nmodel_provider = "office_check"\n[model_providers.office_check]\nname = "Local test fixture"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n`);
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
  check("file references use the pinned native fuzzy-file search", (await client.call("session.composer.options", { threadId, kind: "file", query: "check" })).options.some(option => option.id === path.join(fs.realpathSync(workspace), "check.txt")));
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
  const timedHistory = (await client.call("session.history", { threadId })).messages.filter(m => ["user", "assistant"].includes(m.role) && m.content.trim());
  check("user and Codex message times come from persisted item records", timedHistory.some(m => m.role === "user") && timedHistory.some(m => m.role === "assistant") && timedHistory.every(m => Number.isFinite(m.timestamp) && m.timestamp > 0 && m.timestamp <= Date.now()));
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
  const firstTurnId=timedHistory.find(message=>message.role==="user"&&message.content.includes("OFFICE_FIRST_MARKER"))?.turnId;
  check("history exposes an official completed-turn fork boundary", Boolean(firstTurnId));
  const past=await client.call("session.fork",{threadId,lastTurnId:firstTurnId,requestId:"fork-at-first-turn"});
  const pastHistory=(await client.call("session.history",{threadId:past.threadId})).messages;
  check("historical fork keeps earlier messages and excludes later messages",pastHistory.some(message=>message.content.includes("OFFICE_FIRST_MARKER"))&&!pastHistory.some(message=>message.content.includes("OFFICE_SECOND_MARKER")));
  await client.call("session.send",{threadId:past.threadId,message:"OFFICE_PAST_FORK_PROBE",requestId:"past-fork-probe"});
  await until(()=>JSON.stringify(payloads.at(-1).input).includes("OFFICE_PAST_FORK_PROBE")&&JSON.parse(fs.readFileSync(path.join(data,"office.json"))).sessions.find(row=>row.id===past.threadId)?.status==="idle","Historical fork probe did not finish");
  check("actual forked model context excludes conversation after the selected turn",JSON.stringify(payloads.at(-1).input).includes("OFFICE_FIRST_MARKER")&&!JSON.stringify(payloads.at(-1).input).includes("OFFICE_SECOND_MARKER"));
  check("historical fork does not add its new messages to the source",!(await client.call("session.history",{threadId})).messages.some(message=>message.content.includes("OFFICE_PAST_FORK_PROBE")));
  await client.call("session.archive",{threadId:past.threadId,requestId:"archive-past-fork"});
  await client.call("session.send", { threadId, message: "OFFICE_QUESTION", requestId: "send-question" });
  await until(() => JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].pendingQuestions?.length > 0, "No structured async question from actual Codex");
  await until(() => JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].status === "idle", "Question turn did not finish");
  let question = (await client.call("session.attach", { threadId })).questions[0];
  check("public asynchronous questions retain their choices", question.questions[0].options[1].label === "Second route");
  check("pending question sets yellow input marker", (await client.call("office.snapshot")).agents[0].needsInput === true);
  await stop(); client = await start();
  question = (await client.call("session.attach", { threadId })).questions[0];
  check("pending choice cards survive gateway restart", question.requestId === "async:async-question-1");
  const answerTurn = await client.call("session.question.reply", { threadId, promptId: question.requestId, requestId: "answer-question", answers: { [question.questions[0].id]: "Second route" } });
  await until(() => JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].completionKey === answerTurn.turnId, "Choice answer did not finish");
  check("choice answer reaches Codex as a user reply", payloads.at(-1).input.some(i => i.role === "user" && JSON.stringify(i).includes("send_user_message_question_reply") && JSON.stringify(i).includes("Second route")));
  check("choice reply reaches the same conversation and clears its input marker", !(await client.call("office.snapshot")).agents[0].needsInput && (await client.call("session.attach", { threadId })).questions.length === 0);
  check("completed result is available for browser unread marker", (await client.call("office.snapshot")).agents[0].completedResult?.unread === true);
  await client.call("session.subscribe", { threadId, subscriptionId: "capacity-check" });
  const capacityStart = Date.now();
  await client.call("session.send", { threadId, message: "OFFICE_CAPACITY", requestId: "capacity-send" });
  await until(() => client.events.some(e => e.event === "session.stream" && e.payload.subscriptionId === "capacity-check" && e.payload.retryAt), "Capacity failure did not schedule recovery");
  check("capacity failure waits 15 seconds without a red error marker", (await client.call("office.snapshot")).agents[0].status === "running" && (await client.call("session.attach", { threadId })).retryAt >= capacityStart + 15000);
  await client.call("session.unsubscribe", { subscriptionId: "capacity-check" });
  await until(() => JSON.stringify(payloads.at(-1).input.filter(i => i.role === "user").at(-1)).includes("Continue where you left off.") && JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].status === "idle", "Background capacity recovery did not finish", 25000);
  const capacityHistory = (await client.call("session.history", { threadId })).messages;
  check("capacity recovery continues once after 15 seconds without an open chat", Date.now() - capacityStart >= 15000 && capacityHistory.filter(m => m.role === "user" && m.content === "OFFICE_CAPACITY").length === 1 && capacityHistory.filter(m => m.role === "user" && m.content === "Continue where you left off.").length === 1 && JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].codexThreadId === originalNativeId);
  await client.call("session.send", { threadId, message: "OFFICE_GENERIC_FAILURE", requestId: "generic-failure" });
  await until(() => JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].turnStatus === "failed", "Generic failure was not persisted");
  await stop(); client = await start();
  check("non-capacity failure is queued for recovery after gateway restart", (await client.call("office.snapshot")).agents[0].status === "running");
  await until(() => JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].status === "idle", "Generic failure did not recover after restart", 25000);
  const genericHistory = (await client.call("session.history", { threadId })).messages;
  check("restart recovery does not replay the failed user input", genericHistory.filter(m => m.role === "user" && m.content === "OFFICE_GENERIC_FAILURE").length === 1 && genericHistory.filter(m => m.role === "user" && m.content === "Continue where you left off.").length === 2);
  await client.call("session.send", { threadId, message: "OFFICE_HOLD", requestId: "send-3" });
  await until(() => JSON.stringify(payloads.at(-1)).includes("OFFICE_HOLD"), "Hold did not start");
  const runningTiming = await client.call("session.attach", { threadId });
  let runningForkRejected=false;
  try{await client.call("session.fork",{threadId,lastTurnId:runningTiming.activeTurnId,requestId:"fork-at-running-turn"});}catch{runningForkRejected=true;}
  check("in-progress historical fork is rejected without creating an Office agent",runningForkRejected&&(await client.call("office.snapshot")).agents.length===1);
  check("running task exposes its original native start time", Boolean(runningTiming.activeTurnId) && Number.isFinite(runningTiming.activeTurnStartedAt) && runningTiming.activeTurnStartedAt > 0 && runningTiming.activeTurnStartedAt <= Date.now());
  await client.call("session.subscribe", { threadId, subscriptionId: "timing-resubscribe" });
  await until(() => client.events.some(event => event.event === "session.stream" && event.payload.subscriptionId === "timing-resubscribe"), "No timing resubscription snapshot");
  check("reopening the task stream preserves elapsed-time origin", client.events.findLast(event => event.event === "session.stream" && event.payload.subscriptionId === "timing-resubscribe").payload.activeTurnStartedAt === runningTiming.activeTurnStartedAt);
  check("stop own active turn", (await client.call("session.stop", { threadId })).status === "interruptRequested");
  // Interrupted sessions deliberately keep the red attention marker, not idle.
  await until(() => JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].turnStatus === "interrupted", "Interrupted turn was not persisted");
  check("interrupted turn is available for Play", (await client.call("session.attach", { threadId })).turnStatus === "interrupted" && !(await client.call("office.snapshot")).agents[0].completedResult);
  await stop(); client = await start();
  check("explicit Stop survives gateway restart without automatic recovery", (await client.call("session.attach", { threadId })).retryAt === null && (await client.call("office.snapshot")).agents[0].status === "error");
  await client.call("session.continue", { threadId, requestId: "play-continue" });
  await until(() => JSON.stringify(payloads.at(-1).input).includes("Continue where you left off.") && JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].status === "idle", "Play continuation did not finish");
  check("Play continues with original history and native identity", JSON.stringify(payloads.at(-1).input).includes("OFFICE_FIRST_MARKER") && JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].codexThreadId === originalNativeId);
  await client.call("session.send", { threadId, message: "OFFICE_HOLD", requestId: "restart-running" });
  await until(() => JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].status === "running", "Restart fixture was not running");
  await stop(); client = await start();
  check("backend interruption is queued without Play or opening the chat", (await client.call("office.snapshot")).agents[0].status === "running");
  await until(() => JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].status === "idle", "Backend interruption did not automatically recover", 25000);
  check("backend interruption continues the same native thread", JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].codexThreadId === originalNativeId);
  const scheduleConfig = { name: "Fixture report", threadId, prompt: "OFFICE_SCHEDULE_MARKER", firstRunAt: Date.now(), intervalMinutes: 60, enabled: true };
  const rosterEventsBeforeSchedule = client.events.filter(event => event.event === "roster.updated").length;
  const createdSchedule = await client.call("schedule.create", { ...scheduleConfig, requestId: "schedule-create" });
  await until(() => client.events.filter(event => event.event === "roster.updated").length > rosterEventsBeforeSchedule, "Schedule creation did not refresh roster");
  check("enabled schedule exposes an independent clock flag and refreshes the roster", (await client.call("office.snapshot")).agents[0].hasPendingSchedule === true);
  check("schedule management retries do not duplicate tasks", (await client.call("schedule.create", { ...scheduleConfig, requestId: "schedule-create" })).id === createdSchedule.id && (await client.call("schedule.list")).tasks.length === 1);
  const storedSchedule = () => JSON.parse(fs.readFileSync(path.join(data, "scheduled-tasks.json"))).tasks[0];
  socket.terminate();
  await until(() => storedSchedule().runs.at(-1)?.status === "completed", "Scheduled run did not complete without a browser", 25000);
  socket = new WebSocket(`ws://127.0.0.1:${port}`); client = new BrowserClient(socket); await once(socket, "open"); await client.call("connect", { auth: { token } }); diagnosticClient = client;
  check("actual Codex scheduler runs with no browser connected", JSON.stringify(payloads.at(-1).input).includes("OFFICE_SCHEDULE_MARKER") && storedSchedule().runs[0].turnId != null);
  check("scheduled reply belongs to the original Office conversation", (await client.call("session.history", { threadId })).messages.some(m => m.role === "user" && m.content.includes("[Scheduled task: Fixture report]")) && JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions[0].codexThreadId === originalNativeId);
  await client.call("schedule.update", { ...scheduleConfig, id: createdSchedule.id, enabled: false, requestId: "schedule-pause" });
  check("pausing a schedule clears its clock without changing chat activity", (await client.call("office.snapshot")).agents[0].hasPendingSchedule === false && (await client.call("office.snapshot")).agents[0].status === "idle");
  const nextScheduledAt = storedSchedule().nextRunAt;
  await client.call("schedule.run", { id: createdSchedule.id, requestId: "schedule-manual" });
  await until(() => storedSchedule().runs.length === 2 && storedSchedule().runs.at(-1).status === "completed", "Manual scheduled run did not complete", 25000);
  check("manual runs keep paused recurring tasks paused", !storedSchedule().enabled && storedSchedule().nextRunAt === nextScheduledAt && storedSchedule().runs.at(-1).manual);
  await stop(); client = await start();
  check("task configuration and confirmed outcomes survive restart", (await client.call("schedule.list")).tasks[0].runs.every(r => r.status === "completed") && !(await client.call("schedule.list")).tasks[0].enabled);
  await client.call("schedule.delete", { id: createdSchedule.id, requestId: "schedule-delete" });
  check("deleting a schedule retains the conversation", (await client.call("schedule.list")).tasks.length === 0 && (await client.call("office.snapshot")).agents.some(a => a.id === threadId));
  referenceTargetId = threadId;
  const reader = await client.call("session.new", { threadId, name: "Reference reader", requestId: "reference-reader" });
  check("slash commands use an explicit supported catalog", (await client.call("session.composer.options", { threadId: reader.threadId, kind: "command" })).options.some(option => option.id === "compact"));
  const skillOptions = await client.call("session.composer.options", { threadId: reader.threadId, kind: "skill", query: "office-profile-probe" });
  check("skill picker uses native discovery and respects disabled entries", skillOptions.options.some(option => option.name === "office-profile-probe") && !(await client.call("session.composer.options", { threadId: reader.threadId, kind: "skill", query: "disabled-profile-probe" })).options.length);
  const readReference = async (id, marker, requestId) => {
    await client.call("session.send", { threadId: id, message: marker, references: [{ kind: "chat", id: threadId }], requestId });
    await until(() => payloads.some(p => p.input?.some(item => item.type === "function_call_output" && item.call_id === "read-" + marker)) && JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions.find(row => row.id === id)?.status === "idle", "Native Office chat reference did not complete");
    return payloads.find(p => p.input?.some(item => item.type === "function_call_output" && item.call_id === "read-" + marker));
  };
  const referenced = await readReference(reader.threadId, "OFFICE_READ_REFERENCE", "read-reference");
  check("actual Codex calls Office's registered read tool through public history APIs", referenced.input.some(item => item.type === "function_call_output" && JSON.stringify(item).includes("OFFICE_FIRST_MARKER")));
  check("reference reads do not send a message to the referenced worker", !(await client.call("session.history", { threadId })).messages.some(item => item.content.includes("OFFICE_READ_REFERENCE")));
  await stop(); client = await start();
  check("native dynamic chat tools survive restart", Boolean(await readReference(reader.threadId, "OFFICE_READ_REFERENCE_RESTART", "read-reference-restart")));
  const forked = await client.call("session.fork", { threadId: reader.threadId, requestId: "fork-reader" });
  check("native fork retains chat-reading tools", Boolean(await readReference(forked.threadId, "OFFICE_READ_REFERENCE_FORK", "read-reference-fork")));
  await client.call("session.subscribe", { threadId: forked.threadId, subscriptionId: "compact-check" });
  await client.call("session.compact", { threadId: forked.threadId, requestId: "compact-native" });
  await until(() => client.events.some(event => event.event === "session.stream" && event.payload.subscriptionId === "compact-check" && event.payload.items.some(item => item.content === "整理上下文")), "Native context-compaction lifecycle was not observed");
  await until(() => JSON.parse(fs.readFileSync(path.join(data, "office.json"))).sessions.find(row => row.id === forked.threadId)?.status === "idle", "Compaction did not finish");
  check("manual compaction emits the native context-compaction lifecycle", true);
  const handoffConfig = { ...scheduleConfig, threadId: forked.threadId, firstRunAt: Date.now() + 3600000 };
  const handoff = await client.call("schedule.create", { ...handoffConfig, requestId: "handoff-create" });
  const archiveFork = { threadId: forked.threadId, requestId: "archive-fork-reader" };
  await client.call("session.archive", archiveFork);
  await client.call("session.archive", archiveFork);
  const archivedSchedule = (await client.call("schedule.list")).tasks.find(task => task.id === handoff.id);
  check("archive immediately persists pause without a failed scheduled run", archivedSchedule && !archivedSchedule.enabled && !archivedSchedule.targetAvailable && archivedSchedule.runs.length === 0 && archivedSchedule.prompt === handoffConfig.prompt);
  await client.call("schedule.update", { ...handoffConfig, id: handoff.id, threadId: reader.threadId, enabled: false, requestId: "handoff-reassign" });
  const reassigned = (await client.call("schedule.list")).tasks.find(task => task.id === handoff.id);
  check("archived task can be assigned to another Office conversation while paused", reassigned.threadId === reader.threadId && reassigned.targetAvailable && !reassigned.enabled && reassigned.firstRunAt === handoffConfig.firstRunAt);
  await client.call("schedule.update", { ...handoffConfig, id: handoff.id, threadId: reader.threadId, enabled: true, requestId: "handoff-resume" });
  check("explicit resume moves the schedule clock to the new conversation", (await client.call("office.snapshot")).agents.find(agent => agent.id === reader.threadId).hasPendingSchedule);
  await client.call("schedule.delete", { id: handoff.id, requestId: "handoff-delete" });
  await client.call("session.archive", { threadId: reader.threadId, requestId: "archive-reference-reader" });
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
