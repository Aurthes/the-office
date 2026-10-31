"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { sessionChoices, settingsPatch } = require("./codex-session-settings");

const ACCESS = {
  ":read-only": { approvalPolicy: "on-request", sandbox: "read-only", policy: "readOnly" },
  ":workspace": { approvalPolicy: "on-request", sandbox: "workspace-write", policy: "workspaceWrite" },
  ":danger-full-access": { approvalPolicy: "never", sandbox: "danger-full-access", policy: "dangerFullAccess" },
};
const missingRollout = error => /no rollout found|thread .* not found/i.test(error.message);

// Office records only its own grouping, stable session IDs and Codex thread IDs.
// Codex manages conversation persistence through RPC; no SQLite/JSONL reads.
class CodexOfficeStore {
  constructor(directory, client, changed = () => {}) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = path.join(directory, "office.json"); this.client = client; this.changed = changed; this.inflight = new Map();
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, "utf8")) : { projects: [], sessions: [], requests: {} };
    if (!Array.isArray(this.data.projects) || !Array.isArray(this.data.sessions) || !this.data.requests) throw new Error("Invalid Office state; refusing to overwrite it");
    for (const session of this.data.sessions) if (session.status === "running") session.status = "unknown";
  }
  get ready() { return this.client.ready; }
  save() { const temporary = this.file + ".tmp"; fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2) + "\n", { mode: 0o600 }); fs.renameSync(temporary, this.file); this.changed(); }
  projects() { return this.data.projects; }
  get(id) { const row = this.data.sessions.find(s => s.id === id && !s.archived); if (!row) throw new Error("Office session is missing or archived"); return row; }
  list() { return this.data.sessions.filter(s => !s.archived).map(s => ({ ...s, project: this.data.projects.find(p => p.id === s.projectId)?.name || "Open Workspace", workspace: s.workspace, model: s.settings?.model || this.defaultModel || null, effort: s.settings?.effort || null, completedResult: s.completionKey ? { key: s.completionKey, unread: false } : null })); }
  name(value) { if (typeof value !== "string" || !value.trim() || value.trim().length > 120) throw new Error("Name must contain 1–120 characters"); return value.trim(); }
  directory(value) { if (typeof value !== "string" || !path.isAbsolute(value) || !fs.statSync(value, { throwIfNoEntry: false })?.isDirectory()) throw new Error("Choose an existing absolute project directory on the Codex computer"); return fs.realpathSync(value); }
  once(input, action) {
    const id = input.requestId;
    if (typeof id !== "string" || !id || id.length > 128 || ["__proto__", "constructor", "prototype"].includes(id)) throw new Error("An operation ID is required");
    const hash = JSON.stringify(input), previous = this.data.requests[id];
    if (previous) { if (previous.hash !== hash) throw new Error("Operation ID conflict"); if (previous.result) return Promise.resolve(previous.result); throw new Error("This operation was submitted; check the result before retrying"); }
    this.data.requests[id] = { hash }; this.save();
    return Promise.resolve().then(action).then(result => { this.data.requests[id].result = result; const keys = Object.keys(this.data.requests); for (const key of keys.slice(0, Math.max(0, keys.length - 128))) delete this.data.requests[key]; this.save(); return result; });
  }
  createProject(input) { const name = this.name(input.name), workspace = this.directory(input.workspace); return this.once(input, () => { const project = { id: crypto.randomUUID(), name, rootPaths: [workspace] }; this.data.projects.push(project); return { project }; }); }
  createSession(input) {
    const name = this.name(input.name), project = this.data.projects.find(p => p.id === input.projectId);
    if (!project) throw new Error("Choose an Office project");
    const workspace = this.directory(project.rootPaths[0]);
    return this.once(input, () => { const session = { id: crypto.randomUUID(), name, workspace, projectId: project.id, updatedAt: Date.now(), status: "idle", settings: { model: null, effort: null, accessMode: ":workspace" } }; this.data.sessions.push(session); return { threadId: session.id }; });
  }
  renameSession(input) { const row = this.get(input.threadId), name = this.name(input.name); return this.once(input, () => { row.name = name; return { threadId: row.id, name }; }); }
  reassignSession(input) { const row = this.get(input.threadId), project = this.data.projects.find(p => p.id === input.projectId); if (!project) throw new Error("Choose an Office project"); return this.once(input, () => { row.projectId = project.id; return { threadId: row.id, projectId: project.id, project: project.name }; }); }
  archiveSession(input) { return this.once(input, async () => { const row = this.get(input.threadId); if (row.status === "running") throw new Error("Stop this task before archiving"); if (row.codexThreadId && row.hasTurns) await this.client.call("thread/archive", { threadId: row.codexThreadId }); row.archived = true; return { threadId: row.id, archived: true }; }); }
  current(id, result = {}) {
    const row = this.get(id);
    return { model: row.settings.model || result.model || this.defaultModel || "", effort: row.settings.effort ?? result.reasoningEffort ?? null, accessMode: row.settings.accessMode };
  }
  async choices(id) {
    const choices = await sessionChoices(this.client, this.get(id).workspace);
    this.defaultModel ||= choices.models[0]?.id;
    return { ...choices, accessModes: choices.accessModes.filter(p => ACCESS[p.id]) };
  }
  async update(id, input) {
    const row = this.get(id), choices = await this.choices(id), patch = settingsPatch(input, this.current(id), choices);
    row.settings = { ...row.settings, ...(patch.model ? { model: patch.model } : {}), ...(patch.effort ? { effort: patch.effort } : {}), ...(patch.permissions ? { accessMode: patch.permissions } : {}) };
    this.save(); return { updated: true };
  }
  overrides(id) {
    const row = this.get(id), access = ACCESS[row.settings.accessMode];
    return { ...(row.settings.model ? { model: row.settings.model } : {}), ...(row.settings.effort ? { effort: row.settings.effort } : {}), approvalPolicy: access.approvalPolicy,
      sandboxPolicy: { type: access.policy, ...(access.policy === "workspaceWrite" ? { writableRoots: [row.workspace], networkAccess: false } : access.policy === "readOnly" ? { networkAccess: false } : {}) } };
  }
  emptyContext(row) { return { ...this.current(row.id), cwd: row.workspace, thread: { id: row.id }, reasoningEffort: row.settings.effort }; }
  async ensureThread(row) {
    if (row.codexThreadId) return;
    if (!this.inflight.has(row.id)) this.inflight.set(row.id, (async () => {
      const mode = ACCESS[row.settings.accessMode];
      const result = await this.client.call("thread/start", { cwd: row.workspace, sandbox: mode.sandbox, approvalPolicy: mode.approvalPolicy, ...(row.settings.model ? { model: row.settings.model } : {}) });
      row.codexThreadId = result.thread.id; this.save();
    })().finally(() => this.inflight.delete(row.id)));
    await this.inflight.get(row.id);
  }
  async call(method, params = {}) {
    if (!params.threadId) return this.client.call(method, params);
    const row = this.get(params.threadId);
    if (method === "thread/resume" && !row.codexThreadId) return this.emptyContext(row);
    if (method === "thread/turns/list" && !row.codexThreadId) return { data: [], nextCursor: null };
    if (method === "turn/start") await this.ensureThread(row);
    if (!row.codexThreadId) throw new Error("This Office session has no Codex turn yet");
    const mapped = { ...params, threadId: row.codexThreadId };
    if (method === "turn/start") { row.attemptedTurn = true; this.save(); }
    try { return await this.client.call(method, mapped); }
    catch (error) {
      if (["thread/resume", "thread/turns/list"].includes(method) && !row.attemptedTurn && !row.hasTurns && missingRollout(error)) {
        row.codexThreadId = null; this.save(); return method === "thread/resume" ? this.emptyContext(row) : { data: [], nextCursor: null };
      }
      if (method === "turn/start" && error.code !== undefined && !row.hasTurns) { row.attemptedTurn = false; this.save(); }
      throw error;
    }
  }
  respond(id, result) { return this.client.respond(id, result); }
  handle(frame) {
    const p = frame.params || {}, nativeId = p.threadId || p.thread?.id;
    if (!nativeId) return frame;
    const row = this.data.sessions.find(s => s.codexThreadId === nativeId);
    if (!row) return null;
    if (frame.method === "turn/started") { row.hasTurns = true; row.status = "running"; row.updatedAt = Date.now(); this.save(); }
    if (frame.method === "turn/completed") { row.status = p.turn.status === "failed" ? "error" : "idle"; row.updatedAt = Date.now(); row.completionKey = p.turn.id; this.save(); }
    return { ...frame, params: { ...p, ...(p.threadId ? { threadId: row.id } : {}), ...(p.thread ? { thread: { ...p.thread, id: row.id } } : {}) } };
  }
}
module.exports = { CodexOfficeStore, ACCESS };
