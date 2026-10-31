import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

// This validation never uses the native App's Codex home, login, or database.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "office-light-codex-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith("CODEX_") && !key.startsWith("BROWSER_USE_")));
Object.assign(env, { CODEX_HOME: temporary, CODEX_SQLITE_HOME: temporary,
  OFFICE_LIGHT_DATA_DIR: path.join(temporary, "roles-data"),
  PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH || "") });
const child = spawn(process.env.OFFICE_LIGHT_CODEX_BINARY || "codex",
  ["-c", "sqlite_home=" + JSON.stringify(temporary), "app-server", "--listen", "stdio://"],
  { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
let serial = 0, startupError = null, diagnostics = "";
const pending = new Map();
child.on("error", error => { startupError = error; });
child.stderr.on("data", bytes => { diagnostics = (diagnostics + bytes).slice(-12000); });
readline.createInterface({ input: child.stdout }).on("line", line => {
  let frame; try { frame = JSON.parse(line); } catch { return; }
  const request = pending.get(frame.id); if (!request) return;
  pending.delete(frame.id); clearTimeout(request.timer);
  if (frame.error) request.reject(new Error(frame.error.message)); else request.resolve(frame.result);
});
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (startupError) return reject(startupError);
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(startupError || new Error(method + " timed out")); }, 10000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
}
try {
  await call("initialize", { clientInfo: { name: "office_light_loader", version: "0.1.0" }, capabilities: { experimentalApi: false } });
  child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  const selected = { pluginName: "the-office-light", marketplacePath: path.join(root, ".agents/plugins/marketplace.json") };
  await call("plugin/read", selected);
  await call("plugin/install", selected);
  await call("thread/start", { cwd: root, ephemeral: true, sandbox: "read-only", approvalPolicy: "never" });
  let loaded;
  for (let attempt = 0; attempt < 20; attempt++) {
    const status = await call("mcpServerStatus/list", { limit: 20 });
    loaded = status.data?.find(server => server.name === "office_light");
    if (loaded && Object.keys(loaded.tools || {}).length >= 3) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(loaded?.tools?.office_open, "Isolated Codex must load the Office MCP tools");
  assert.equal(Object.keys(loaded.tools).length, 3);
  console.log(JSON.stringify({ passed: true, server: loaded.name, tools: Object.keys(loaded.tools),
    ephemeralValidationOnly: true, modelTurnsStarted: 0, nativeAppHomeUsed: false }));
} catch (error) {
  console.error(diagnostics);
  throw error;
} finally {
  if (child.exitCode === null && !startupError) {
    const closed = new Promise(resolve => child.once("exit", resolve));
    child.stdin.end();
    const timeout = setTimeout(() => child.kill("SIGTERM"), 3000);
    await closed; clearTimeout(timeout);
  }
  for (const request of pending.values()) clearTimeout(request.timer);
  await fs.rm(temporary, { recursive: true, force: true });
}
