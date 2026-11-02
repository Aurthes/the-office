#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const index = process.argv.indexOf("--app");
if (index < 0 || !process.argv[index + 1]) throw new Error('Usage: node scripts/check-macos-package.mjs --app "/path/The Office.app"');
const application = path.resolve(process.argv[index + 1]), resources = path.join(application, "Contents/Resources");
const node = path.join(resources, "node/bin/node"), office = path.join(resources, "office");
const codexPackage = process.arch === "arm64" ? "codex-darwin-arm64" : "codex-darwin-x64";
const triplet = process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
const codex = path.join(office, "node_modules/@openai", codexPackage, "vendor", triplet, "bin/codex");
for (const file of [node, codex, path.join(application, "Contents/MacOS/The Office"), path.join(office, ".next/BUILD_ID"), path.join(office, "next.config.js")]) fs.accessSync(file);
if (fs.realpathSync(process.execPath) !== fs.realpathSync(node)) {
  const child = spawnSync(node, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { env: { ...process.env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" }, stdio: "inherit" });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}
const check = spawnSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", application], { stdio: "inherit" });
if (check.status !== 0) process.exit(check.status ?? 1);
// Neither globally installed Node nor Codex is on this path. The real engine,
// synthetic model, temporary state and foreign-state sentinel are reused.
const result = spawnSync(node, [fileURLToPath(new URL("check-office-codex.mjs", import.meta.url)), "--app-dir", office, "--codex", codex], {
  env: { ...process.env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" }, stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const require = createRequire(path.join(office, "package.json"));
const { LocalOffice } = require("./desktop/launcher.cjs"), { WebSocket } = require("ws");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "office-package-start-"));
const foreign = path.join(temporary, "foreign"); fs.mkdirSync(foreign);
const local = new LocalOffice({ appDirectory: office, dataDirectory: path.join(temporary, "data"), environment: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", CODEX_HOME: foreign } });
let socket;
try {
  const url = await local.start();
  const visible = JSON.stringify(await (await fetch(new URL("/api/studio", url))).json());
  const config = JSON.parse(fs.readFileSync(path.join(temporary, "data/desktop.json"), "utf8"));
  if (visible.includes(config.token)) throw new Error("A private gateway token reached the browser settings");
  await new Promise((resolve, reject) => {
    const target = new URL("/api/gateway/ws", url); target.protocol = "ws:";
    socket = new WebSocket(target, { headers: { Origin: new URL(url).origin } });
    const timer = setTimeout(() => { reject(new Error("Packaged frontend/gateway connection timed out")); socket.terminate(); }, 15000);
    socket.on("error", error => { clearTimeout(timer); reject(error); });
    socket.on("open", () => socket.send(JSON.stringify({ type: "req", id: "connect", method: "connect", params: { auth: {} } })));
    socket.on("message", raw => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "res" && frame.id === "connect") {
        if (!frame.ok) { clearTimeout(timer); reject(new Error("Packaged frontend could not authenticate its gateway")); return; }
        socket.send(JSON.stringify({ type: "req", id: "account", method: "office.account", params: {} }));
      }
      if (frame.type === "res" && frame.id === "account") {
        clearTimeout(timer);
        if (!frame.ok || frame.payload.loggedIn || frame.payload.loginFlow !== "browser") reject(new Error("Fresh Office did not offer independent browser sign-in"));
        else resolve();
      }
    });
  });
  console.log(JSON.stringify({ packagedLauncher: true, noSystemNodeOrCodex: true, automaticConnection: true, independentFirstSignIn: true, privateTokenStaysOnHost: true }));
} finally {
  socket?.terminate(); await local.close(); fs.rmSync(temporary, { recursive: true, force: true });
}
const immutable = spawnSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", application], { stdio: "inherit" });
if (immutable.status !== 0) process.exit(immutable.status ?? 1);
