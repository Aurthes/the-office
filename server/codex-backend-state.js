"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);
const STABLE = /^\d+\.\d+\.\d+$/;
const compare = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); return x[0]-y[0] || x[1]-y[1] || x[2]-y[2]; };
function atomic(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); const tmp = file + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(data, null, 2)+"\n", { mode: 0o600 }); fs.renameSync(tmp, file); }
function binaryPath(command, {env=process.env,cwd=process.cwd()}={}) {
  if (command) {
    if (path.isAbsolute(command) || command.includes(path.sep)) return fs.realpathSync(path.resolve(cwd,command));
    for (const directory of (env.PATH||"").split(path.delimiter)) { const file=path.resolve(directory||cwd,command); try{fs.accessSync(file,fs.constants.X_OK);if(fs.statSync(file).isFile())return fs.realpathSync(file);}catch{} }
    throw new Error("Selected Codex executable could not be verified");
  }
  const triple = { "darwin-arm64": "aarch64-apple-darwin", "darwin-x64": "x86_64-apple-darwin", "linux-arm64": "aarch64-unknown-linux-musl", "linux-x64": "x86_64-unknown-linux-musl", "win32-arm64": "aarch64-pc-windows-msvc", "win32-x64": "x86_64-pc-windows-msvc" }[`${process.platform}-${process.arch}`];
  const root = path.dirname(require.resolve(`@openai/codex-${process.platform}-${process.arch}/package.json`));
  return fs.realpathSync(path.join(root, "vendor", triple, "bin", process.platform === "win32" ? "codex.exe" : "codex"));
}
async function runtimeIdentity(command,options={}) {
  const binary = binaryPath(command,options), result = await execute(binary, ["--version"], { timeout: 4000, maxBuffer: 4096, ...options });
  const version = result.stdout.trim().match(/^codex-cli (\S+)$/)?.[1];
  if (!version) throw new Error("The running Codex version could not be verified");
  return { version, source: command ? "selected-runtime" : "bundled-package", binary, sha256: crypto.createHash("sha256").update(fs.readFileSync(binary)).digest("hex"), startedAt: Date.now() };
}
class BackendReservation {
  constructor(directory, blockers) { this.file=path.join(directory,"backend-upgrade-reservation.json"); this.blockers=blockers; this.value=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,"utf8")):null; }
  get held() { return Boolean(this.value); }
  reserve(jobId, version, current) {
    if (!/^[a-f\d-]{36}$/.test(jobId) || !STABLE.test(version)) throw new Error("Invalid upgrade reservation");
    if (this.value) { if(this.value.jobId!==jobId) throw new Error("Another backend upgrade owns the reservation"); if(this.value.version!==version||current!==version)throw new Error("The running backend changed during the reservation");return this.value; }
    if (version !== current) throw new Error("The running backend changed; refresh before upgrading");
    const blocked=this.blockers(); if(blocked.length) return { reserved:false, blockers:blocked };
    this.value={jobId,version,reserved:true,at:Date.now()};
    try { atomic(this.file,this.value); } catch(e) { this.value=null; throw e; }
    return this.value;
  }
  release(jobId) { if(this.value?.jobId!==jobId) throw new Error("Upgrade reservation changed"); fs.unlinkSync(this.file);this.value=null; return {released:true}; }
  assertCall(method) {
    if(this.held && method!=="initialize" && method!=="skills/extraRoots/set" && method!=="turn/interrupt" && !/(?:\/read|\/list|\/status)$/.test(method)) throw Object.assign(new Error("Codex backend is upgrading. Wait before starting new work."), {code:-32000});
  }
}
function backendBlockers({native,store,controls,voice,workspace,delivery,delegation,stopping=false}) {
  const busy=[];
  if (stopping) busy.push("Office is stopping");
  if (!native.ready) busy.push("Native backend not ready");
  if (native.pending.size) busy.push("Native operations in flight");
  if (delivery?.inflight.size || delivery?.urgentInflight.size || delegation?.inflight.size) busy.push("Agent delivery in flight");
  if (delivery && Object.values(delivery.data.batches).some(batch=>["sending","uncertain"].includes(batch.state))) busy.push("Agent delivery outcome unconfirmed");
  if (store.starting.size || store.inflight.size) busy.push("Session dispatch in flight");
  const active = store.list().filter(row => ["running", "unknown"].includes(row.status));
  if (active.length) busy.push(`Active or unconfirmed sessions: ${active.slice(0,5).map(row=>row.name).join(", ").slice(0,600)}${active.length>5?" …":""}`);
  for (const [sessionId,state] of controls.states) {
    if (state.activeTurnId || state.pendingSends || state.startDispatch || state.retry || state.autoStarting || state.editCommit || state.editUncertain || !state.turnStateKnown && (state.lastTurnId || [...controls.sends.values()].some(send=>send.id===sessionId))) { busy.push("Turn, retry or unconfirmed input in flight"); break; }
  }
  if (controls.requests.size || store.list().some(row => store.pendingQuestions(row.id).length)) busy.push("Pending approval or question");
  if (voice?.active) busy.push("Voice call active");
  if (workspace?.starts.size || [...workspace.terminals.values()].some(t=>t.running)) busy.push("Workspace terminal active");
  return busy;
}
async function reserveBackend({restored,reservation,controls,store,native},p) {
 await restored;
    // Reconcile metadata-only unknown sends before the atomic idle decision;
    // a concurrent new send still wins through the normal blockers below.
    const unknown = [...controls.states].filter(([id,s])=>!s.turnStateKnown&&!s.pendingSends&&!s.startDispatch&&(s.lastTurnId||[...controls.sends.values()].some(send=>send.id===id)));
    for (const [id] of unknown.slice(0,4)) await controls.refreshTurn(id);
    if (store.data.sessions.length>2048) throw new Error("Office session inventory exceeds the bounded upgrade verification limit");
    const result=reservation.reserve(p.jobId,p.expectedVersion,native.identity?.version);
    return { ...result, ...(result.reserved?{home:native.home,nativePid:native.child.pid,sessions:store.data.sessions.map(row=>[row.id,row.codexThreadId||null])}:{}) };
}
async function verifyBackend({restored,reservation,controls,store,delivery},p) {
 await restored;
    if (reservation.value?.jobId!==p.jobId || !Array.isArray(p.sessions) || p.sessions.length>2048) throw new Error("Upgrade verification scope changed");
    const sessions=new Map(store.data.sessions.map(row=>[row.id,row.codexThreadId||null]));
    if (!p.sessions.every(row=>Array.isArray(row)&&row.length===2&&sessions.has(row[0])&&sessions.get(row[0])===row[1])) throw new Error("Office thread mappings changed; no automatic recovery attempted");
    if (store.data.sessions.some(row=>row.codexThreadId&&!row.archived&&!controls.state(row.id).turnStateKnown)) throw new Error("Existing Office threads have not been reconciled; no upgrade success claimed");
    if (!delivery?.data || delivery.data.version!==1) throw new Error("Office delivery source unavailable");
    return {verified:true,sessionsChecked:p.sessions.length,queueSourcesReady:true,queuedMessages:Object.keys(delivery.data.messages).length,queuedBatches:Object.keys(delivery.data.batches).length,taskSources:delivery.sources().length};
}
module.exports={STABLE,compare,atomic,binaryPath,runtimeIdentity,BackendReservation,backendBlockers,reserveBackend,verifyBackend};
