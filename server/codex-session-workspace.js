"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { referenceForPath } = require("./codex-session-assets");

const OUTPUT_BYTES = 64 * 1024;
const FILE_BYTES = 256 * 1024;

// Files and PTYs belong to the existing Codex owner. No second agent/runtime.
class CodexSessionWorkspace {
  constructor(client, options = {}) {
    this.client = client;
    this.options = options;
    this.terminals = new Map();
    this.starts = new Map();
    this.listeners = new Map();
  }
  ready() { if (!this.client?.ready) throw new Error("Codex workspace is disconnected"); }
  async target(row, relative = "", selectedRoot) {
    if (typeof relative !== "string" || relative.length > 4096 || /[\0\r\n]/.test(relative)) throw new Error("Invalid workspace path");
    const roots = this.options.roots ? this.options.roots(row) : [row.workspace];
    if (selectedRoot !== undefined && !roots.includes(selectedRoot)) throw new Error("Choose a folder attached to this project");
    const root = await fs.realpath(selectedRoot ?? row.workspace);
    const requested = path.resolve(root, relative);
    const resolved = await fs.realpath(requested);
    const inside = path.relative(root, resolved);
    if (inside === ".." || inside.startsWith(".." + path.sep) || path.isAbsolute(inside)) throw new Error("File is outside this workspace");
    return { root, resolved, relative: inside.split(path.sep).join("/") };
  }
  async files(row, relative, selectedRoot) {
    this.ready(); const target = await this.target(row, relative, selectedRoot);
    const result = await this.client.call("fs/readDirectory", { path: target.resolved });
    const entries = result.entries.filter(entry => typeof entry.fileName === "string" && entry.fileName && !/[\/\\\0]/.test(entry.fileName) && ![".", "..", ".git", "node_modules", ".next"].includes(entry.fileName))
      .sort((a, b) => Number(Boolean(b.isDirectory)) - Number(Boolean(a.isDirectory)) || a.fileName.localeCompare(b.fileName));
    return { path: target.relative, ...(this.options.roots ? { root: target.root, roots: this.options.roots(row) } : {}), entries: entries.slice(0, 300).map(entry => ({ name: entry.fileName, directory: Boolean(entry.isDirectory) })), truncated: entries.length > 300 };
  }
  async file(row, relative, selectedRoot) {
    this.ready(); const target = await this.target(row, relative, selectedRoot);
    const stat = await fs.stat(target.resolved);
    if (!stat.isFile()) throw new Error("Not a regular file");
    const asset = referenceForPath(target.resolved);
    if (asset) return { path: target.relative, asset };
    if (stat.size > FILE_BYTES) throw new Error("File is too large for inline preview (256 KB)");
    const result = await this.client.call("fs/readFile", { path: target.resolved });
    const bytes = Buffer.from(result.dataBase64, "base64");
    if (bytes.length > FILE_BYTES || bytes.includes(0)) throw new Error("This file cannot be shown as text");
    return { path: target.relative, content: bytes.toString("utf8") };
  }
  snapshot(threadId) {
    const terminal = this.terminals.get(threadId);
    return terminal ? { handle: terminal.handle, running: terminal.running, exitCode: terminal.exitCode, offset: terminal.offset, dataBase64: terminal.output.toString("base64") } : null;
  }
  subscribe(ws, threadId) {
    this.ready(); this.listeners.set(ws, threadId);
    const terminal = this.terminals.get(threadId);
    if (terminal && !terminal.inputBytes) terminal.inputTail = Promise.resolve();
    return this.snapshot(threadId);
  }
  disconnected(ws) { this.listeners.delete(ws); }
  async start(row) {
    this.ready();
    if (this.starts.has(row.id)) return this.starts.get(row.id);
    if (this.terminals.get(row.id)?.running) return this.snapshot(row.id);
    // Per-chat deduplication keeps a lost response from creating another shell.
    const pending = this.spawn(row).finally(() => this.starts.delete(row.id));
    this.starts.set(row.id, pending); return pending;
  }
  async spawn(row) {
    const policy = this.options.commandExec ? this.options.policy(row.id) : undefined;
    const { root } = await this.target(row);
    const terminal = { threadId: row.id, handle: crypto.randomUUID(), output: Buffer.alloc(0), pending: Buffer.alloc(0), offset: 0, running: true, exitCode: null, timer: null, reset: false };
    this.terminals.set(row.id, terminal);
    if (this.options.commandExec) {
      // Public command/exec stays pending until exit; output arrives as events.
      void this.client.call("command/exec", { processId: terminal.handle, command: [os.userInfo().shell || process.env.SHELL || "/bin/sh", "-l"], cwd: root,
        tty: true, streamStdin: true, streamStdoutStderr: true, disableTimeout: true, disableOutputCap: true, size: { rows: 24, cols: 80 }, sandboxPolicy: policy }, 0)
        .then(result => { terminal.running = false; terminal.exitCode = result.exitCode; this.flush(terminal); }, error => {
          terminal.running = false; terminal.exitCode = -1; terminal.pending = Buffer.from(error.message + "\r\n"); terminal.output = terminal.pending; this.flush(terminal);
        });
      return this.snapshot(row.id);
    }
    try {
      await this.client.call("process/spawn", { processHandle: terminal.handle, command: [os.userInfo().shell || process.env.SHELL || "/bin/sh", "-l"], cwd: root,
        tty: true, streamStdin: true, streamStdoutStderr: true, outputBytesCap: null, timeoutMs: null, size: { rows: 24, cols: 80 } });
    } catch (error) {
      // A native rejection is definitive; a timeout is not. Keep the handle
      // on an unknown outcome so reconnect/retry cannot create another shell.
      if (error.code !== undefined) terminal.running = false;
      this.flush(terminal); throw error;
    }
    return this.snapshot(row.id);
  }
  active(threadId, handle) {
    this.ready(); const terminal = this.terminals.get(threadId);
    if (!terminal || terminal.handle !== handle || !terminal.running) throw new Error("This terminal has ended. Open a new terminal.");
    return terminal;
  }
  async write(threadId, handle, dataBase64) {
    const terminal = this.active(threadId, handle);
    if (typeof dataBase64 !== "string" || !dataBase64 || dataBase64.length > 24 * 1024 || !/^[A-Za-z\d+/]*={0,2}$/.test(dataBase64)) throw new Error("Terminal input is too large or invalid");
    const bytes = Buffer.byteLength(dataBase64);
    if ((terminal.inputBytes || 0) + bytes > OUTPUT_BYTES) throw new Error("Terminal input is busy. Wait and retry.");
    terminal.inputBytes = (terminal.inputBytes || 0) + bytes;
    // Preserve keystroke order only within this PTY. A failed write stops the
    // queued suffix; resubscribe to inspect the screen before typing again.
    const result = (terminal.inputTail || Promise.resolve()).then(() => this.client.call(this.options.commandExec ? "command/exec/write" : "process/writeStdin", { [this.options.commandExec ? "processId" : "processHandle"]: terminal.handle, deltaBase64: dataBase64 }));
    terminal.inputTail = result;
    try { return await result; } finally { terminal.inputBytes -= bytes; }
  }
  async resize(threadId, handle, cols, rows) {
    const terminal = this.active(threadId, handle);
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || cols > 500 || rows < 1 || rows > 200) throw new Error("Invalid terminal size");
    return this.client.call(this.options.commandExec ? "command/exec/resize" : "process/resizePty", { [this.options.commandExec ? "processId" : "processHandle"]: terminal.handle, size: { cols, rows } });
  }
  async stop(threadId, handle) {
    const terminal = this.active(threadId, handle);
    return this.client.call(this.options.commandExec ? "command/exec/terminate" : "process/kill", { [this.options.commandExec ? "processId" : "processHandle"]: terminal.handle });
  }
  handle(frame) {
    if (frame.method === "command/exec/outputDelta") frame = { method: "process/outputDelta", params: { ...frame.params, processHandle: frame.params.processId } };
    if (!["process/outputDelta", "process/exited"].includes(frame.method)) return;
    const params = frame.params || {}, terminal = [...this.terminals.values()].find(entry => entry.handle === params.processHandle);
    if (!terminal) return;
    if (frame.method === "process/exited") { terminal.running = false; terminal.exitCode = params.exitCode; }
    else {
      const bytes = Buffer.from(params.deltaBase64 || "", "base64");
      terminal.offset += bytes.length;
      terminal.output = Buffer.concat([terminal.output, bytes]).subarray(-OUTPUT_BYTES);
      while (terminal.output.length && (terminal.output[0] & 0xc0) === 0x80) terminal.output = terminal.output.subarray(1);
      terminal.pending = Buffer.concat([terminal.pending, bytes]);
      if (terminal.pending.length > OUTPUT_BYTES) { terminal.pending = terminal.output; terminal.reset = true; }
    }
    if (![...this.listeners.values()].includes(terminal.threadId)) { terminal.pending = Buffer.alloc(0); terminal.reset = false; if (!terminal.running) this.flush(terminal); return; }
    if (!terminal.timer) terminal.timer = setTimeout(() => { terminal.timer = null; this.flush(terminal); }, 30);
  }
  flush(terminal) {
    const payload = { threadId: terminal.threadId, handle: terminal.handle, running: terminal.running, exitCode: terminal.exitCode, offset: terminal.offset, reset: terminal.reset, dataBase64: terminal.pending.toString("base64") };
    const frame = JSON.stringify({ type: "event", event: "session.terminal", payload });
    terminal.pending = Buffer.alloc(0); terminal.reset = false;
    for (const [ws, threadId] of this.listeners) {
      if (threadId !== terminal.threadId || ws.readyState !== 1) continue;
      if (ws.bufferedAmount + Buffer.byteLength(frame) > 1024 * 1024) { this.listeners.delete(ws); ws.close(1013, "Terminal backpressure; reconnect to resync"); }
      else ws.send(frame);
    }
    // Keep ended previews bounded without terminating any running process.
    const ended = [...this.terminals.values()].filter(entry => !entry.running);
    for (const entry of ended.slice(0, Math.max(0, ended.length - 16))) this.terminals.delete(entry.threadId);
  }
  async close() {
    this.listeners.clear();
    for (const terminal of this.terminals.values()) if (terminal.timer) clearTimeout(terminal.timer);
    await Promise.allSettled([...this.terminals.values()].filter(entry => entry.running).map(entry => this.stop(entry.threadId, entry.handle)));
  }
}
module.exports = { CodexSessionWorkspace, OUTPUT_BYTES };
