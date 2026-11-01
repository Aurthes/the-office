"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const { prepareOfficeProfile, sourceHome } = require("./codex-office-profile");

function canonical(value) {
  const absolute = path.resolve(value);
  if (fs.existsSync(absolute)) return fs.realpathSync(absolute);
  return path.join(canonical(path.dirname(absolute)), path.basename(absolute));
}
function officeEnvironment(home, environment = process.env) {
  const resolved = canonical(home), native = canonical(path.join(os.homedir(), ".codex"));
  if (resolved === path.parse(resolved).root) throw new Error("Office cannot use the filesystem root as its data directory");
  const inherited = environment.CODEX_HOME ? canonical(environment.CODEX_HOME) : native;
  for (const root of new Set([native, inherited, canonical(sourceHome(environment))])) {
    if (resolved === root || resolved.startsWith(root + path.sep) || root.startsWith(resolved + path.sep))
      throw new Error("Office requires a separate Codex data directory outside the native App home");
  }
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  // Optional voice/suggestion API credentials belong to the Office service;
  // they must not silently switch Codex away from its own account login.
  const env = Object.fromEntries(Object.entries(environment).filter(([key]) => !key.startsWith("CODEX_") && !key.startsWith("BROWSER_USE_") && !["CLAW3D_CODEX_CONTROL_SOCKET", "NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S", "OPENAI_API_KEY", "OPENAI_ADMIN_KEY"].includes(key)));
  return { home: resolved, env: { ...env, CODEX_HOME: resolved, CODEX_SQLITE_HOME: resolved } };
}

// One Office-owned child, with public stdio RPC and no App attachment or daemon.
class CodexOfficeClient {
  constructor({ home, binary, env = process.env, onFrame = () => {} }) {
    const isolated = officeEnvironment(home, env);
    this.home = isolated.home; this.ready = false; this.pending = new Map(); this.serial = 0;
    this.profile = prepareOfficeProfile(this.home, env);
    const command = binary || env.CLAW3D_CODEX_BIN;
    const launcher = command ? [] : [require.resolve("@openai/codex/bin/codex.js")];
    this.child = spawn(command || process.execPath, [...launcher, ...this.profile.overrides, "-c", `sqlite_home=${JSON.stringify(this.home)}`, "-c", 'cli_auth_credentials_store="file"', "app-server", "--listen", "stdio://"], {
      cwd: this.home, env: isolated.env, stdio: ["pipe", "pipe", "inherit"],
    });
    this.exited = new Promise(resolve => { this.resolveExit = resolve; });
    this.child.on("error", error => { this.fail(error); this.resolveExit(); });
    this.child.on("exit", () => { this.fail(new Error("Office Codex process exited; pending operations were not retried")); this.resolveExit(); if (!this.stopping) onFrame({ method: "connection/closed" }); });
    this.child.stdin.on("error", error => this.fail(error));
    readline.createInterface({ input: this.child.stdout }).on("line", line => {
      let frame; try { frame = JSON.parse(line); } catch { return; }
      if (frame.method) return onFrame(frame);
      const request = this.pending.get(frame.id); if (!request) return;
      clearTimeout(request.timer); this.pending.delete(frame.id);
      if (frame.error) request.reject(Object.assign(new Error(frame.error.message), { code: frame.error.code })); else request.resolve(frame.result);
    });
  }
  fail(error) { this.ready = false; for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); } this.pending.clear(); }
  async initialize() {
    const result = await this.call("initialize", { clientInfo: { name: "the_office", title: "The Office", version: "1" }, capabilities: { experimentalApi: true } });
    this.child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    if (this.profile.skillRoots.length) await this.call("skills/extraRoots/set", { extraRoots: this.profile.skillRoots });
    this.ready = true;
    return result;
  }
  call(method, params = {}, timeoutMs = 15000) {
    if (this.stopping || this.child.stdin.destroyed) return Promise.reject(new Error("Office Codex is disconnected"));
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      const timer = timeoutMs ? setTimeout(() => { this.pending.delete(id); reject(new Error("Codex request timed out; check its outcome before retrying")); }, timeoutMs) : null;
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  respond(id, result) { if (!this.ready) throw new Error("Office Codex is disconnected"); this.child.stdin.write(JSON.stringify({ id, result }) + "\n"); }
  async close() {
    this.stopping = true; this.ready = false; this.child.stdin.end();
    const terminate = setTimeout(() => this.child.kill("SIGTERM"), 3000);
    const kill = setTimeout(() => this.child.kill("SIGKILL"), 6000);
    await this.exited; clearTimeout(terminate); clearTimeout(kill);
  }
}
module.exports = { CodexOfficeClient, officeEnvironment };
