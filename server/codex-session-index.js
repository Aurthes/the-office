"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

// The App remains the writer. This index never starts, resumes, or edits a thread.
class CodexSessionIndex {
  constructor(home) {
    this.home = path.resolve(home);
    this.db = new DatabaseSync(path.join(this.home, "state_5.sqlite"), { readOnly: true });
    this.states = new Map();
  }
  list() {
    return this.db.prepare(`SELECT id, name, title, cwd, rollout_path, updated_at, model,
      reasoning_effort, is_pinned FROM threads WHERE archived = 0
      AND source IN ('vscode', 'cli', 'appServer') ORDER BY updated_at DESC`).all().map(row => {
      const name = row.name || row.title || row.id;
      return { id: row.id, name, workspace: row.cwd, project: path.basename(row.cwd),
        updatedAt: row.updated_at * 1000, model: row.model, effort: row.reasoning_effort,
        pinned: Boolean(row.is_pinned), ...this.status(row.rollout_path) };
    });
  }
  status(filename) {
    if (typeof filename !== "string" || !filename) return { status: "unknown" };
    const resolved = path.resolve(filename);
    if (!resolved.startsWith(this.home + path.sep) || !resolved.endsWith(".jsonl")) return { status: "unknown" };
    let stat;
    try { stat = fs.statSync(resolved); } catch { return { status: "unknown" }; }
    const cached = this.states.get(resolved);
    if (cached?.size === stat.size && cached.mtime === stat.mtimeMs) return cached.value;
    const reusable = cached?.ino === stat.ino && stat.size >= cached.size;
    const floor = reusable ? Math.max(0, cached.size - 8192) : 0;
    let fd;
    try { fd = fs.openSync(resolved, "r"); }
    catch { return { status: "unknown" }; } // The App may archive it after stat.
    let end = stat.size, suffix = Buffer.alloc(0), value = reusable ? cached.value : { status: "unknown" };
    try {
      while (end > floor) {
        const start = Math.max(floor, end - 65536), chunk = Buffer.alloc(end - start);
        fs.readSync(fd, chunk, 0, chunk.length, start);
        const data = Buffer.concat([chunk, suffix]);
        const lines = data.toString("utf8").split("\n");
        if (start > 0) suffix = Buffer.from(lines.shift() || "").subarray(0, 8192);
        for (let i = lines.length - 1; i >= 0; i--) {
          // Match the outer record prefix, never quoted task markers in tool/user text.
          // A completion can carry a very large last message: its prefix is enough.
          const marker = lines[i].match(/^\{"timestamp"\s*:\s*"([^"]+)"\s*,\s*(?:"ordinal"\s*:\s*\d+\s*,\s*)?"type"\s*:\s*"event_msg"\s*,\s*"payload"\s*:\s*\{"type"\s*:\s*"(task_started|task_complete|turn_aborted)"/);
          if (!marker) continue;
          value = { status: marker[2] === "task_started" ? "running" : "idle", statusAt: Date.parse(marker[1]) };
          end = 0; break;
        }
        if (end === 0) break;
        end = start;
      }
    } finally { fs.closeSync(fd); }
    this.states.set(resolved, { size: stat.size, mtime: stat.mtimeMs, ino: stat.ino, value });
    return value;
  }
  close() { this.db.close(); }
}
module.exports = { CodexSessionIndex };
