"use strict";
const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
// Process start identities must not depend on the caller's language or zone.
const run = (command, args) => promisify(execFile)(command, args, { timeout: 2500, maxBuffer: 512 * 1024, env: { ...process.env, LC_ALL: "C", TZ: "UTC" } }).then(result => result.stdout);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const directory = () => process.env.CLAW3D_BACKGROUND_PROCESSES_DIR?.trim() || path.join(process.env.CLAW3D_DATA_DIR || path.join(os.homedir(), ".local/share/claw3d"), "background-processes");

function validateJob(value) {
  if (!value || value.version !== 1 || typeof value.id !== "string" || !ID.test(value.id) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 120) throw new Error("Invalid background process registration.");
  const target = value.target;
  if (!target || (target.type !== "launchd" && target.type !== "pid")) throw new Error("Register a local service or process.");
  if (target.type === "launchd" && (typeof target.label !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(target.label))) throw new Error("Invalid service label.");
  if (target.type === "pid" && (!Number.isSafeInteger(target.pid) || target.pid < 1 || typeof target.started !== "string" || !target.started.trim() || target.started.length > 80)) throw new Error("A process needs its original start identity.");
  if (value.eventsFile !== undefined && (typeof value.eventsFile !== "string" || !path.isAbsolute(value.eventsFile) || value.eventsFile.length > 4096 || /[\0\r\n]/.test(value.eventsFile))) throw new Error("Use an absolute progress log path.");
  return { version: 1, id: value.id, name: value.name.trim(), target: target.type === "launchd" ? { type: "launchd", label: target.label } : { type: "pid", pid: target.pid, started: target.started }, ...(value.eventsFile ? { eventsFile: value.eventsFile } : {}) };
}
async function registrations(root) {
  let names; try { names = (await fs.readdir(root)).filter(name => name.endsWith(".json")).sort(); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  if (names.length > 64) throw new Error("Register up to 64 background processes.");
  return Promise.all(names.map(async name => {
    const file = path.join(root, name); if ((await fs.stat(file)).size > 16000) throw new Error("Background process registration is too large.");
    const job = validateJob(JSON.parse(await fs.readFile(file, "utf8"))); if (name !== job.id + ".json") throw new Error("Background process ID mismatch."); return job;
  }));
}
async function registerJob(value, root = directory()) {
  const job = validateJob(value); await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const temporary = path.join(root, `.${job.id}.${require("node:crypto").randomUUID()}.tmp`);
  try { await fs.writeFile(temporary, JSON.stringify(job, null, 2) + "\n", { mode: 0o600, flag: "wx" }); await fs.rename(temporary, path.join(root, job.id + ".json")); }
  finally { await fs.rm(temporary, { force: true }); }
  return { id: job.id, name: job.name };
}
function elapsedSeconds(value) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(value);
  return match ? Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3]) * 60 + Number(match[4]) : null;
}
function parseProcesses(text) {
  const rows = new Map();
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+([\d:-]+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (match) rows.set(Number(match[1]), { pid: Number(match[1]), elapsedSeconds: elapsedSeconds(match[2]), zombie: match[3].startsWith("Z"), started: match[4] });
  }
  return rows;
}
async function readProcesses(execute = run) { return parseProcesses(await execute("/bin/ps", ["-axo", "pid=,etime=,stat=,lstart="])); }

function redactLog(value) {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/https?:\/\/[^\s"'<>]+/gi, input => {
      try { const url = new URL(input); const hidden = !!(url.username || url.password || url.search); url.username = ""; url.password = ""; url.search = ""; return url.href + (hidden ? "?[redacted]" : ""); } catch { return "[redacted URL]"; }
    })
    .replace(/\b(Bearer|Basic)\s+[a-zA-Z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}\b/g, "[redacted]")
    .replace(/\b([a-z0-9_-]*(?:password|passwd|token|api[_-]?key|secret(?:[_-]?(?:access[_-]?)?key)?|cookie|authorization))\b(["']?\s*[:=]\s*["']?)[^\s"',;&}]+/gi, "$1$2[redacted]")
    .replace(/(--[a-z0-9_-]*(?:password|token|secret|api[_-]?key))\s+(?:"[^"]*"|'[^']*'|\S+)/gi, "$1 [redacted]");
}
async function tailFile(file) {
  if (!file || !path.isAbsolute(file) || file === "/dev/null") return { content: "", updatedAt: null, truncated: false, available: false };
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NONBLOCK); const stat = await handle.stat(); if (!stat.isFile()) return { content: "", updatedAt: null, truncated: false, available: false };
    const length = Math.min(stat.size, 32768), start = stat.size - length, bytes = Buffer.alloc(length);
    const read = await handle.read(bytes, 0, length, start); let text = bytes.subarray(0, read.bytesRead).toString("utf8");
    if (start > 0) text = text.includes("\n") ? text.slice(text.indexOf("\n") + 1) : text;
    const lines = text.split(/\r?\n/); return { content: redactLog(lines.slice(-100).join("\n")), updatedAt: stat.mtimeMs, truncated: start > 0 || lines.length > 100, available: true };
  } catch (error) {
    if (error.code === "ENOENT") return { content: "", updatedAt: null, truncated: false, available: false };
    throw new Error("Could not read this task log.");
  } finally { await handle?.close(); }
}
function progressFromLog(log) {
  for (const line of log.content.trimEnd().split(/\r?\n/).reverse()) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line), fields = ["date", "period", "event", "step", "stage", "phase", "message"];
      const parts = fields.flatMap(key => typeof value?.[key] === "string" ? [value[key].slice(0, 200)] : []);
      if (parts.length) {
        const time = value.time ?? value.timestamp ?? value.updatedAt;
        const at = typeof time === "number" ? time < 1e12 ? time * 1000 : time : typeof time === "string" ? Date.parse(time) : NaN;
        return { text: parts.join(" · ").slice(0, 600), at: Number.isFinite(new Date(at).getTime()) ? at : log.updatedAt };
      }
    } catch { /* Plain-text logs are also valid progress sources. */ }
    return { text: line.trim().slice(0, 600), at: log.updatedAt };
  }
  return null;
}

function createBackgroundMonitor({ root = directory(), home = os.homedir(), execute = run, now = Date.now, platform = process.platform, uid = process.getuid?.() } = {}) {
  let latest, pending;
  const serviceFiles = async job => {
    if (job.target.type !== "launchd" || platform !== "darwin") return { events: job.eventsFile };
    try {
      const file = path.join(home, "Library/LaunchAgents", job.target.label + ".plist");
      const value = JSON.parse(await execute("/usr/bin/plutil", ["-convert", "json", "-o", "-", file]));
      if (value.Label !== job.target.label) return { events: job.eventsFile };
      const log = value => typeof value === "string" && path.isAbsolute(value) && value !== "/dev/null" ? value : undefined;
      return { events: job.eventsFile, stdout: log(value.StandardOutPath), stderr: log(value.StandardErrorPath) };
    } catch { return { events: job.eventsFile }; }
  };
  const sample = async (job, processes) => {
    const row = { id: job.id, name: job.name, kind: job.target.type, status: "unknown", pid: null, elapsedSeconds: null, lastExitCode: null, progress: null, logStreams: [], error: null };
    let process;
    if (job.target.type === "pid") {
      process = processes?.get(job.target.pid);
      if (process?.started !== job.target.started || process?.zombie) process = undefined;
      row.status = processes ? process ? "running" : "stopped" : "unknown";
    } else if (platform !== "darwin") row.error = "Local services are only supported on macOS.";
    else {
      try {
        const text = await execute("/bin/launchctl", ["print", `gui/${uid}/${job.target.label}`]);
        const state = /^\s*state = (.+)$/m.exec(text); if (!state) throw new Error("Service state was unavailable");
        const pid = /^\s+pid = (\d+)$/m.exec(text), exit = /^\s+last exit code = (-?\d+)$/m.exec(text), signal = /^\s+last terminating signal = (\S+)/m.exec(text);
        row.pid = pid ? Number(pid[1]) : null; row.lastExitCode = exit ? Number(exit[1]) : null;
        row.status = row.pid ? "running" : state[1] === "running" ? "unknown" : (row.lastExitCode !== null && row.lastExitCode !== 0) || signal ? "failed" : "stopped";
        process = row.pid ? processes?.get(row.pid) : undefined;
      } catch (error) {
        if (/Could not find service|service not found/i.test(error.stderr || "")) { row.status = "stopped"; row.error = "Service is not loaded."; }
        else row.error = "Could not sample this background task.";
      }
    }
    if (process) { row.pid = process.pid; row.elapsedSeconds = process.elapsedSeconds; }
    const files = await serviceFiles(job); row.logStreams = Object.keys(files).filter(key => files[key]);
    try { row.progress = progressFromLog(await tailFile(files.events || files.stdout)); }
    catch { row.error ||= "Could not read this task log."; }
    return row;
  };
  return {
    async snapshot() {
      if (pending) return pending;
      if (latest && now() - latest.updatedAt < 5000) return latest;
      pending = (async () => {
        const jobs = await registrations(root); if (!jobs.length) return latest = { updatedAt: now(), jobs: [] };
        const processes = await readProcesses(execute).catch(() => null), rows = new Array(jobs.length); let next = 0;
        await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => { for (;;) { const index = next++; if (index >= jobs.length) return; rows[index] = await sample(jobs[index], processes); } }));
        return latest = { updatedAt: now(), jobs: rows };
      })().finally(() => { pending = null; });
      return pending;
    },
    async log(id, stream) {
      if (typeof id !== "string" || !ID.test(id) || !["events", "stdout", "stderr"].includes(stream)) throw new Error("Unknown background task log.");
      const job = (await registrations(root)).find(job => job.id === id); if (!job) throw new Error("Unknown background task log.");
      const file = (await serviceFiles(job))[stream]; if (!file) throw new Error("Unknown background task log.");
      return { id, stream, ...await tailFile(file) };
    },
  };
}
const monitor = createBackgroundMonitor();
module.exports = { directory, validateJob, registerJob, elapsedSeconds, parseProcesses, readProcesses, redactLog, tailFile, progressFromLog, createBackgroundMonitor, monitor };
