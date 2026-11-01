// Local macOS runtime. Owns only the two children it starts and its private data.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const { spawn } = require("node:child_process");

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { if (e.code === "ESRCH") return false; throw e; } };
function canonical(file) {
  const absolute = path.resolve(file);
  return fs.existsSync(absolute) ? fs.realpathSync(absolute) : path.join(canonical(path.dirname(absolute)), path.basename(absolute));
}
function read(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new Error("Office's saved settings could not be read. They have been preserved; see the macOS setup guide."); }
}
function write(file, value) {
  fs.writeFileSync(file + ".tmp", JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(file + ".tmp", file);
}
async function available(port = 0) {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once("error", () => reject(new Error("Office's saved local port is in use. Quit the other Office instance and try again.")));
    server.listen(port, "127.0.0.1", () => { const chosen = server.address().port; server.close(() => resolve(chosen)); });
  });
}
function desktopEnvironment(environment, directory, config) {
  const env = Object.fromEntries(Object.entries(environment).filter(([key]) => !/^(CLAW3D_|OPENCLAW_|MOLTBOT_|CLAWDBOT_|NEXT_PUBLIC_)/.test(key) && !["STUDIO_ACCESS_TOKEN", "OPENAI_API_KEY", "OPENAI_ADMIN_KEY", "PORT", "HOST", "NODE_OPTIONS"].includes(key)));
  return { ...env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", HOST: "127.0.0.1",
    PATH: [path.dirname(process.execPath), environment.PATH, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].filter(Boolean).join(path.delimiter),
    OPENCLAW_STATE_DIR: path.join(directory, "state"), CLAW3D_DATA_DIR: directory,
    CLAW3D_OFFICE_DATA_DIR: path.join(directory, "runtime"), CLAW3D_OFFICE_CODEX_HOME: path.join(directory, "runtime", "codex"),
    CLAW3D_UPLOAD_DIR: path.join(directory, "uploads"), CLAW3D_GATEWAY_TOKEN: config.token,
    CLAW3D_CODEX_CONFIG_HOME: environment.CLAW3D_CODEX_CONFIG_HOME || environment.CODEX_HOME || path.join(os.homedir(), ".codex"),
    CLAW3D_GATEWAY_URL: `ws://127.0.0.1:${config.gatewayPort}`, CODEX_ADAPTER_PORT: String(config.gatewayPort),
    CLAW3D_CODEX_GATEWAY: "1", CLAW3D_OFFICE_DESKTOP: "1", UPSTREAM_ALLOWLIST: "127.0.0.1", NEXT_PUBLIC_CLAW3D_SESSION_VIEW: "1", NEXT_PUBLIC_CLAW3D_WEB_ACCESS: "0", PORT: String(config.studioPort) };
}

class LocalOffice {
  constructor({ appDirectory = path.resolve(__dirname, ".."), dataDirectory = path.join(os.homedir(), "Library/Application Support/The Office"), environment = process.env, emit = () => {}, timeout = 60000 } = {}) {
    this.appDirectory = appDirectory; this.directory = dataDirectory; this.environment = environment; this.emit = emit; this.timeout = timeout;
    this.children = []; this.logs = []; this.lock = path.join(dataDirectory, "desktop.lock");
    this.closed = new Promise(resolve => { this.resolveClosed = resolve; });
  }
  async ready(port, child, gateway = false) {
    const deadline = Date.now() + this.timeout;
    while (Date.now() < deadline) {
      if (child.startError || child.exitCode !== null || child.signalCode || this.stopping) throw new Error("Office could not start. See its local log for details.");
      try {
        const response = await fetch(`http://127.0.0.1:${port}/${gateway ? "health" : "api/health"}`, { signal: AbortSignal.timeout(600), redirect: "error" });
        const value = response.status === 200 ? await response.json() : {};
        if (value.ok && (!gateway || value.runtime === "Office-owned Codex")) return;
      } catch { /* The owned child is still starting. */ }
      await pause(100);
    }
    throw new Error("Office took too long to start. Quit and reopen it; your saved conversations are kept.");
  }
  child(name, script, env) {
    if (this.stopping) throw new Error("Office is closing.");
    const fd = fs.openSync(path.join(this.directory, "logs", name + ".log"), "a", 0o600); this.logs.push(fd);
    const child = spawn(process.execPath, [path.join(this.appDirectory, script)], { cwd: this.workingDirectory, env, stdio: ["ignore", fd, fd] });
    this.children.push(child);
    child.on("error", () => { child.startError = true; if (this.started && !this.stopping) void this.close("Office could not launch its local runtime."); });
    child.on("exit", () => { if (this.started && !this.stopping) void this.close("Office's local runtime stopped. Reopen Office to continue your saved conversations."); });
    return child;
  }
  async start() {
    if (!fs.existsSync(path.join(this.appDirectory, ".next/BUILD_ID"))) throw new Error("This Office installation is incomplete. Install the complete macOS application.");
    const data = canonical(this.directory);
    const inside = (a, b) => a === b || b.startsWith(a + path.sep);
    const sources = [this.appDirectory, path.join(os.homedir(), ".codex"), this.environment.CLAW3D_CODEX_CONFIG_HOME || this.environment.CODEX_HOME || path.join(os.homedir(), ".codex")];
    if (sources.some(source => inside(canonical(source), data) || inside(data, canonical(source)))) throw new Error("Office needs its own data folder, separate from its application files and existing Codex configuration.");
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    try { fs.mkdirSync(this.lock, { mode: 0o700 }); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      let previous;
      try { previous = JSON.parse(fs.readFileSync(path.join(this.lock, "owner.json"), "utf8")); } catch { throw new Error("Office is already starting. Try again in a moment."); }
      if (!Number.isInteger(previous.pid) || previous.pid <= 0) throw new Error("Office's startup record is invalid. See the macOS setup guide.");
      if (alive(previous.pid)) throw new Error("Office is already running. Open its existing window.");
      fs.rmSync(this.lock, { recursive: true }); fs.mkdirSync(this.lock, { mode: 0o700 });
    }
    this.ownsLock = true; write(path.join(this.lock, "owner.json"), { pid: process.pid });
    try {
      const file = path.join(this.directory, "desktop.json");
      let config = fs.existsSync(file) ? read(file) : null;
      if (config && (!/^[0-9a-f]{64}$/.test(config.token) || ![config.gatewayPort, config.studioPort].every(port => Number.isInteger(port) && port > 0 && port < 65536) || config.gatewayPort === config.studioPort)) throw new Error("Office's saved startup settings are invalid. Your conversations have been preserved.");
      if (config) { await available(config.gatewayPort); await available(config.studioPort); }
      else {
        const gatewayPort = await available(); let studioPort = await available();
        while (studioPort === gatewayPort) studioPort = await available();
        config = { token: crypto.randomBytes(32).toString("hex"), gatewayPort, studioPort }; write(file, config);
      }
      fs.mkdirSync(path.join(this.directory, "logs"), { recursive: true, mode: 0o700 });
      const env = desktopEnvironment(this.environment, this.directory, config);
      // Next may write runtime caches. Keep signed application resources immutable.
      const buildId = fs.readFileSync(path.join(this.appDirectory, ".next/BUILD_ID"), "utf8").trim();
      if (!/^[a-zA-Z0-9_-]+$/.test(buildId)) throw new Error("Office's application build is invalid. Reinstall the complete application.");
      this.workingDirectory = path.join(this.directory, "app", buildId);
      const readyFile = path.join(this.workingDirectory, ".office-runtime");
      if (!fs.existsSync(readyFile)) {
        fs.rmSync(this.workingDirectory, { recursive: true, force: true });
        fs.mkdirSync(this.workingDirectory, { recursive: true, mode: 0o700 });
        fs.cpSync(path.join(this.appDirectory, ".next"), path.join(this.workingDirectory, ".next"), { recursive: true, filter: source => source !== path.join(this.appDirectory, ".next/cache") });
        for (const name of ["server", "public", "node_modules"]) fs.symlinkSync(path.join(this.appDirectory, name), path.join(this.workingDirectory, name));
        for (const name of ["package.json", "next.config.js"]) fs.copyFileSync(path.join(this.appDirectory, name), path.join(this.workingDirectory, name));
        fs.writeFileSync(readyFile, "The Office desktop runtime\n", { mode: 0o600 });
      } else {
        // Application updates may move the bundle; refresh only our generated links.
        for (const name of ["server", "public", "node_modules"]) {
          const link = path.join(this.workingDirectory, name);
          if (!fs.lstatSync(link).isSymbolicLink()) throw new Error("Office's generated runtime links are invalid.");
          fs.unlinkSync(link); fs.symlinkSync(path.join(this.appDirectory, name), link);
        }
      }
      this.emit({ phase: "starting", message: "Starting Codex for Office…" });
      await this.ready(config.gatewayPort, this.child("gateway", "server/codex-office-gateway.js", env), true);
      const settingsFile = path.join(env.OPENCLAW_STATE_DIR, "claw3d/settings.json");
      fs.mkdirSync(path.dirname(settingsFile), { recursive: true, mode: 0o700 });
      const settings = fs.existsSync(settingsFile) ? read(settingsFile) : { version: 1 };
      const profile = { url: env.CLAW3D_GATEWAY_URL, token: config.token, adapterType: "openclaw" };
      settings.gateway = { ...settings.gateway, ...profile, lastKnownGood: profile }; write(settingsFile, settings);
      this.emit({ phase: "starting", message: "Opening your office…" });
      await this.ready(config.studioPort, this.child("studio", "server/index.js", env));
      this.started = true; this.url = `http://127.0.0.1:${config.studioPort}/office`;
      this.emit({ phase: "ready", url: this.url }); return this.url;
    } catch (error) { await this.close(); throw error; }
  }
  close(error) {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      for (const child of [...this.children].reverse()) {
        if (!child.pid || child.exitCode !== null || child.signalCode) continue;
        const exited = new Promise(resolve => child.once("exit", resolve)); child.kill("SIGTERM");
        let timer;
        await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 7000); })]);
        clearTimeout(timer);
        if (child.exitCode === null && !child.signalCode) { child.kill("SIGKILL"); await exited; }
      }
      for (const fd of this.logs) fs.closeSync(fd);
      if (this.ownsLock) fs.rmSync(this.lock, { recursive: true, force: true });
      if (error) this.emit({ phase: "error", message: error });
      this.resolveClosed();
    })();
    return this.stopping;
  }
}
module.exports = { LocalOffice, desktopEnvironment };
if (require.main === module) {
  const args = process.argv.slice(2), option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const emit = value => process.stdout.write(JSON.stringify(value) + "\n");
  const office = new LocalOffice({ appDirectory: option("--app-dir"), dataDirectory: option("--data-dir"), emit });
  const parent = Number(option("--parent-pid"));
  let guardian;
  if (Number.isInteger(parent) && parent > 0) {
    guardian = setInterval(() => { if (!alive(parent)) void office.close(); }, 1000);
    guardian.unref();
  }
  process.stdout.on("error", () => void office.close());
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => void office.close());
  office.start().then(() => office.closed).catch(error => { emit({ phase: "error", message: error.message }); process.exitCode = 1; }).finally(() => clearInterval(guardian));
}
