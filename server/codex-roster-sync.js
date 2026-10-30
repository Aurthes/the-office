"use strict";
const fs = require("node:fs");

// Native events are primary. Watch legacy App project edits too; one server-side
// check every 30s recovers missed events without a polling loop in each browser.
class CodexRosterSync {
  constructor(index, notify) { this.index = index; this.notify = notify; this.revision = 0; }
  signature() {
    return JSON.stringify({ projects: this.index.projects(), agents: this.index.list().map(row => ({
      id: row.id, name: row.name, workspace: row.workspace, projectId: row.projectId,
      status: row.status, model: row.model, effort: row.effort, pinned: row.pinned,
    })).sort((a, b) => a.id.localeCompare(b.id)) });
  }
  start() {
    this.previous = this.signature();
    this.watch = fs.watch(this.index.home, (_event, file) => {
      if ([".codex-global-state.json", "state_5.sqlite", "state_5.sqlite-wal"].includes(String(file))) this.changed();
    });
    this.watch.on("error", () => { this.watch.close(); });
    this.interval = setInterval(() => this.check(), 30000); this.interval.unref();
  }
  native(frame) {
    this.index.handle(frame);
    if (["project/changed", "thread/started", "thread/archived", "thread/deleted", "thread/unarchived",
      "thread/name/updated", "thread/project/updated", "thread/status/changed", "turn/started", "turn/completed"].includes(frame.method)) this.changed();
  }
  changed() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.check(); }, 150);
  }
  check() {
    try {
      const signature = this.signature();
      if (signature === this.previous) return;
      this.previous = signature; this.notify({ revision: ++this.revision });
    } catch (error) { console.error("[roster] Read failed; retaining the last roster:", error.message); }
  }
  close() { clearTimeout(this.timer); clearInterval(this.interval); this.watch?.close(); }
}
module.exports = { CodexRosterSync };
