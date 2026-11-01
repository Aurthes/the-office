#!/usr/bin/env node
// macOS Office-only cutover. Builds and application data stay outside this tool.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const domain = `gui/${process.getuid?.()}`;
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const defaultState = path.join(os.homedir(), ".local/share/claw3d/deployments");

function command(program, args, input) {
  const result = spawnSync(program, args, { input, encoding: "utf8", timeout: 30_000 });
  if (result.error) throw new Error(`${path.basename(program)}: ${result.error.message}`);
  return result;
}
function launch(...args) { return command("/bin/launchctl", args); }
function plist(bytes) {
  const result = command("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], bytes);
  if (result.status !== 0) throw new Error("Invalid service plist");
  return JSON.parse(result.stdout);
}
function writePlist(file, value) {
  const result = command("/usr/bin/plutil", ["-convert", "xml1", "-o", file, "-"], JSON.stringify(value));
  if (result.status !== 0) throw new Error("Could not write controller plist");
  fs.chmodSync(file, 0o600);
}
function atomic(file, bytes, mode = 0o600) {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { mode });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}
function json(file, value) { atomic(file, JSON.stringify(value, null, 2) + "\n"); }
function state(label) {
  const result = launch("print", `${domain}/${label}`);
  if (result.status !== 0) {
    if (/Could not find service|service not found/i.test(result.stderr)) return null;
    throw new Error(`Cannot inspect ${label}: ${result.stderr.trim()}`);
  }
  return { pid: Number(result.stdout.match(/^\s+pid = (\d+)$/m)?.[1]) || null };
}
function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true; // Still exists; never start a duplicate owner.
    throw error;
  }
}
function describe(bytes, file) {
  const value = plist(bytes), kind = value.Label?.match(/^[\w.-]+\.claw3d\.(gateway|studio)$/)?.[1];
  if (!kind) throw new Error("Only Office gateway/studio LaunchAgents are allowed");
  const args = value.ProgramArguments, cwd = value.WorkingDirectory;
  const script = kind === "gateway" ? "server/codex-office-gateway.js" : "server/index.js";
  if (!path.isAbsolute(cwd || "") || !Array.isArray(args) || args.length !== 2 ||
      args[1] !== path.join(cwd, script) || !path.isAbsolute(args[0])) {
    throw new Error(`Unexpected Office entry point: ${file}`);
  }
  fs.accessSync(args[0], fs.constants.X_OK);
  const files = [args[1]];
  if (value.EnvironmentVariables?.NODE_ENV === "production" && kind === "studio") {
    files.push(path.join(cwd, ".next/BUILD_ID"), path.join(cwd, "node_modules/next/package.json"));
  }
  const lockfile = path.join(cwd, "package-lock.json");
  if (fs.existsSync(lockfile)) files.push(lockfile);
  const fingerprint = files.map(name => [name, digest(fs.readFileSync(name))]);
  return { label: value.Label, kind, fingerprint };
}
function unchangedSource(description) {
  for (const [name, hash] of description.fingerprint) {
    if (digest(fs.readFileSync(name)) !== hash) throw new Error(`Prepared source changed: ${name}`);
  }
}
function healthURL(raw) {
  const url = new URL(raw);
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password) {
    throw new Error("Health checks must use a loopback HTTP URL");
  }
  return url.href;
}
async function healthy(service) {
  try {
    const response = await fetch(service.health, { redirect: "error", signal: AbortSignal.timeout(600) });
    if (response.status !== 200) return false;
    return service.kind !== "gateway" || (await response.json()).ok === true;
  } catch { return false; }
}
async function ready(service, timeout) {
  const end = Date.now() + timeout;
  do {
    const registered = state(service.label);
    if (registered?.pid && alive(registered.pid) && await healthy(service)) return registered.pid;
    await delay(100);
  } while (Date.now() < end);
  throw new Error(`Health check failed: ${service.label}`);
}
async function stop(service, timeout) {
  const old = state(service.label);
  service.stoppingPids ??= [];
  if (old?.pid) service.stoppingPids.push(old.pid);
  if (old) {
    const result = launch("bootout", `${domain}/${service.label}`);
    // A nonzero bootout may still have removed the job. Confirm state below.
    if (result.status !== 0 && state(service.label)) throw new Error(`Cannot stop ${service.label}`);
  }
  const end = Date.now() + timeout;
  do {
    if (!state(service.label) && !service.stoppingPids.some(alive)) return;
    await delay(100);
  } while (Date.now() < end);
  throw new Error(`Old service has not fully exited: ${service.label}`);
}
async function start(service, timeout) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = launch("bootstrap", domain, service.plist);
    if (result.status === 0) return ready(service, timeout);
    last = result.stderr.trim();
    // Never claim bootstrap success just because the label exists.
    if (state(service.label)) return ready(service, timeout);
    await delay(200);
  }
  throw new Error(`Cannot start ${service.label}: ${last}`);
}

export function prepare(planFile, stateDirectory = defaultState) {
  const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
  if (!Array.isArray(plan.services) || !plan.services.length || plan.services.length > 2) {
    throw new Error("Specify one or two Office services");
  }
  const services = plan.services.map((row, index) => {
    const original = path.resolve(row.plist), candidate = path.resolve(row.candidate);
    if (fs.lstatSync(original).isSymbolicLink()) throw new Error("Service plist must not be a symlink");
    const before = fs.readFileSync(original), after = fs.readFileSync(candidate);
    const old = describe(before, original), next = describe(after, candidate);
    if (old.label !== next.label) throw new Error("Candidate service label changed");
    return { ...next, old, plist: original, health: healthURL(row.health), index,
      beforeHash: digest(before), afterHash: digest(after), mode: fs.statSync(original).mode & 0o777,
      before, after };
  });
  if (new Set(services.map(row => row.label)).size !== services.length) throw new Error("Duplicate Office service");
  const timeout = plan.readyTimeoutMs ?? 15_000;
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 120_000) throw new Error("Invalid readiness timeout");
  fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  const directory = fs.mkdtempSync(path.join(stateDirectory, "deploy-"));
  fs.chmodSync(directory, 0o700);
  const label = `local.claw3d.deploy.${path.basename(directory)}`;
  const job = { directory, label, timeout, services: services.map(({ before, after, ...row }) => {
    fs.writeFileSync(path.join(directory, `${row.index}.before.plist`), before, { mode: 0o600 });
    fs.writeFileSync(path.join(directory, `${row.index}.after.plist`), after, { mode: 0o600 });
    return row;
  }) };
  json(path.join(directory, "job.json"), job);
  // The controller is copied out of the worktree and never runs inside Office.
  fs.copyFileSync(fileURLToPath(import.meta.url), path.join(directory, "controller.mjs"));
  writePlist(path.join(directory, "controller.plist"), {
    Label: label, ProgramArguments: [process.execPath, path.join(directory, "controller.mjs"), "--worker", directory],
    WorkingDirectory: directory, RunAtLoad: true, KeepAlive: false,
    StandardOutPath: path.join(directory, "controller.log"), StandardErrorPath: path.join(directory, "controller.err.log"),
  });
  json(path.join(directory, "result.json"), { phase: "queued", directory, label });
  return job;
}

export async function deploy(job) {
  const result = { phase: "checking", startedAt: new Date().toISOString(), controllerPid: process.pid, services: [] };
  const leases = [], attempted = [];
  const save = () => json(path.join(job.directory, "result.json"), result);
  const bytes = (service, kind) => fs.readFileSync(path.join(job.directory, `${service.index}.${kind}.plist`));
  try {
    for (const service of job.services) {
      const lock = `${service.plist}.redeploy-lock`;
      try { fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, directory: job.directory }), { flag: "wx", mode: 0o600 }); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        throw new Error(`Another deployment owns ${service.label}; inspect ${lock} before retrying`);
      }
      leases.push(lock);
    }
    // All checks and backups finish while the current Office remains available.
    for (const service of job.services) {
      if (digest(fs.readFileSync(service.plist)) !== service.beforeHash) throw new Error("Concurrent service configuration change");
      unchangedSource(service.old); unchangedSource(service);
      await ready(service, job.timeout);
    }
    for (const service of job.services) {
      if (digest(fs.readFileSync(service.plist)) !== service.beforeHash) throw new Error("Concurrent service configuration change");
      unchangedSource(service);
      const row = { label: service.label, phase: "stopping", cutoverAt: new Date().toISOString() };
      result.services.push(row); attempted.push(service); result.phase = "switching"; save();
      await stop(service, 30_000);
      atomic(service.plist, bytes(service, "after"), service.mode);
      row.phase = "starting"; save();
      row.pid = await start(service, job.timeout);
      row.unavailableMs = Date.now() - Date.parse(row.cutoverAt);
      row.phase = "ready"; save();
    }
    result.phase = "succeeded";
  } catch (error) {
    result.error = error.message; result.phase = "rolling_back"; save();
    const errors = [];
    // Each recovery is independent: one failed rollback must not skip the rest.
    for (const service of attempted.toReversed()) {
      const row = result.services.find(row => row.label === service.label);
      try {
        const current = digest(fs.readFileSync(service.plist));
        if (![service.beforeHash, service.afterHash].includes(current)) throw new Error("Configuration changed externally; not overwriting it");
        unchangedSource(service.old);
        if (current !== service.beforeHash || !state(service.label)?.pid || !await healthy(service)) {
          await stop(service, 30_000);
          atomic(service.plist, bytes(service, "before"), service.mode);
          row.pid = await start(service, job.timeout);
        } else row.pid = await ready(service, job.timeout);
        row.phase = "restored"; row.recoveredAt = new Date().toISOString();
        row.unavailableMs = Date.now() - Date.parse(row.cutoverAt);
      } catch (rollback) { row.phase = "recovery_failed"; errors.push(`${service.label}: ${rollback.message}`); }
      save();
    }
    result.phase = errors.length ? "recovery_failed" : attempted.length ? "rolled_back" : "rejected";
    if (errors.length) result.recoveryErrors = errors;
  } finally {
    result.completedAt = new Date().toISOString(); save();
    for (const lease of leases) fs.unlinkSync(lease);
  }
  return result;
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log("node scripts/redeploy-office.mjs --plan /absolute/plan.json [--state-dir /private/directory] [--wait]\n" +
      "Plan: {services:[{plist, candidate, health}], readyTimeoutMs?:15000}. Build before deploying. macOS only.");
    return;
  }
  if (process.platform !== "darwin") throw new Error("Office LaunchAgent redeploy requires macOS");
  if (process.argv[2] === "--worker") {
    const directory = path.resolve(process.argv[3]);
    const job = JSON.parse(fs.readFileSync(path.join(directory, "job.json"), "utf8"));
    await deploy(job);
    // Results and locks are flushed first. Removing this one-shot job may end us.
    launch("bootout", `${domain}/${job.label}`);
    return;
  }
  const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
  if (!args.includes("--plan") || !option("--plan")) throw new Error("--plan is required; see --help");
  const job = prepare(path.resolve(option("--plan")), args.includes("--state-dir") ? path.resolve(option("--state-dir")) : defaultState);
  const started = launch("bootstrap", domain, path.join(job.directory, "controller.plist"));
  if (started.status !== 0) {
    const error = `Cannot launch independent controller: ${started.stderr.trim()}`;
    json(path.join(job.directory, "result.json"), { phase: "rejected", error, completedAt: new Date().toISOString() });
    throw new Error(error);
  }
  console.log(`Deployment status: ${path.join(job.directory, "result.json")}`);
  if (args.includes("--wait")) {
    const end = Date.now() + job.services.length * (90_000 + job.timeout * 3);
    while (Date.now() < end) {
      const result = JSON.parse(fs.readFileSync(path.join(job.directory, "result.json"), "utf8"));
      if (result.completedAt) { console.log(JSON.stringify(result, null, 2)); process.exitCode = result.phase === "succeeded" ? 0 : 1; return; }
      await delay(200);
    }
    throw new Error("Wait timed out; independent controller continues. Read result.json before retrying.");
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
