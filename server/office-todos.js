"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const uuid = () => crypto.randomUUID();
const text = (value, name, max, empty = false) => {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > max) throw new Error(`${name} must contain ${empty ? "0" : "1"}–${max} characters`);
  return value.trim();
};
const duration = (phase, now) => phase.elapsedMs + (phase.startedAt == null ? 0 : Math.max(0, now - phase.startedAt));
const completionTime = row => {
  if (row.status !== "done") return null;
  if (Number.isFinite(row.completedAt)) return row.completedAt;
  const times = row.phases.map(phase => phase.completedAt);
  return times.length && times.every(time => Number.isFinite(time)) ? Math.max(...times) : null;
};
const activeDelegation = row => (row.delegations || []).findLast(entry => !["accepted", "recalled"].includes(entry.state));
class OfficeTodos {
  constructor(directory, { projects, agents, changed = () => {}, now = Date.now }) {
    this.directory = path.join(directory, "todos"); this.projects = projects; this.agents = agents; this.changed = changed; this.now = now;
    this.rows = new Map(); this.requests = new Map(); this.bindings = new Map();
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    for (const file of fs.readdirSync(this.directory).filter(file => /^[a-f0-9-]{36}\.json$/.test(file))) {
      const row = JSON.parse(fs.readFileSync(path.join(this.directory, file), "utf8"));
      if (row.version !== 1 || `${row.id}.json` !== file || !Array.isArray(row.phases) || !Number.isInteger(row.revision)) throw new Error("Invalid to-do state; refusing to overwrite it");
      this.rows.set(row.id, row); if (row.requestId) this.requests.set(row.requestId, row.id);
      if (row.status === "running") {
        this.stopClock(row, row.savedAt); row.status = "paused"; row.revision++;
        this.event(row, "Office restarted; timer paused at the last checkpoint", { source: "system" }); this.save(row);
      }
      if (row.status === "done" && (!row.archived || row.completedAt !== completionTime(row))) {
        const needsArchive = !row.archived;
        row.completedAt = completionTime(row); row.archived = true; row.revision++;
        if (needsArchive) this.event(row, "Completed task automatically archived", { source: "system", name: "Office" });
        this.save(row);
      }
    }
  }
  actor(input = {}) {
    if (input.actorId) { const agent = this.agents().find(a => a.id === input.actorId); if (!agent) throw new Error("Choose an existing Office agent"); return { source: "agent", id: agent.id, name: agent.name }; }
    return { source: input.source === "system" ? "system" : "user", name: input.source === "system" ? "Office" : "User" };
  }
  event(row, message, actor) { row.events.push({ at: this.now(), message, actor }); row.events = row.events.slice(-100); }
  save(row) {
    row.savedAt = this.now();
    const file = path.join(this.directory, `${row.id}.json`), temporary = `${file}.${uuid()}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify(row) + "\n", { mode: 0o600, flag: "wx" }); fs.renameSync(temporary, file); }
    finally { fs.rmSync(temporary, { force: true }); }
    this.rows.set(row.id, row);
  }
  raw(id) { const row = this.rows.get(id); if (!row) throw new Error("To-do is missing"); return row; }
  stopClock(row, now = this.now()) { for (const phase of row.phases) if (phase.startedAt != null) { phase.elapsedMs = duration(phase, now); phase.startedAt = null; } }
  run(row) {
    this.stopClock(row); const phase = row.phases.find(p => p.completedAt == null);
    row.status = phase ? "running" : "done"; if (phase) { phase.startedAt = this.now(); row.lastStartedAt = this.now(); }
  }
  references(input, previous) {
    const departmentId = input.departmentId === undefined ? previous?.departmentId ?? null : input.departmentId;
    const assigneeId = input.assigneeId === undefined ? previous?.assigneeId ?? null : input.assigneeId;
    const department = departmentId == null ? { name: "Open Workspace" } : this.projects().find(p => p.id === departmentId);
    if (!department && departmentId !== previous?.departmentId) throw new Error("Choose an existing department");
    const agent = assigneeId == null ? null : this.agents().find(a => a.id === assigneeId);
    if (assigneeId != null && !agent && assigneeId !== previous?.assigneeId) throw new Error("Choose an existing agent or Unassigned");
    return { departmentId, departmentName: department?.name || previous.departmentName, assigneeId, assigneeName: agent?.name || (assigneeId ? previous?.assigneeName : null) };
  }
  plan(input, previous = []) {
    if (!Array.isArray(input) || !input.length || input.length > 20) throw new Error("Define 1–20 phases");
    const seen = new Set();
    return input.map(phase => {
      if (!phase || typeof phase !== "object") throw new Error("Each phase needs a title");
      const old = phase.id ? previous.find(p => p.id === phase.id) : undefined;
      if (phase.id && !old) throw new Error("Phase is missing; refresh the to-do");
      const id = old?.id || uuid(); if (seen.has(id)) throw new Error("Phase IDs must be unique"); seen.add(id);
      return { id, title: text(phase.title, "Phase title", 160), notes: text(phase.notes ?? old?.notes ?? "", "Phase notes", 3000, true),
        elapsedMs: old?.elapsedMs || 0, startedAt: old?.startedAt ?? null, completedAt: old?.completedAt ?? null };
    });
  }
  view(row, full = false, { projects = this.projects(), agents = this.agents() } = {}) {
    const department = projects.find(p => p.id === row.departmentId), agent = agents.find(a => a.id === row.assigneeId);
    const { events, documentation, ...rest } = row;
    delete rest.requestId; delete rest.requestHash;
    if (!full && rest.delegations) rest.delegations = rest.delegations.map(({ id, managerId, workerId, state }) => ({ id, managerId, workerId, state }));
    return { ...rest, completedAt: completionTime(row), departmentName: department?.name || row.departmentName, assigneeName: agent?.name || row.assigneeName,
      assigneeAvailable: !!agent, ...(full ? { documentation, events } : {}),
      phases: row.phases.map(phase => full ? { ...phase } : { ...phase, notes: undefined }),
      progress: row.phases.filter(p => p.completedAt != null).length, elapsedMs: row.phases.reduce((sum, phase) => sum + duration(phase, this.now()), 0) };
  }
  get(input) { return { todo: this.view(this.raw(input.id), true), serverTime: this.now() }; }
  catalog({ projects = this.projects(), agents = this.agents() } = {}) {
    return { departments: [{ id: null, name: "Open Workspace" }, ...projects.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))],
      agents: agents.map(({ id, name, projectId, status }) => ({ id, name, projectId, status })) };
  }
  list(input = {}) {
    const sources = { projects: this.projects(), agents: this.agents() };
    const catalog = this.catalog(sources), all = [...this.rows.values()], live = all.filter(row => !row.archived && row.status !== "done");
    const departments = catalog.departments.map(dept => ({ ...dept, total: live.filter(r => r.departmentId === dept.id).length,
      running: live.filter(r => r.departmentId === dept.id && r.status === "running").length, unassigned: live.filter(r => r.departmentId === dept.id && !r.assigneeId && r.status !== "done").length }));
    let rows = input.status === "done" ? all.filter(row => row.status === "done") : input.status === "archived" ? all.filter(row => row.archived || row.status === "done") : live;
    if (input.departmentId !== undefined) rows = rows.filter(row => row.departmentId === input.departmentId);
    if (input.assigneeId !== undefined) rows = rows.filter(row => row.assigneeId === input.assigneeId);
    if (input.status && !["all", "archived"].includes(input.status)) rows = rows.filter(row => row.status === input.status);
    if (input.query) { const query = text(input.query, "Search", 200).toLowerCase(); rows = rows.filter(r => `${r.title}\n${r.documentation}\n${r.assigneeName || ""}`.toLowerCase().includes(query)); }
    rows.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    const offset = Math.max(0, Number.isInteger(input.offset) ? input.offset : 0), limit = Math.min(25, Math.max(1, Number.isInteger(input.limit) ? input.limit : 25));
    return { todos: rows.slice(offset, offset + limit).map(row => this.view(row, false, sources)), total: rows.length, offset, limit, ...catalog, departments, serverTime: this.now() };
  }
  create(input) {
    const requestId = text(input.requestId, "Creation request ID", 160), hash = crypto.createHash("sha256").update(JSON.stringify({ ...input, requestId: undefined })).digest("hex");
    if (this.requests.has(requestId)) {
      const previous = this.raw(this.requests.get(requestId)); if (previous.requestHash !== hash) throw new Error("Creation request ID conflict");
      return { todo: this.view(previous, true), serverTime: this.now() };
    }
    if (this.rows.size >= 10000) throw new Error("The to-do registry has reached its limit");
    const actor = this.actor(input), row = { version: 1, id: uuid(), revision: 1, title: text(input.title, "To-do title", 200),
      documentation: text(input.documentation || "", "Documentation", 24000, true), ...this.references(input), phases: this.plan(input.phases),
      status: "queued", archived: false, completedAt: null, createdAt: this.now(), updatedAt: this.now(), events: [], requestId, requestHash: hash, sourceThreadId: input.sourceThreadId || null };
    this.event(row, "To-do created", actor); this.save(row); this.requests.set(requestId, row.id); this.changed(row.id);
    return { todo: this.view(row, true), serverTime: this.now() };
  }
  change(input, action) {
    const previous = this.raw(input.id);
    if (action === "complete" && previous.phases.find(p => p.id === input.phaseId)?.completedAt != null) return this.get(input);
    if (input.revision !== previous.revision) throw new Error("This to-do changed. Refresh it before saving");
    const row = structuredClone(previous), actor = this.actor(input), delegation = activeDelegation(row); let message;
    if (delegation && ["edit", "archive"].includes(action) && (action === "archive" || input.assigneeId !== undefined && input.assigneeId !== row.assigneeId)) throw new Error("Finish or review the active delegation before reassigning or archiving this task");
    if (row.archived && action !== "restore" && !(row.status === "done" && ["edit", "reopen"].includes(action))) throw new Error("Restore this archived to-do first");
    if (action === "restore" && row.status === "done") throw new Error("Completed tasks stay archived. Add a phase or reopen a completed phase to follow up");
    if (action === "edit") {
      this.stopClock(row);
      if (input.title !== undefined) row.title = text(input.title, "To-do title", 200);
      if (input.documentation !== undefined) row.documentation = text(input.documentation, "Documentation", 24000, true);
      Object.assign(row, this.references(input, row));
      if (input.phases !== undefined) {
        const next = this.plan(input.phases, row.phases);
        for (const old of row.phases.filter(p => !next.some(n => n.id === p.id))) this.event(row, `Removed phase: ${old.title} (${Math.round(old.elapsedMs / 1000)}s)`, actor);
        row.phases = next;
      }
      if (row.phases.every(p => p.completedAt != null)) row.status = "done";
      else if (row.status === "running") this.run(row);
      else if (row.status === "done") row.status = "queued";
      message = "Plan, assignment or documentation updated";
    } else if (action === "delegate") {
      if (actor.id !== row.assigneeId || !row.assigneeId) throw new Error("Only the current responsible agent can delegate this task");
      if (delegation?.state === "review") throw new Error("Review the submitted result before delegating again");
      if (!input.assigneeId || input.assigneeId === actor.id || (row.delegations || []).some(entry => !["accepted", "recalled"].includes(entry.state) && entry.managerId === input.assigneeId)) throw new Error("Choose a direct report outside the active handoff chain");
      const instructions = text(input.instructions, "Delegation scope", 6000), acceptanceCriteria = text(input.acceptanceCriteria, "Acceptance criteria", 3000);
      this.stopClock(row);
      row.delegations ||= [];
      row.delegations.push({ id: uuid(), managerId: actor.id, workerId: input.assigneeId, instructions, acceptanceCriteria, state: "working", createdAt: this.now(),
        delivery: { recipientId: input.assigneeId, requestId: `delegation-${uuid()}`, state: "pending" } });
      Object.assign(row, this.references({ assigneeId: input.assigneeId }, row)); row.status = "queued";
      message = `Delegated to ${row.assigneeName}; manager retains acceptance responsibility`;
    } else if (action === "recall") {
      if (!delegation || actor.id !== delegation.managerId) throw new Error("Only the delegating manager can recall this handoff");
      const reason = text(input.reason, "Recall reason", 500);
      delegation.state = "recalled"; delegation.recalledAt = this.now(); delete delegation.delivery;
      this.stopClock(row); Object.assign(row, this.references({ assigneeId: delegation.managerId }, row)); row.status = "paused";
      message = `Manager recalled delegation: ${reason}`;
    } else if (action === "submit") {
      if (!delegation || delegation.state !== "working" || actor.id !== delegation.workerId || actor.id !== row.assigneeId) throw new Error("Only the assigned worker can submit the active delegation");
      delegation.report = text(input.report, "Delivery report and evidence", 6000); delegation.submittedAt = this.now(); delegation.state = "review";
      delegation.delivery = { recipientId: delegation.managerId, requestId: `delegation-${uuid()}`, state: "pending" };
      this.stopClock(row); Object.assign(row, this.references({ assigneeId: delegation.managerId }, row)); row.status = "paused";
      message = `Submitted for manager acceptance: ${delegation.report}`;
    } else if (action === "review") {
      if (!delegation || delegation.state !== "review" || actor.id !== delegation.managerId || actor.id !== row.assigneeId) throw new Error("Only the delegating manager can review this submission");
      if (typeof input.accept !== "boolean") throw new Error("Choose whether to accept the submitted result");
      const notes = text(input.notes, "Acceptance evidence or return feedback", 6000);
      this.stopClock(row); delegation.review = { accepted: input.accept, notes, at: this.now(), managerId: actor.id };
      delegation.state = input.accept ? "accepted" : "working";
      delete delegation.delivery;
      if (!input.accept) {
        Object.assign(row, this.references({ assigneeId: delegation.workerId }, row));
        delegation.delivery = { recipientId: delegation.workerId, requestId: `delegation-${uuid()}`, state: "pending" };
      }
      row.status = input.accept ? "paused" : "queued";
      message = `${input.accept ? "Manager accepted" : "Manager returned for changes"}: ${notes}`;
    } else if (action === "start") {
      if (row.phases.every(p => p.completedAt != null)) throw new Error("Reopen a completed phase before starting");
      this.run(row); message = "Work started";
    } else if (action === "pause") {
      this.stopClock(row); if (row.status !== "done") row.status = "paused";
      message = input.reason ? text(input.reason, "Pause reason", 500) : "Work paused";
    } else if (action === "complete" || action === "reopen") {
      const phase = row.phases.find(p => p.id === input.phaseId); if (!phase) throw new Error("Phase is missing");
      this.stopClock(row); phase.completedAt = action === "complete" ? this.now() : null; this.run(row);
      message = `${action === "complete" ? "Completed" : "Reopened"} phase: ${phase.title}`;
    } else if (action === "archive" || action === "restore") {
      this.stopClock(row); row.archived = action === "archive"; if (row.status === "running") row.status = "paused";
      message = action === "archive" ? "To-do archived" : "To-do restored";
    } else throw new Error("Unsupported to-do action");
    if (row.status === "done" && activeDelegation(row)) throw new Error("Submit the result and obtain manager acceptance before completing the final phase");
    if (row.status === "done" && row.delegations?.length && actor.id && actor.id !== row.assigneeId) throw new Error("Only the responsible manager can close this delegated goal");
    if (row.status === "done") {
      row.completedAt = previous.status === "done" ? completionTime(previous) : this.now();
      row.archived = true;
      if (previous.status !== "done") message += "; to-do completed and automatically archived";
    } else {
      row.completedAt = null;
      if (previous.status === "done") row.archived = false;
    }
    if (row.status === "running" && row.assigneeId) {
      for (const other of this.rows.values()) if (other.id !== row.id && other.assigneeId === row.assigneeId && other.status === "running") this.change({ id: other.id, revision: other.revision, source: "system", reason: "Agent switched to another to-do" }, "pause");
    }
    row.revision++; row.updatedAt = this.now(); this.event(row, message, actor); this.save(row);
    for (const [agentId, id] of this.bindings) if (id === row.id && (row.archived || row.status === "done" || row.assigneeId !== agentId)) this.bindings.delete(agentId);
    if (row.status === "running" && row.assigneeId) this.bindings.set(row.assigneeId, row.id);
    this.changed(row.id); return { todo: this.view(row, true), serverTime: this.now() };
  }
  delivery(id, requestId, state, error) {
    const previous = this.raw(id), row = structuredClone(previous), entry = activeDelegation(row);
    if (!entry?.delivery || entry.delivery.requestId !== requestId) return;
    entry.delivery.state = state;
    if (error) entry.delivery.error = String(error).slice(0, 500);
    row.revision++; row.updatedAt = this.now(); this.save(row); this.changed(row.id);
  }
  delegated(agentId) {
    return [...this.rows.values()].filter(row => !row.archived && row.status !== "done" && (row.delegations || []).some(entry => !["accepted", "recalled"].includes(entry.state) && [entry.managerId, entry.workerId].includes(agentId)))
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20)
      .map(row => { const entry = activeDelegation(row); return { id: row.id, assigneeId: row.assigneeId, managerId: entry.managerId, workerId: entry.workerId, state: entry.state, delivery: entry.delivery?.state }; });
  }
  bound(agentId) {
    const preferred = this.rows.get(this.bindings.get(agentId));
    if (preferred && !preferred.archived && preferred.status !== "done" && preferred.assigneeId === agentId) return preferred;
    return [...this.rows.values()].filter(r => !r.archived && r.assigneeId === agentId && r.status !== "done").sort((a, b) => (b.lastStartedAt || 0) - (a.lastStartedAt || 0) || b.updatedAt - a.updatedAt)[0] || null;
  }
  startForAgent(agentId, id) {
    const row = this.raw(id);
    if (row.assigneeId !== agentId || row.archived || row.status === "done") throw new Error("Choose an unfinished to-do assigned to this agent");
    for (const other of this.rows.values()) if (other.id !== id && other.assigneeId === agentId && other.status === "running") this.change({ id: other.id, revision: other.revision, source: "system", reason: "Agent switched to another to-do" }, "pause");
    if (row.status !== "running") this.change({ id, revision: row.revision, source: "system" }, "start");
    this.bindings.set(agentId, id); return this.raw(id);
  }
  finishTurn(agentId, status) {
    const row = this.bound(agentId);
    if (row?.status === "running") this.change({ id: row.id, revision: row.revision, source: "system", reason: status === "completed" ? "Agent turn ended; waiting for follow-up or a phase update" : `Agent turn ${status}; timer paused` }, "pause");
  }
  checkpoint() { for (const row of this.rows.values()) if (row.status === "running") { const next = structuredClone(row); this.stopClock(next); const phase = next.phases.find(p => p.completedAt == null); if (phase) phase.startedAt = this.now(); this.save(next); } }
  close() { for (const row of [...this.rows.values()]) if (row.status === "running") this.change({ id: row.id, revision: row.revision, source: "system", reason: "Office stopped; timer paused" }, "pause"); }
}
module.exports = { OfficeTodos, phaseDuration: duration, activeDelegation };
