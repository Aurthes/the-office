import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { prepare } from "./redeploy-office.mjs";

const script = fileURLToPath(new URL("./redeploy-office.mjs", import.meta.url));
const domain = `gui/${process.getuid?.()}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const mac = { skip: process.platform !== "darwin", timeout: 45_000 };
const launch = (...args) => execFileSync("/bin/launchctl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
function writePlist(file, value) {
  execFileSync("/usr/bin/plutil", ["-convert", "xml1", "-o", file, "-"], { input: JSON.stringify(value) });
}
async function port() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const number = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return number;
}
async function waitFor(check, timeout = 10_000) {
  const end = Date.now() + timeout;
  do { const value = await check(); if (value) return value; await delay(100); } while (Date.now() < end);
  throw new Error("Fixture timed out");
}
async function version(url) {
  try { return (await (await fetch(url, { signal: AbortSignal.timeout(300) })).json()).version; }
  catch { return null; }
}
async function fixture(t, kinds = ["gateway"]) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "office-redeploy-")));
  const labels = [], services = [], oldBytes = [];
  t.after(async () => {
    // Only disposable services created by this test are removed.
    for (const label of labels) { try { launch("bootout", `${domain}/${label}`); } catch {} }
    if (fs.existsSync(path.join(root, "jobs"))) {
      for (const dir of fs.readdirSync(path.join(root, "jobs"))) {
        const file = path.join(root, "jobs", dir, "job.json");
        if (fs.existsSync(file)) { try { launch("bootout", `${domain}/${JSON.parse(fs.readFileSync(file)).label}`); } catch {} }
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const kind of kinds) {
    const number = await port(), label = `test.${path.basename(root)}.claw3d.${kind}`;
    labels.push(label);
    const entry = kind === "gateway" ? "codex-office-gateway.js" : "index.js";
    const value = release => ({ Label: label,
      ProgramArguments: [process.execPath, path.join(root, release, "server", entry)],
      WorkingDirectory: path.join(root, release), RunAtLoad: true, KeepAlive: false,
      StandardOutPath: path.join(root, `${kind}.log`), StandardErrorPath: path.join(root, `${kind}.err`),
    });
    for (const release of ["old", "new"]) {
      fs.mkdirSync(path.join(root, release, "server"), { recursive: true });
      fs.writeFileSync(path.join(root, release, "server", entry), `
const http = require('node:http');
const fs = require('node:fs');
const server = http.createServer((req, res) => {res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ok:true, version:${JSON.stringify(release)}}));});
server.listen(${number}, '127.0.0.1');
process.on('SIGTERM', () => setTimeout(() => {fs.writeFileSync(${JSON.stringify(path.join(root, `${kind}.${release}.exited`))}, 'exited'); server.close(() => process.exit(0));}, 450));
`);
    }
    const original = path.join(root, `${kind}.plist`), candidate = path.join(root, `${kind}.candidate.plist`);
    writePlist(original, value("old")); writePlist(candidate, value("new"));
    oldBytes.push(fs.readFileSync(original));
    launch("bootstrap", domain, original);
    const health = `http://127.0.0.1:${number}/health`;
    await waitFor(async () => await version(health) === "old");
    services.push({ plist: original, candidate, health });
  }
  const planFile = path.join(root, "plan.json");
  fs.writeFileSync(planFile, JSON.stringify({ services, readyTimeoutMs: 1500 }));
  const start = async () => {
    const child = spawn(process.execPath, [script, "--plan", planFile, "--state-dir", path.join(root, "jobs")], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", bytes => { stdout += bytes; }); child.stderr.on("data", bytes => { stderr += bytes; });
    const code = await new Promise(resolve => child.once("exit", resolve));
    assert.equal(code, 0, stderr);
    const resultFile = stdout.match(/Deployment status: (.+)/)?.[1];
    assert.ok(resultFile, stdout);
    return waitFor(() => { const result = JSON.parse(fs.readFileSync(resultFile)); return result.completedAt && result; }, 20_000);
  };
  return { root, services, start, oldBytes, planFile };
}

test("real LaunchAgents: controller survives caller exit and waits for old process before healthy cutover", mac, async t => {
  const f = await fixture(t), result = await f.start();
  assert.equal(result.phase, "succeeded", JSON.stringify(result));
  assert.equal(result.services[0].phase, "ready");
  assert.ok(fs.existsSync(path.join(f.root, "gateway.old.exited")));
  assert.equal(await version(f.services[0].health), "new");
  assert.ok(!fs.existsSync(`${f.services[0].plist}.redeploy-lock`));
});

test("real LaunchAgents: private backend health credential is supplied without appearing in results", mac, async t => {
  const f = await fixture(t, ["studio"]), token = "fixture-private-proxy-credential-".repeat(2);
  const file = f.services[0].candidate;
  const value = JSON.parse(execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" }));
  value.EnvironmentVariables = { CLAW3D_PROXY_TOKEN: token }; writePlist(file, value);
  const entry = path.join(f.root, "new/server/index.js");
  fs.writeFileSync(entry, fs.readFileSync(entry, "utf8").replace("res.setHeader('content-type'", `if(req.headers['x-office-proxy-token']!==${JSON.stringify(token)}){res.statusCode=401;res.end();return;}res.setHeader('content-type'`));
  const result = await f.start();
  assert.equal(result.phase, "succeeded", JSON.stringify(result));
  assert.ok(!JSON.stringify(result).includes(token));
  const response = await fetch(f.services[0].health, { headers: { "x-office-proxy-token": token } });
  assert.equal((await response.json()).version, "new");
});

test("real LaunchAgents: new process exits on startup; old configuration and health are restored", mac, async t => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.root, "new/server/codex-office-gateway.js"), "process.exit(42);\n");
  const result = await f.start();
  assert.equal(result.phase, "rolled_back", JSON.stringify(result));
  assert.equal(result.services[0].phase, "restored");
  assert.deepEqual(fs.readFileSync(f.services[0].plist), f.oldBytes[0]);
  assert.equal(await version(f.services[0].health), "old");
});

test("real LaunchAgents: later service fails health; both services roll back", mac, async t => {
  const f = await fixture(t, ["gateway", "studio"]);
  const entry = path.join(f.root, "new/server/index.js");
  fs.writeFileSync(entry, fs.readFileSync(entry, "utf8").replace("res.end(JSON.stringify", "res.statusCode=503; res.end(JSON.stringify"));
  const result = await f.start();
  assert.equal(result.phase, "rolled_back", JSON.stringify(result));
  assert.deepEqual(result.services.map(row => row.phase), ["restored", "restored"]);
  for (let i = 0; i < f.services.length; i++) {
    assert.equal(await version(f.services[i].health), "old");
    assert.deepEqual(fs.readFileSync(f.services[i].plist), f.oldBytes[i]);
  }
});

test("real LaunchAgents: preparation failure leaves running service untouched", mac, async t => {
  const f = await fixture(t);
  const value = JSON.parse(execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", f.services[0].plist], { encoding: "utf8" }));
  const before = launch("print", `${domain}/${value.Label}`);
  fs.rmSync(path.join(f.root, "new/server/codex-office-gateway.js"));
  assert.throws(() => prepare(f.planFile, path.join(f.root, "jobs")), /ENOENT/);
  assert.equal(await version(f.services[0].health), "old");
  const pid = before.match(/^\s+pid = (\d+)$/m)[1];
  assert.doesNotThrow(() => process.kill(Number(pid), 0));
  assert.ok(!fs.existsSync(path.join(f.root, "gateway.old.exited")));
});

test("real LaunchAgents: failed rollback of one service cannot skip recovery of another", mac, async t => {
  const f = await fixture(t, ["gateway", "studio"]);
  const oldStudio = path.join(f.root, "old/server/index.js");
  fs.writeFileSync(path.join(f.root, "new/server/index.js"), `require('node:fs').appendFileSync(${JSON.stringify(oldStudio)}, '\\n// external source change'); process.exit(42);`);
  const result = await f.start();
  assert.equal(result.phase, "recovery_failed", JSON.stringify(result));
  assert.deepEqual(result.services.map(row => row.phase), ["restored", "recovery_failed"]);
  assert.match(result.recoveryErrors[0], /Prepared source changed/);
  assert.equal(await version(f.services[0].health), "old");
  assert.deepEqual(fs.readFileSync(f.services[0].plist), f.oldBytes[0]);
});

test("preflight rejects native/unrelated service labels", mac, async t => {
  const f = await fixture(t);
  writePlist(f.services[0].candidate, { Label: "com.openai.Codex" });
  assert.throws(() => prepare(f.planFile, path.join(f.root, "jobs")), /Only Office/);
  assert.equal(await version(f.services[0].health), "old");
});

test("real LaunchAgents: external configuration change during startup is reported and preserved", mac, async t => {
  const f = await fixture(t), entry = path.join(f.root, "new/server/codex-office-gateway.js");
  fs.appendFileSync(entry, `\nfs.appendFileSync(${JSON.stringify(f.services[0].plist)}, '\\n');\n`);
  const result = await f.start();
  assert.equal(result.phase, "recovery_failed", JSON.stringify(result));
  assert.match(result.error, /Configuration changed during startup/);
  assert.match(result.recoveryErrors[0], /Configuration changed externally/);
  assert.equal(await version(f.services[0].health), "new");
  assert.notDeepEqual(fs.readFileSync(f.services[0].plist), f.oldBytes[0]);
});

test("prepared source changes and simultaneous deployments are rejected without stopping Office", mac, async t => {
  const f = await fixture(t), job = prepare(f.planFile, path.join(f.root, "jobs"));
  fs.appendFileSync(path.join(f.root, "new/server/codex-office-gateway.js"), "\n// changed after preparation\n");
  const { deploy } = await import("./redeploy-office.mjs");
  const result = await deploy(job);
  assert.equal(result.phase, "rejected"); assert.match(result.error, /Prepared source changed/);
  const lock = `${f.services[0].plist}.redeploy-lock`;
  fs.writeFileSync(lock, "another deployment owns this lock");
  const locked = await deploy(prepare(f.planFile, path.join(f.root, "jobs")));
  assert.equal(locked.phase, "rejected"); assert.match(locked.error, /Another deployment/);
  assert.equal(fs.readFileSync(lock, "utf8"), "another deployment owns this lock");
  assert.equal(await version(f.services[0].health), "old");
  assert.ok(!fs.existsSync(path.join(f.root, "gateway.old.exited")));
});
