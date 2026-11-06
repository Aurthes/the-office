"use strict";
const { WebSocketServer } = require("ws");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { loadServerRegistry, sshTransportOptions } = require("./server-registry");
const OUTPUT_BYTES = 64 * 1024;

function createServerTerminals({ verifyClient, registry = loadServerRegistry, transportOptions = sshTransportOptions, spawnPty = spawn } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
  let running = 0;
  const reject = (socket, status) => socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  async function handleUpgrade(req, socket, head) {
    if (!verifyClient?.({ req })) { reject(socket, 403); return; }
    try {
      const alias = new URL(req.url, "http://localhost").searchParams.get("terminalHost");
      const { hosts } = await registry();
      const host = hosts.find(host => host.alias === alias && host.active);
      if (!host) { reject(socket, 404); return; }
      if (wss.clients.size >= 16) { reject(socket, 503); return; }
      if (!socket.destroyed) wss.handleUpgrade(req, socket, head, ws => attach(ws, host));
    } catch { reject(socket, 503); }
  }
  function attach(ws, host) {
    let terminal = null, starting = null, closed = false;
    const send = frame => {
      if (ws.readyState !== 1) return;
      const value = JSON.stringify(frame);
      if (ws.bufferedAmount + Buffer.byteLength(value) > 1024 * 1024) ws.close(1013, "Terminal is busy; reconnect");
      else ws.send(value);
    };
    const snapshot = () => terminal ? { handle: terminal.handle, running: terminal.running, exitCode: terminal.exitCode, offset: terminal.offset, dataBase64: terminal.output.toString("base64") } : null;
    const flush = () => {
      if (!terminal) return;
      clearTimeout(terminal.timer); terminal.timer = null;
      send({ type: "event", event: "session.terminal", payload: { threadId: host.alias, handle: terminal.handle, running: terminal.running, exitCode: terminal.exitCode, offset: terminal.offset, dataBase64: terminal.pending.toString("base64"), reset: terminal.reset } });
      terminal.pending = Buffer.alloc(0); terminal.reset = false;
    };
    const finish = (entry, code) => {
      if (!entry.running) return;
      entry.running = false; entry.exitCode = code; running--; flush();
    };
    const stop = () => {
      if (!terminal?.running) return;
      const entry = terminal;
      entry.child.stdin.end(JSON.stringify({ type: "stop" }) + "\n");
      const timer = setTimeout(() => entry.child.kill("SIGTERM"), 1500); timer.unref();
      entry.child.once("close", () => clearTimeout(timer));
    };
    const start = async () => {
      if (terminal?.running) return snapshot();
      if (starting) return starting;
      starting = (async () => {
        if (running >= 8) throw new Error("Too many open server terminals. Close one first.");
        // Re-read the allowlist before every shell, including Start after exit.
        const current = (await registry()).hosts.find(row => row.alias === host.alias && row.active);
        if (!current) throw new Error("Server registration is disabled or missing.");
        const command = host.group === "local" ? [os.userInfo().shell || "/bin/sh", "-l"]
          : ["ssh", ...await transportOptions(host.alias), "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", "-tt", host.alias];
        if (closed) throw new Error("Terminal disconnected.");
        if (running >= 8) throw new Error("Too many open server terminals. Close one first.");
        const child = spawnPty("python3", [path.join(__dirname, "server-terminal-pty.py"), ...command], { ...(host.group !== "local" ? { cwd: os.homedir() } : {}), stdio: ["pipe", "pipe", "pipe"], env: { ...Object.fromEntries(["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "SSH_AUTH_SOCK"].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])), TERM: "xterm-256color" } });
        const entry = terminal = { child, handle: crypto.randomUUID(), running: true, exitCode: null, offset: 0, output: Buffer.alloc(0), pending: Buffer.alloc(0), reset: false, timer: null };
        running++;
        let pending = "";
        const output = bytes => {
          entry.offset += bytes.length; entry.output = Buffer.concat([entry.output, bytes]).subarray(-OUTPUT_BYTES);
          entry.pending = Buffer.concat([entry.pending, bytes]);
          if (entry.pending.length > OUTPUT_BYTES) { entry.pending = entry.output; entry.reset = true; }
          if (!entry.timer) entry.timer = setTimeout(flush, 30);
        };
        child.stdin.on("error", () => {});
        child.stdout.on("data", chunk => {
          pending += String(chunk);
          if (pending.length > 128 * 1024) { stop(); return; }
          let index;
          while ((index = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, index); pending = pending.slice(index + 1);
            try { const frame = JSON.parse(line); if (typeof frame.dataBase64 === "string") output(Buffer.from(frame.dataBase64, "base64")); else if (Number.isInteger(frame.exitCode)) finish(entry, frame.exitCode); }
            catch { output(Buffer.from("Terminal output could not be read.\r\n")); stop(); }
          }
        });
        child.stderr.on("data", bytes => output(bytes));
        child.on("error", () => { output(Buffer.from("Could not start the server terminal.\r\n")); finish(entry, -1); });
        child.on("close", code => finish(entry, code ?? -1));
        return snapshot();
      })().finally(() => { starting = null; });
      return starting;
    };
    const active = handle => {
      if (!terminal?.running || terminal.handle !== handle) throw new Error("This terminal has ended. Open a new terminal.");
      return terminal;
    };
    ws.on("message", async raw => {
      let frame;
      try {
        frame = JSON.parse(String(raw));
        if (typeof frame.id !== "string" || frame.id.length > 100 || frame.params?.threadId !== host.alias) throw new Error("Invalid terminal request.");
        const p = frame.params; let result = {};
        if (frame.method === "session.terminal.subscribe") { result = terminal ? snapshot() : await start(); }
        else if (frame.method === "session.terminal.start") result = await start();
        else if (frame.method === "session.terminal.unsubscribe") result = {};
        else if (frame.method === "session.terminal.stop") { active(p.handle); stop(); }
        else if (frame.method === "session.terminal.write") {
          const entry = active(p.handle);
          if (typeof p.dataBase64 !== "string" || !p.dataBase64 || p.dataBase64.length > 24 * 1024 || !/^[A-Za-z\d+/]*={0,2}$/.test(p.dataBase64)) throw new Error("Invalid terminal input.");
          if (entry.child.stdin.writableLength > OUTPUT_BYTES) throw new Error("Terminal input is busy. Wait and retry.");
          entry.child.stdin.write(JSON.stringify({ type: "write", dataBase64: p.dataBase64 }) + "\n");
        } else if (frame.method === "session.terminal.resize") {
          const entry = active(p.handle);
          if (!Number.isInteger(p.cols) || !Number.isInteger(p.rows) || p.cols < 2 || p.cols > 500 || p.rows < 1 || p.rows > 200) throw new Error("Invalid terminal size.");
          entry.child.stdin.write(JSON.stringify({ type: "resize", cols: p.cols, rows: p.rows }) + "\n");
        } else throw new Error("Unknown terminal operation.");
        send({ type: "res", id: frame.id, ok: true, payload: result });
      } catch (error) { send({ type: "res", id: typeof frame?.id === "string" ? frame.id : "", ok: false, error: error.message }); }
    });
    ws.on("close", () => { closed = true; stop(); if (terminal?.timer) clearTimeout(terminal.timer); });
    ws.on("error", () => ws.close());
  }
  return { handleUpgrade, close() { for (const client of wss.clients) client.close(1001, "Server is closing"); wss.close(); } };
}
module.exports = { createServerTerminals };
