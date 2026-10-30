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
    const columns = new Set(this.db.prepare("PRAGMA table_info(threads)").all().map(column => column.name));
    this.hasProjectIds = columns.has("project_id");
    this.hasModelProvider = columns.has("model_provider");
    this.hasProjects = Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects'").get());
    this.nativeStatuses = new Map();
  }
  list() {
    const state = this.projectState();
    const projects = this.projects(state);
    const migratedIds = state["app-server-project-id-by-legacy-project-id-by-host"]?.[`local:${this.home}`] || {};
    return this.db.prepare(`SELECT id, name, title, cwd, rollout_path, updated_at, model,
      reasoning_effort, is_pinned${this.hasProjectIds ? ", project_id" : ""}${this.hasModelProvider ? ", model_provider" : ""} FROM threads WHERE archived = 0
      AND source IN ('vscode', 'cli', 'appServer') ORDER BY updated_at DESC`).all().map(row => {
      const name = row.name || row.title || row.id;
      const legacyId = state["thread-project-assignments"]?.[row.id]?.projectId;
      const assignedId = row.project_id || migratedIds[legacyId] || legacyId;
      const assigned = assignedId ? { projectId: assignedId } : null;
      const projectless = !row.project_id && (state["projectless-thread-ids"] || []).includes(row.id);
      const project = projectless ? null : assigned ? projects.find(p => p.id === assigned.projectId) :
        projects.flatMap(p => p.rootPaths.filter(root => row.cwd === root || row.cwd.startsWith(root + path.sep))
          .map(root => ({ project: p, length: root.length }))).sort((a, b) => b.length - a.length)[0]?.project;
      const diskStatus = this.status(row.rollout_path), live = this.nativeStatuses.get(row.id);
      const status = live && (!diskStatus.statusAt || live.statusAt >= diskStatus.statusAt) ? live : diskStatus;
      return { id: row.id, name, workspace: row.cwd, projectId: project?.id || null, project: project?.name || "Open Workspace",
        updatedAt: row.updated_at * 1000, model: row.model, modelProvider: row.model_provider, effort: row.reasoning_effort,
        pinned: Boolean(row.is_pinned), ...status };
    });
  }
  projectState() {
    try { return JSON.parse(fs.readFileSync(path.join(this.home, ".codex-global-state.json"), "utf8")); }
    catch { return {}; }
  }
  projects(state = this.projectState()) {
    if (this.hasProjects) {
      const roots = this.db.prepare("SELECT project_id, path FROM project_roots ORDER BY position").all();
      return this.db.prepare("SELECT id, name FROM projects ORDER BY position").all().map(project => ({
        ...project, rootPaths: roots.filter(root => root.project_id === project.id).map(root => root.path),
      }));
    }
    const projects = Object.values(state["local-projects"] || {}).filter(p =>
      typeof p?.id === "string" && typeof p.name === "string" && Array.isArray(p.rootPaths));
    const order = state["project-order"] || [];
    return projects.map(p => ({ id: p.id, name: p.name, rootPaths: p.rootPaths.filter(r => typeof r === "string") }))
      .sort((a, b) => (order.indexOf(a.id) < 0 ? order.length : order.indexOf(a.id)) - (order.indexOf(b.id) < 0 ? order.length : order.indexOf(b.id)));
  }
  handle(frame) {
    const p = frame.params || {}, id = p.threadId || p.thread?.id;
    if (!id) return;
    const type = frame.method === "thread/status/changed" ? p.status?.type :
      frame.method === "turn/started" ? "active" : frame.method === "turn/completed" ? "idle" : null;
    const status = { active: "running", idle: "idle", systemError: "error" }[type];
    if (status) this.nativeStatuses.set(id, { status, statusAt: Date.now() });
    if (["thread/archived", "thread/deleted", "thread/closed"].includes(frame.method)) this.nativeStatuses.delete(id);
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
