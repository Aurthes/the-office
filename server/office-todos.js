"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { taskReplyContext } = require("./office-reply-context");
const { taskTracking } = require("./office-todo-progress");
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
const openDelegations = row => (row.delegations || []).filter(entry => !["accepted", "recalled"].includes(entry.state));
const activeDelegation = (row, phaseId) => openDelegations(row).findLast(entry => entry.phaseId === phaseId);
const isPhaseTask = row => row.executionMode === "phases";
const isWatcherOnlyEdit = input => Object.hasOwn(input, "watcherIds") && Object.keys(input).every(key => ["id", "revision", "actorId", "source", "requestId", "watcherIds"].includes(key));
// Legacy owners need recorded acceptance or one connected original handoff.
// Missing evidence stays missing; an explicitly cleared owner stays cleared.
const taskOwnerId = row => {
  if (!row) return undefined;
  if (Object.hasOwn(row, "ownerId")) return row.ownerId;
  const handoffs = row.delegations || [], root = handoffs[0]?.managerId;
  if (!root) return row.acceptanceManagerId || undefined;
  const connected = new Set([root]);
  for (const entry of handoffs) {
    if (!connected.has(entry.managerId)) return undefined;
    connected.add(entry.workerId);
  }
  if (row.acceptanceManagerId && !connected.has(row.acceptanceManagerId)) return undefined;
  return root;
};
// A new Owner can relinquish only their own old upstream, after its children
// have closed. This is a recorded transfer, never acceptance of another worker.
const canTransferOwnHandoff = (row, entry, actorId) => isPhaseTask(row) && !!actorId && !!entry &&
  taskOwnerId(row) === actorId && entry.workerId === actorId && entry.managerId !== actorId &&
  activeDelegation(row, entry.phaseId)?.id === entry.id;
// Execution attribution and the person handling the workflow are separate.
const handlingAgentId = (row, phaseId) => {
  const entry = activeDelegation(row, phaseId);
  const phase = phaseId && row.phases?.find(p => p.id === phaseId);
  return entry ? entry.state === "review" ? entry.managerId : entry.workerId : isPhaseTask(row)
    ? phase?.assigneeId || phase?.acceptanceManagerId || taskOwnerId(row) : row.acceptanceManagerId || row.assigneeId;
};
class OfficeTodos {
  constructor(directory, { projects, agents, changed = () => {}, now = Date.now, replyContext = () => null }) {
    this.directory = path.join(directory, "todos"); this.projects = projects; this.agents = agents; this.changed = changed; this.now = now;
    this.replyContext = replyContext;
    this.rows = new Map(); this.requests = new Map(); this.bindings = new Map();
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    for (const file of fs.readdirSync(this.directory).filter(file => /^[a-f0-9-]{36}\.json$/.test(file))) {
      const row = JSON.parse(fs.readFileSync(path.join(this.directory, file), "utf8"));
      const checkpointAt = row.savedAt;
      let separated = false;
      if (row.version !== 1 || `${row.id}.json` !== file || !Array.isArray(row.phases) || !Number.isInteger(row.revision)) throw new Error("Invalid to-do state; refusing to overwrite it");
      if (row.executionMode !== undefined && !isPhaseTask(row)) throw new Error("Invalid phase execution mode");
      if (isPhaseTask(row)) this.validatePhases(row);
      this.materializeOwner(row);
      this.rows.set(row.id, row); if (row.requestId) this.requests.set(row.requestId, row.id);
      if (!isPhaseTask(row) && row.status !== "done" && row.delegations?.length && !Object.hasOwn(row, "acceptanceManagerId")) {
        const entry = activeDelegation(row);
        let owner = entry?.managerId || row.assigneeId;
        for (let i = row.delegations.indexOf(entry || row.delegations.at(-1)) - 1; i >= 0; i--) {
          const parent = row.delegations[i];
          if (parent.workerId === owner && parent.state === "working") owner = parent.managerId;
        }
        row.acceptanceManagerId = owner;
        // The old submit branch explicitly assigned the reviewer. Recover only
        // that provable case, never guess from names or rewrite completed work.
        if (entry?.state === "review" && row.assigneeId === entry.managerId) {
          row.assigneeId = entry.workerId; row.assigneeName = this.agents().find(agent => agent.id === entry.workerId)?.name || entry.workerId;
        }
        row.revision++; this.event(row, "Separated execution assignment from manager acceptance", { source: "system", name: "Office" }); separated = true;
      }
      if (row.phases.some(p => p.startedAt != null)) {
        this.stopClock(row, checkpointAt); row.revision++;
        this.event(row, "Office restarted; activity timers stopped at the last checkpoint", { source: "system" }); this.save(row);
      } else if (separated) this.save(row);
      if (row.status === "done" && (!row.archived || row.completedAt !== completionTime(row))) {
        const needsArchive = !row.archived;
        row.completedAt = completionTime(row); row.archived = true; row.revision++;
        if (needsArchive) this.event(row, "Completed task automatically archived", { source: "system", name: "Office" });
        this.save(row);
      }
    }
    // Completed codes are retained: an old reference must never name another task.
    const codes = new Set();
    for (const row of this.rows.values()) if (row.code !== undefined) {
      if (typeof row.code !== "string" || !/^T[1-9]\d*$/.test(row.code) || !Number.isSafeInteger(Number(row.code.slice(1))) || codes.has(row.code)) throw new Error("Invalid or duplicate task code; refusing to overwrite it");
      codes.add(row.code);
    }
    for (const row of [...this.rows.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) if (row.code === undefined) {
      row.code = this.nextCode(); this.save(row, false);
    }
  }
  nextCode() {
    const next = Math.max(0, ...[...this.rows.values()].map(row => row.code ? Number(row.code.slice(1)) : 0)) + 1;
    if (!Number.isSafeInteger(next)) throw new Error("Task codes have reached their limit");
    return `T${next}`;
  }
  actor(input = {}) {
    if (input.actorId) { const agent = this.agents().find(a => a.id === input.actorId); if (!agent) throw new Error("Choose an existing Office agent"); return { source: "agent", id: agent.id, name: agent.name }; }
    return { source: input.source === "system" ? "system" : "user", name: input.source === "system" ? "Office" : "User" };
  }
  event(row, message, actor, details = {}) { row.events.push({ at: this.now(), message, actor, ...details }); row.events = row.events.slice(-100); }
  materializeOwner(row, writing = false) {
    if (Object.hasOwn(row, "ownerId")) return;
    const ownerId = taskOwnerId(row);
    // An existing write freezes unknown legacy ownership as unassigned, so a
    // later handoff cannot manufacture a different historical owner.
    if (ownerId !== undefined || writing) Object.assign(row, { ownerId: ownerId ?? null, ownerName: ownerId ? this.agents().find(agent => agent.id === ownerId)?.name || ownerId : null });
  }
  save(row, checkpoint = true) {
    if (checkpoint) { this.materializeOwner(row, true); row.savedAt = this.now(); }
    const file = path.join(this.directory, `${row.id}.json`), temporary = `${file}.${uuid()}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify(row) + "\n", { mode: 0o600, flag: "wx" }); fs.renameSync(temporary, file); }
    finally { fs.rmSync(temporary, { force: true }); }
    this.rows.set(row.id, row);
  }
  raw(id) {
    const code = typeof id === "string" ? id.trim().toUpperCase() : "";
    const row = this.rows.get(id) || (/^T[1-9]\d*$/.test(code) && [...this.rows.values()].find(row => row.code === code));
    if (!row) throw new Error("To-do is missing"); return row;
  }
  stopClock(row, now = this.now(), phaseId) { for (const phase of row.phases) if ((!phaseId || phase.id === phaseId) && phase.startedAt != null) { phase.elapsedMs = duration(phase, now); phase.startedAt = null; } }
  run(row) {
    this.stopClock(row); const phase = row.phases.find(p => p.completedAt == null);
    row.status = phase ? "running" : "done"; if (phase) { phase.startedAt = this.now(); row.lastStartedAt = this.now(); }
  }
  references(input, previous) {
    const departmentId = input.departmentId === undefined ? previous?.departmentId ?? null : input.departmentId;
    const assigneeId = input.assigneeId === undefined ? previous?.assigneeId ?? null : input.assigneeId;
    const ownerId = input.ownerId === undefined ? taskOwnerId(previous) : input.ownerId;
    const department = departmentId == null ? { name: "Open Workspace" } : this.projects().find(p => p.id === departmentId);
    if (!department && departmentId !== previous?.departmentId) throw new Error("Choose an existing department");
    const agent = assigneeId == null ? null : this.agents().find(a => a.id === assigneeId);
    if (assigneeId != null && !agent && assigneeId !== previous?.assigneeId) throw new Error("Choose an existing agent or Unassigned");
    const owner = ownerId == null ? null : this.agents().find(a => a.id === ownerId);
    if (ownerId != null && !owner && ownerId !== taskOwnerId(previous)) throw new Error("Choose an existing owner or Unassigned");
    let watcherIds = previous?.watcherIds;
    if (input.watcherIds !== undefined) {
      const known = new Set(this.agents().map(agent => agent.id));
      if (!Array.isArray(input.watcherIds) || input.watcherIds.some(id => typeof id !== "string" || !id || !known.has(id) && !previous?.watcherIds?.includes(id))) throw new Error("Choose existing task watchers");
      watcherIds = [...new Set(input.watcherIds)];
    }
    return { ...(watcherIds !== undefined ? { watcherIds } : {}), departmentId, departmentName: department?.name || previous.departmentName, assigneeId, assigneeName: agent?.name || (assigneeId ? previous?.assigneeName : null),
      ...(ownerId !== undefined ? { ownerId, ownerName: owner?.name || (ownerId ? previous?.ownerName || ownerId : null) } : {}) };
  }
  plan(input, previous = [], mode = false) {
    if (!Array.isArray(input) || !input.length || input.length > 20) throw new Error("Define 1–20 phases");
    const seen = new Set();
    return input.map(phase => {
      if (!phase || typeof phase !== "object") throw new Error("Each phase needs a title");
      const old = phase.id ? previous.find(p => p.id === phase.id) : undefined;
      if (phase.id && !old) throw new Error("Phase is missing; refresh the to-do");
      const id = old?.id || uuid(); if (seen.has(id)) throw new Error("Phase IDs must be unique"); seen.add(id);
      const assigneeId = phase.assigneeId === undefined ? old ? old.assigneeId : mode ? null : undefined : phase.assigneeId;
      const agent = this.agents().find(a => a.id === assigneeId);
      if (mode && assigneeId != null && !agent && assigneeId !== old?.assigneeId) throw new Error("Choose an existing phase assignee");
      if (mode && old && assigneeId !== old.assigneeId && old.completedAt != null) throw new Error("Reopen the phase before changing its recorded assignment");
      return { ...(old || {}), ...(mode ? { ...(assigneeId !== undefined ? { assigneeId, assigneeName: agent?.name || old?.assigneeName || null } : {}), status: old?.status || (old?.completedAt != null ? "done" : "queued") } : {}), id, title: text(phase.title, "Phase title", 160), notes: text(phase.notes ?? old?.notes ?? "", "Phase notes", 3000, true),
        elapsedMs: old?.elapsedMs || 0, startedAt: old?.startedAt ?? null, completedAt: old?.completedAt ?? null };
    });
  }
  view(row, full = false, { projects = this.projects(), agents = this.agents() } = {}) {
    const department = projects.find(p => p.id === row.departmentId), agent = agents.find(a => a.id === row.assigneeId);
    const ownerId = taskOwnerId(row), owner = agents.find(a => a.id === ownerId);
    const handlerId = handlingAgentId(row), handler = agents.find(a => a.id === handlerId), entry = activeDelegation(row);
    const { events, documentation, ...rest } = row;
    delete rest.requestId; delete rest.requestHash;
    if (!full && rest.delegations) rest.delegations = rest.delegations.map(({ id, phaseId, managerId, workerId, state }) => ({ id, ...(phaseId ? { phaseId } : {}), managerId, workerId, state }));
    return { ...rest, completedAt: completionTime(row), departmentName: department?.name || row.departmentName, assigneeName: agent?.name || row.assigneeName,
      ...(ownerId !== undefined ? { ownerId } : {}), ownerName: owner?.name || row.ownerName || (ownerId ?? null), ownerAvailable: !!owner,
      handlingAgentId: handlerId, handlingAgentName: handler?.name || handlerId, handlingAgentAvailable: !!handler,
      reviewerId: entry?.state === "review" ? entry.managerId : null,
      assigneeAvailable: !!agent, ...(full ? { documentation, events } : {}),
      phases: row.phases.map(phase => {
        const entry = activeDelegation(row, phase.id), handlerId = handlingAgentId(row, phase.id), assignee = agents.find(a => a.id === phase.assigneeId);
        return { ...phase, ...(!full ? { notes: undefined } : {}), ...(isPhaseTask(row) ? { assigneeName: assignee?.name || phase.assigneeName || null, assigneeAvailable: !!assignee,
          handlingAgentId: handlerId, reviewerId: entry?.state === "review" ? entry.managerId : null, handoffId: entry?.id || null } : {}) };
      }),
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
      running: live.filter(r => r.departmentId === dept.id && r.status === "running").length, unassigned: live.filter(r => r.departmentId === dept.id && (isPhaseTask(r) ? r.phases.some(p => p.completedAt == null && !p.assigneeId) : !r.assigneeId)).length }));
    let rows = input.status === "done" ? all.filter(row => row.status === "done") : input.status === "archived" ? all.filter(row => row.archived || row.status === "done") : live;
    if (input.departmentId !== undefined) rows = rows.filter(row => row.departmentId === input.departmentId);
    if (input.assigneeId !== undefined) rows = rows.filter(row => isPhaseTask(row) ? row.phases.some(p => (input.assigneeId !== null || p.completedAt == null) && (p.assigneeId ?? null) === input.assigneeId) : row.assigneeId === input.assigneeId);
    if (input.ownerId !== undefined) rows = rows.filter(row => (taskOwnerId(row) ?? null) === input.ownerId);
    if (input.status && !["all", "archived"].includes(input.status)) rows = rows.filter(row => row.status === input.status);
    if (input.query) { const query = text(input.query, "Search", 200).toLowerCase(); rows = rows.filter(r => `${r.code}\n${r.title}\n${r.documentation}\n${r.assigneeName || ""}`.toLowerCase().includes(query)); }
    rows.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    const offset = Math.max(0, Number.isInteger(input.offset) ? input.offset : 0), limit = Math.min(25, Math.max(1, Number.isInteger(input.limit) ? input.limit : 25));
    return { todos: rows.slice(offset, offset + limit).map(row => ({ ...this.view(row, false, sources), ...(input.includeProgress === true ? { tracking: taskTracking(row) } : {}) })), total: rows.length, offset, limit, ...catalog, departments, serverTime: this.now() };
  }
  create(input) {
    const requestId = text(input.requestId, "Creation request ID", 160), hash = crypto.createHash("sha256").update(JSON.stringify({ ...input, requestId: undefined })).digest("hex");
    if (this.requests.has(requestId)) {
      const previous = this.raw(this.requests.get(requestId)); if (previous.requestHash !== hash) throw new Error("Creation request ID conflict");
      return { todo: this.view(previous, true), serverTime: this.now() };
    }
    if (this.rows.size >= 10000) throw new Error("The to-do registry has reached its limit");
    if (input.executionMode !== undefined && input.executionMode !== "phases") throw new Error("Choose a supported execution mode");
    const actor = this.actor(input), row = { ...(input.executionMode ? { executionMode: input.executionMode } : {}), version: 1, id: uuid(), code: this.nextCode(), revision: 1, title: text(input.title, "To-do title", 200),
      documentation: text(input.documentation || "", "Documentation", 24000, true), ...this.references({ ...input, ownerId: input.ownerId === undefined ? actor.id || null : input.ownerId }), phases: this.plan(input.phases, [], input.executionMode === "phases"),
      status: "queued", archived: false, completedAt: null, acceptanceManagerId: null, createdAt: this.now(), updatedAt: this.now(), events: [], requestId, requestHash: hash, sourceThreadId: input.sourceThreadId || null };
    const origin = actor.id && this.replyContext(actor.id);
    if (origin) row.replyContext = origin;
    this.event(row, "To-do created", actor); this.save(row); this.requests.set(requestId, row.id); this.changed(row.id);
    return { todo: this.view(row, true), serverTime: this.now() };
  }
  validatePhases(row) {
    if (!row.phases.length || row.phases.length > 20 || new Set(row.phases.map(p => p.id)).size !== row.phases.length) throw new Error("Invalid phase plan");
    for (const phase of row.phases) {
      if (!phase.id || !["queued", "running", "paused", "review", "done"].includes(phase.status) || (phase.assigneeId != null && typeof phase.assigneeId !== "string")) throw new Error("Invalid phase execution state");
      if (typeof phase.id !== "string" || !Number.isFinite(phase.elapsedMs) || phase.elapsedMs < 0 || [phase.startedAt, phase.completedAt].some(t => t != null && !Number.isFinite(t)) || (phase.completedAt != null) !== (phase.status === "done") || phase.startedAt != null && phase.status !== "running") throw new Error("Invalid phase timing or status");
      const entry = activeDelegation(row, phase.id);
      if (phase.completedAt != null && entry || phase.status === "review" && entry?.state !== "review") throw new Error("Invalid phase acceptance state");
      const a = phase.activity;
      if (phase.status === "running" && !a && (phase.startedAt != null || entry?.state !== "working" || !entry.workerId)) throw new Error("Running phase needs its execution identity");
      if (a && (typeof a.agentId !== "string" || !["worker", "reviewer", "self"].includes(a.role) || typeof a.requestId !== "string" || (a.turnId != null && typeof a.turnId !== "string") || (a.handoffId != null && !(row.delegations || []).some(e => e.id === a.handoffId && e.phaseId === phase.id)))) throw new Error("Invalid phase activity");
      if (a?.startedAt !== undefined && !Number.isFinite(a.startedAt)) throw new Error("Invalid activity start time");
      if (a && (a.role === "self" ? a.handoffId != null : entry?.id !== a.handoffId || a.agentId !== (a.role === "worker" ? entry?.workerId : entry?.managerId))) throw new Error("Invalid phase activity handoff");
    }
    if ((row.delegations || []).some(e => e.phaseId ? !row.phases.some(p => p.id === e.phaseId) : !["accepted", "recalled"].includes(e.state))) throw new Error("Invalid phase handoff scope");
  }
  summarizePhases(row) {
    row.status = row.phases.every(p => p.completedAt != null) && !openDelegations(row).length ? "done"
      : row.phases.some(p => ["running", "review"].includes(p.status)) ? "running"
      : row.phases.some(p => ["paused", "review"].includes(p.status)) ? "paused" : "queued";
  }
  followUp(row, input, actor) {
    if (!["running", "paused"].includes(input.status)) throw new Error("Choose Running or Paused for follow-up");
    if (input.phases !== undefined) throw new Error("Update follow-up separately from the phase plan");
    const phased = isPhaseTask(row), scope = phased ? row.phases.find(p => p.id === input.phaseId) : row;
    if (!scope || !phased && input.phaseId) throw new Error("Choose the explicit phase, or omit phaseId for a legacy task");
    if (row.archived || row.status === "done" || scope.completedAt != null) throw new Error("Reopen completed work before changing follow-up");
    const entry = activeDelegation(row, phased ? scope.id : undefined);
    if (entry?.state === "review" || scope.status === "review") throw new Error("Use the existing review controls for submitted work");
    const clocks = phased ? scope.startedAt != null : row.phases.some(p => p.startedAt != null);
    if (clocks && scope.status !== input.status) throw new Error("Use the responsible execution controls to pause an active turn");
    const activity = scope.activity;
    const recordedExecutor = activity && activity.agentId === handlingAgentId(row, phased ? scope.id : undefined) && activity.handoffId === (entry?.id || null) && activity.role !== "reviewer";
    const workingHandoff = entry?.state === "working" && entry.workerId === handlingAgentId(row, phased ? scope.id : undefined);
    if (input.status === "running" && !recordedExecutor && !workingHandoff) throw new Error("An existing execution identity is required; assignment alone does not establish follow-up");
    scope.status = input.status;
    if (input.status === "running") delete scope.pauseContext;
    else scope.pauseContext = { at: this.now(), actor, reason: null, needsUserDecision: null };
    return [{ phaseId: phased ? scope.id : null, status: input.status }];
  }
  pauseContext(input, actor) {
    if (input.needsUserDecision !== undefined && typeof input.needsUserDecision !== "boolean") throw new Error("needsUserDecision must be a boolean");
    const reason = input.reason ? text(input.reason, "Pause reason", 500) : null;
    if (input.needsUserDecision === true && !reason) throw new Error("Describe the decision needed from the user");
    return { at: this.now(), actor, reason, needsUserDecision: input.needsUserDecision ?? null };
  }
  settleTimer(previous, reason, phaseId) {
    const row = structuredClone(previous), scope = phaseId ? row.phases.find(p => p.id === phaseId) : row;
    if (!scope || !(phaseId ? scope.startedAt != null : row.phases.some(p => p.startedAt != null))) return;
    this.stopClock(row, this.now(), phaseId);
    row.revision++; row.updatedAt = this.now();
    this.event(row, reason, { source: "system", name: "Office" }, phaseId ? { phaseId } : {});
    this.save(row); this.changed(row.id);
  }
  changePhase(input, action) {
    const previous = this.raw(input.id);
    if (input.executionMode !== undefined && input.executionMode !== "phases") throw new Error("Choose a supported execution mode");
    if (input.revision !== previous.revision) throw new Error("This to-do changed. Refresh it before saving");
    const row = structuredClone(previous), actor = this.actor(input);
    this.materializeOwner(row, true);
    if (!isPhaseTask(row)) {
      if (action !== "edit" || !input.phases || openDelegations(row).length || row.phases.some(p => p.startedAt != null)) throw new Error("Finish existing handoffs and pause timing before configuring phase assignments");
      row.executionMode = "phases";
    }
    if (row.archived && action !== "restore" && !(row.status === "done" && ["edit", "reopen"].includes(action))) throw new Error("Restore this archived to-do first");
    const needsPhase = !["edit", "archive", "restore"].includes(action);
    const phase = needsPhase ? row.phases.find(p => p.id === input.phaseId) : null;
    if (needsPhase && !phase) throw new Error("Choose an explicit task phase");
    const entry = phase && activeDelegation(row, phase.id), owner = taskOwnerId(row);
    if (["submit", "review", "recall"].includes(action) && (!input.handoffId || entry?.id !== input.handoffId)) throw new Error("Choose the exact active phase handoff; refresh the task");
    if (phase && actor.id && !["delegate", "submit", "review", "recall", "reopen"].includes(action) && actor.id !== handlingAgentId(row, phase.id) && actor.id !== owner) throw new Error("Only this phase's responsible agent or Owner can change its execution");
    let message, followup;
    if (action === "edit") {
      if (input.title !== undefined) row.title = text(input.title, "To-do title", 200);
      if (input.documentation !== undefined) row.documentation = text(input.documentation, "Documentation", 24000, true);
      Object.assign(row, this.references(input, row));
      if (input.phases !== undefined) {
        const next = this.plan(input.phases, row.phases, true);
        for (const old of row.phases) {
          const updated = next.find(p => p.id === old.id);
          if (!updated && (row.delegations || []).some(e => e.phaseId === old.id)) throw new Error("Keep phases with recorded handoff history");
          if ((!updated || updated.assigneeId !== old.assigneeId) && (old.startedAt != null || activeDelegation(row, old.id))) throw new Error("Pause and finish or recall this phase's handoff before reassigning or removing it");
          if (updated && updated.assigneeId !== old.assigneeId) { delete updated.activity; delete updated.pauseContext; if (updated.completedAt == null) updated.status = "queued"; }
          if (!updated) this.event(row, `Removed phase: ${old.title} (${Math.round(old.elapsedMs / 1000)}s)`, actor);
        }
        row.phases = next;
        if (row.acceptanceManagerId) for (const p of row.phases) if (p.completedAt == null) p.acceptanceManagerId ||= row.acceptanceManagerId;
      }
      if (input.status !== undefined) followup = this.followUp(row, input, actor);
      message = followup ? "Follow-up status updated" : "Plan, phase assignments or documentation updated";
    } else if (action === "delegate") {
      const manager = actor.id || (!entry && owner) || handlingAgentId(row, phase.id);
      if (!manager || manager !== handlingAgentId(row, phase.id) && (entry || manager !== owner)) throw new Error("Only this phase's responsible agent or Owner can coordinate its handoff");
      if (!entry && manager !== handlingAgentId(row, phase.id) && phase.startedAt != null) throw new Error("Pause this phase before changing its execution handoff");
      if (entry?.state === "review") throw new Error("Review this phase's submitted result before delegating again");
      if (!input.assigneeId || input.assigneeId === manager || openDelegations(row).some(e => e.phaseId === phase.id && e.managerId === input.assigneeId)) throw new Error("Choose another employee outside this phase's handoff chain");
      const instructions = text(input.instructions, "Delegation scope", 6000), acceptanceCriteria = text(input.acceptanceCriteria === undefined ? "" : input.acceptanceCriteria, "Acceptance criteria", 3000, true);
      this.stopClock(row, this.now(), phase.id); delete phase.activity;
      const candidate = actor.id ? this.replyContext(actor.id) : null;
      if (!row.replyContext && candidate && (!candidate.taskId || candidate.taskId === row.id)) row.replyContext = candidate;
      if (!entry) phase.acceptanceManagerId = manager;
      row.delegations ||= [];
      row.delegations.push({ id: uuid(), phaseId: phase.id, ...(input.usageTrigger === "todoRun" ? { trigger: "todoRun" } : {}), managerId: manager, workerId: input.assigneeId, instructions, acceptanceCriteria, state: "working", createdAt: this.now(), replyContext: taskReplyContext(row, candidate, phase.id), delivery: { recipientId: input.assigneeId, requestId: `delegation-${uuid()}`, state: "pending", sender: actor } });
      phase.assigneeId = input.assigneeId; phase.assigneeName = this.agents().find(a => a.id === input.assigneeId)?.name || input.assigneeId; phase.status = "queued";
      message = `Delegated phase: ${phase.title}`;
    } else if (action === "submit") {
      if (entry.state !== "working" || actor.id !== entry.workerId) throw new Error("Only this handoff's worker can submit");
      entry.report = text(input.report, "Delivery report and evidence", 6000); entry.submittedAt = this.now(); entry.state = "review";
      entry.delivery = { recipientId: entry.managerId, requestId: `delegation-${uuid()}`, state: "pending", sender: actor };
      this.stopClock(row, this.now(), phase.id); delete phase.activity; phase.status = "review";
      message = `Submitted phase for manager acceptance: ${phase.title}`;
    } else if (action === "review" || action === "recall") {
      const transfer = action === "recall" && canTransferOwnHandoff(row, entry, actor.id);
      if (actor.id && actor.id !== entry.managerId && !transfer) throw new Error("Only this handoff's delegating manager can review or recall it");
      if (transfer && ["sending", "uncertain"].includes(entry.delivery?.state)) throw new Error("Check the uncertain handoff delivery before transferring it");
      this.stopClock(row, this.now(), phase.id); delete phase.activity; delete entry.delivery;
      if (action === "recall") {
        const reason = text(input.reason, "Recall reason", 500);
        entry.state = "recalled"; entry.recalledAt = this.now(); phase.status = "paused";
        const parent = activeDelegation(row, phase.id);
        if (transfer) {
          entry.ownerTransfer = { ownerId: actor.id, at: this.now(), reason, actor };
          if (!parent) phase.acceptanceManagerId = actor.id;
          message = `Owner ended their old upstream handoff by transfer: ${reason}`;
        } else {
          phase.assigneeId = parent?.workerId || entry.managerId;
          phase.assigneeName = this.agents().find(a => a.id === phase.assigneeId)?.name || phase.assigneeId;
          message = `Phase handoff recalled: ${reason}`;
        }
      } else {
        if (entry.state !== "review" || typeof input.accept !== "boolean") throw new Error("Choose whether to accept this phase's submitted result");
        const notes = text(input.notes, "Acceptance evidence or return feedback", 6000);
        entry.review = { accepted: input.accept, notes, at: this.now(), managerId: entry.managerId, actor };
        entry.state = input.accept ? "accepted" : "working";
        phase.status = input.accept ? "paused" : "queued";
        if (!input.accept) entry.delivery = { recipientId: entry.workerId, requestId: `delegation-${uuid()}`, state: "pending", sender: actor };
        else if (!activeDelegation(row, phase.id)) { phase.completedAt = this.now(); phase.status = "done"; }
        message = `Manager ${input.accept ? "accepted" : "returned"} phase ${phase.title}: ${notes}`;
      }
    } else if (action === "start") {
      if (phase.completedAt != null) throw new Error("Reopen this phase before starting");
      if (!entry && !phase.assigneeId) throw new Error("Assign an agent to this phase before starting");
      const agentId = handlingAgentId(row, phase.id);
      if (!agentId) throw new Error("Assign an Owner before starting");
      this.assertPhaseAvailable(agentId, row.id, phase.id);
      this.stopClock(row, this.now(), phase.id); phase.startedAt = this.now(); phase.lastStartedAt = this.now(); phase.status = "running"; delete phase.pauseContext;
      const noticeRevision = input.notice ? row.revision + 1 : phase.activity?.agentId === agentId && phase.activity.handoffId === (entry?.id || null) ? phase.activity.noticeRevision : undefined;
      phase.activity = { agentId, role: entry ? entry.state === "review" ? "reviewer" : "worker" : "self", handoffId: entry?.id || null, requestId: input.activityId || uuid(), turnId: null, startedAt: phase.lastStartedAt, ...(noticeRevision === undefined ? {} : { noticeRevision }) };
      message = `Started phase: ${phase.title}`;
    } else if (action === "pause") {
      if (input.activityId && phase.activity?.requestId !== input.activityId) return this.get(input);
      const pause = this.pauseContext(input, actor);
      this.stopClock(row, this.now(), phase.id); phase.status = "paused"; phase.pauseContext = pause;
      message = input.reason ? text(input.reason, "Pause reason", 500) : `Paused phase: ${phase.title}`;
    } else if (action === "complete" || action === "reopen") {
      if (entry) throw new Error("Submit and obtain this phase's manager acceptance before checking it complete or reopening it");
      if (action === "reopen") {
        if (actor.id && actor.id !== owner && actor.id !== phase.acceptanceManagerId) throw new Error("Only the Owner or this phase's acceptance manager can reopen it");
      } else if (actor.id && actor.id !== (phase.acceptanceManagerId || owner)) throw new Error("Only this phase's responsible manager can complete it");
      this.stopClock(row, this.now(), phase.id); delete phase.activity;
      phase.completedAt = action === "complete" ? phase.completedAt ?? this.now() : null; phase.status = action === "complete" ? "done" : "queued";
      message = `${action === "complete" ? "Completed" : "Reopened"} phase: ${phase.title}`;
    } else if (action === "archive" || action === "restore") {
      if (openDelegations(row).length) throw new Error("Review or recall all open phase handoffs before archiving");
      if (action === "restore" && row.status === "done") throw new Error("Completed tasks stay archived. Add or reopen a phase to follow up");
      this.stopClock(row); for (const p of row.phases) if (p.status === "running") p.status = "paused";
      row.archived = action === "archive"; message = action === "archive" ? "To-do archived" : "To-do restored";
    } else throw new Error("Unsupported phase action");
    this.summarizePhases(row);
    if (row.status === "done") {
      if (previous.status !== "done" && actor.id && actor.id !== owner && actor.id !== phase?.acceptanceManagerId && !(action === "review" && input.accept && actor.id === entry?.managerId)) throw new Error("Only the root manager or Owner can close this goal");
      row.completedAt = previous.status === "done" ? completionTime(previous) : this.now(); row.archived = true;
    } else { row.completedAt = null; if (previous.status === "done") row.archived = false; }
    for (const p of row.phases) if (p.status !== "paused") delete p.pauseContext;
    this.validatePhases(row);
    if (action === "start") this.bindings.set(phase.activity.agentId, { taskId: row.id, phaseId: phase.id, activityId: phase.activity.requestId });
    row.revision++; row.updatedAt = this.now(); this.event(row, message, actor, followup ? { followup } : {}); this.save(row); this.changed(row.id);
    return this.get({ id: row.id });
  }
  assertPhaseAvailable(agentId, taskId, phaseId) {
    for (const row of this.rows.values()) if (isPhaseTask(row) && !row.archived) for (const p of row.phases) {
      if ((row.id !== taskId || p.id !== phaseId) && p.activity?.agentId === agentId && p.startedAt != null) throw new Error("This agent is already working on another phase");
    }
    const legacy = [...this.rows.values()].find(r => !isPhaseTask(r) && !r.archived && r.phases.some(p => p.startedAt != null) && handlingAgentId(r) === agentId);
    if (legacy && phaseId) throw new Error("This agent is already working on another task");
  }
  executionScope(agentId) {
    const eligible = row => row && !row.archived && row.status !== "done";
    const activityScope = (row, phase = null) => {
      if (!eligible(row) || phase?.completedAt != null || isPhaseTask(row) !== !!phase) return null;
      const activity = phase ? phase.activity : row.activity;
      if (!activity || activity.agentId !== agentId || !activity.requestId || handlingAgentId(row, phase?.id) !== agentId
        || (phase ? !["self", "worker", "reviewer"].includes(activity.role) : activity.role !== "legacy")) return null;
      // Phase lastStartedAt has always represented an explicit start. Legacy
      // lastStartedAt also changes on plan edits, so it cannot date an activity.
      const at = Number.isFinite(activity.lastTurnAt) ? activity.lastTurnAt : Number.isFinite(activity.startedAt) ? activity.startedAt : phase && Number.isFinite(phase.lastStartedAt) ? phase.lastStartedAt : null;
      return { row, phase, at };
    };
    const binding = this.bindings.get(agentId);
    if (typeof binding === "string") {
      const row = this.rows.get(binding), scope = activityScope(row);
      if (scope) return scope;
      if (eligible(row) && !isPhaseTask(row) && !row.activity && handlingAgentId(row) === agentId) return { row, phase: null };
    } else if (binding) {
      const row = this.rows.get(binding.taskId), phase = row?.phases.find(p => p.id === binding.phaseId), scope = phase && activityScope(row, phase);
      if (scope && phase.activity.requestId === binding.activityId) return scope;
    }
    const candidates = [];
    for (const row of this.rows.values()) if (eligible(row)) {
      if (isPhaseTask(row)) { for (const phase of row.phases) { const scope = activityScope(row, phase); if (scope) candidates.push(scope); } }
      else { const scope = activityScope(row); if (scope) candidates.push(scope); }
    }
    const latest = scopes => {
      if (scopes.length === 1) return scopes[0];
      if (!scopes.length || scopes.some(s => !Number.isFinite(s.at))) return null;
      const at = scopes.reduce((max, s) => Math.max(max, s.at), -Infinity), matches = scopes.filter(s => s.at === at);
      return matches.length === 1 ? matches[0] : null;
    };
    if (candidates.length) return latest(candidates);
    // Old unmarked tasks without activity retain their legacy timing fallback.
    // Neither current assignment nor documentation recency breaks a tie.
    return latest([...this.rows.values()].filter(row => eligible(row) && !isPhaseTask(row) && !row.activity && handlingAgentId(row) === agentId)
      .map(row => ({ row, phase: null, at: Number.isFinite(row.lastStartedAt) ? row.lastStartedAt : 0 })));
  }
  phaseScope(agentId) {
    const scope = this.executionScope(agentId);
    return scope?.phase ? { row: scope.row, phase: scope.phase } : null;
  }
  context(agentId) {
    const scope = this.executionScope(agentId), row = scope?.row, phase = scope?.phase, entry = row && activeDelegation(row, phase?.id);
    const noticeRevision = (phase ? phase.activity : row?.activity)?.noticeRevision;
    return { protocol: 6, agentId, todoId: row?.id || null, assigneeId: phase ? phase.assigneeId ?? null : row?.assigneeId || null,
      ...(row ? { taskCode: row.code, taskTitle: row.title,
        ...(entry ? { handoffState: entry.state, returnedForChanges: entry.state === "working" && entry.review?.accepted === false } : {}) } : {}),
      // This is the received notice's CAS revision, not a per-turn clock nonce.
      ...(noticeRevision === undefined ? {} : { notice: { revision: noticeRevision } }),
      handlingAgentId: row ? handlingAgentId(row, phase?.id) : null, reviewerId: entry?.state === "review" ? entry.managerId : null,
      ...(phase ? { runningPhaseId: phase.id, phaseTitle: phase.title, handoffId: entry?.id || null, activityId: phase.activity?.requestId, activityRole: phase.activity?.role, activityTurnId: phase.activity?.turnId ?? null } : row?.activity ? { activityId: row.activity.requestId, activityRole: "legacy", activityTurnId: row.activity.turnId ?? null, handoffId: entry?.id || null } : {}), delegatedTasks: this.delegated(agentId) };
  }
  recordTurn(value, session) {
    const row = value.taskId && this.rows.get(value.taskId), phased = isPhaseTask(row || {});
    const phase = phased && row.phases.find(p => p.id === value.phaseId), activity = phased ? phase?.activity : row?.activity;
    const current = this.executionScope(value.agentId);
    if (!row || row.archived || !activity || (phased ? phase.status !== "running" : row.status !== "running" || value.phaseId != null)
      || current?.row.id !== row.id || (current.phase?.id || null) !== (phase?.id || null)
      || activity.agentId !== value.agentId || activity.requestId !== value.activityId || activity.handoffId !== (value.handoffId || null)
      || activity.role !== value.activityRole || handlingAgentId(row, phased ? phase.id : undefined) !== value.agentId || !value.turnId) return;
    if (activity.turnId === value.turnId) {
      if (session?.lastTurnId === value.turnId && ["completed", "failed", "interrupted"].includes(session.turnStatus)) this.finishTurn(value.agentId, session.turnStatus, value.turnId);
      return;
    }
    // The real dispatch captures the previous turn before awaiting native ACK.
    // A late/duplicate callback cannot overwrite a newer turn or re-open its clock.
    if (activity.turnId && activity.turnId !== value.previousTurnId) return;
    const next = structuredClone(row), target = phased ? next.phases.find(p => p.id === phase.id) : next;
    target.activity.turnId = value.turnId; target.activity.lastTurnAt = this.now();
    if (value.mode === "start") {
      const clock = phased ? target : next.phases.find(p => p.completedAt == null);
      if (clock && clock.startedAt == null) clock.startedAt = Number.isFinite(value.dispatchedAt) ? Math.min(this.now(), value.dispatchedAt) : this.now();
    }
    this.save(next); this.changed(row.id);
    if (session?.lastTurnId === value.turnId && ["completed", "failed", "interrupted"].includes(session.turnStatus)) this.finishTurn(value.agentId, session.turnStatus, value.turnId);
  }
  change(input, action) {
    const previous = this.raw(input.id);
    if (action === "edit" && isWatcherOnlyEdit(input)) {
      if (input.revision !== previous.revision) throw new Error("This to-do changed. Refresh it before saving");
      const actor = this.actor(input);
      if (previous.archived && previous.status !== "done") throw new Error("Restore this archived to-do first");
      const { watcherIds } = this.references(input, previous), row = structuredClone(previous);
      row.watcherIds = watcherIds;
      row.revision++; row.updatedAt = this.now();
      this.event(row, "Plan, watchers updated", actor); this.save(row); this.changed(row.id);
      return this.get({ id: row.id });
    }
    if (isPhaseTask(previous) || input.executionMode === "phases") return this.changePhase(input, action);
    if (action === "complete" && previous.phases.find(p => p.id === input.phaseId)?.completedAt != null) return this.get(input);
    if (input.revision !== previous.revision) throw new Error("This to-do changed. Refresh it before saving");
    const row = structuredClone(previous), actor = this.actor(input), delegation = activeDelegation(row); let message, followup;
    this.materializeOwner(row, true);
    if (delegation && ["edit", "archive"].includes(action) && (action === "archive" || input.assigneeId !== undefined && input.assigneeId !== row.assigneeId)) throw new Error("Finish or review the active delegation before reassigning or archiving this task");
    if (row.archived && action !== "restore" && !(row.status === "done" && ["edit", "reopen"].includes(action))) throw new Error("Restore this archived to-do first");
    if (action === "restore" && row.status === "done") throw new Error("Completed tasks stay archived. Add a phase or reopen a completed phase to follow up");
    if (action === "edit") {
      const wasTiming = row.phases.some(p => p.startedAt != null);
      if (input.status === undefined) this.stopClock(row);
      if (input.title !== undefined) row.title = text(input.title, "To-do title", 200);
      if (input.documentation !== undefined) row.documentation = text(input.documentation, "Documentation", 24000, true);
      if (input.assigneeId !== undefined && input.assigneeId !== row.assigneeId) row.acceptanceManagerId = null;
      Object.assign(row, this.references(input, row));
      if (input.phases !== undefined) {
        const next = this.plan(input.phases, row.phases);
        for (const old of row.phases.filter(p => !next.some(n => n.id === p.id))) this.event(row, `Removed phase: ${old.title} (${Math.round(old.elapsedMs / 1000)}s)`, actor);
        row.phases = next;
      }
      if (row.phases.every(p => p.completedAt != null)) row.status = "done";
      else if (row.status === "running" && wasTiming && input.status === undefined) this.run(row);
      else if (row.status === "done") row.status = "queued";
      if (input.status !== undefined) followup = this.followUp(row, input, actor);
      if (input.assigneeId !== undefined && input.assigneeId !== previous.assigneeId) { delete row.activity; delete row.pauseContext; this.stopClock(row); if (row.status !== "done") row.status = "queued"; }
      message = followup ? "Follow-up status updated" : "Plan, assignment or documentation updated";
    } else if (action === "delegate") {
      if (actor.id !== handlingAgentId(row) || !actor.id) throw new Error("Only the current responsible agent can delegate this task");
      if (delegation?.state === "review") throw new Error("Review the submitted result before delegating again");
      if (!input.assigneeId || input.assigneeId === actor.id || (row.delegations || []).some(entry => !["accepted", "recalled"].includes(entry.state) && entry.managerId === input.assigneeId)) throw new Error("Choose another employee outside the active handoff chain");
      const instructions = text(input.instructions, "Delegation scope", 6000), acceptanceCriteria = text(input.acceptanceCriteria === undefined ? "" : input.acceptanceCriteria, "Acceptance criteria", 3000, true);
      this.stopClock(row);
      if (!delegation) row.acceptanceManagerId = actor.id;
      const candidate = this.replyContext(actor.id);
      if (!row.replyContext && candidate && (!candidate.taskId || candidate.taskId === row.id)) row.replyContext = candidate;
      row.delegations ||= [];
      row.delegations.push({ id: uuid(), managerId: actor.id, workerId: input.assigneeId, instructions, acceptanceCriteria, state: "working", createdAt: this.now(),
        replyContext: taskReplyContext(row, candidate),
        delivery: { recipientId: input.assigneeId, requestId: `delegation-${uuid()}`, state: "pending", sender: actor } });
      Object.assign(row, this.references({ assigneeId: input.assigneeId }, row)); row.status = "queued";
      message = `Delegated to ${row.assigneeName}; manager retains acceptance responsibility`;
    } else if (action === "recall") {
      if (!delegation || actor.id !== delegation.managerId) throw new Error("Only the delegating manager can recall this handoff");
      const reason = text(input.reason, "Recall reason", 500);
      delegation.state = "recalled"; delegation.recalledAt = this.now(); delete delegation.delivery;
      this.stopClock(row); Object.assign(row, this.references({ assigneeId: delegation.managerId }, row)); row.status = "paused";
      message = `Manager recalled delegation: ${reason}`;
    } else if (action === "submit") {
      if (!delegation || delegation.state !== "working" || actor.id !== delegation.workerId) throw new Error("Only the assigned worker can submit the active delegation");
      delegation.report = text(input.report, "Delivery report and evidence", 6000); delegation.submittedAt = this.now(); delegation.state = "review";
      delegation.delivery = { recipientId: delegation.managerId, requestId: `delegation-${uuid()}`, state: "pending", sender: actor };
      this.stopClock(row); row.status = "running";
      message = `Submitted for manager acceptance: ${delegation.report}`;
    } else if (action === "review") {
      if (!delegation || delegation.state !== "review" || actor.id !== delegation.managerId) throw new Error("Only the delegating manager can review this submission");
      if (typeof input.accept !== "boolean") throw new Error("Choose whether to accept the submitted result");
      const notes = text(input.notes, "Acceptance evidence or return feedback", 6000);
      this.stopClock(row); delegation.review = { accepted: input.accept, notes, at: this.now(), managerId: actor.id };
      delegation.state = input.accept ? "accepted" : "working";
      delete delegation.delivery;
      if (!input.accept) {
        delegation.delivery = { recipientId: delegation.workerId, requestId: `delegation-${uuid()}`, state: "pending", sender: actor };
      }
      row.status = input.accept ? "running" : "queued";
      message = `${input.accept ? "Manager accepted" : "Manager returned for changes"}: ${notes}`;
    } else if (action === "start") {
      if (row.phases.every(p => p.completedAt != null)) throw new Error("Reopen a completed phase before starting");
      if ((input.execute === true || actor.id) && delegation?.state === "working") Object.assign(row, this.references({ assigneeId: handlingAgentId(row) }, row));
      this.run(row); delete row.pauseContext; message = "Work started";
    } else if (action === "pause") {
      const pause = this.pauseContext(input, actor);
      this.stopClock(row); if (row.status !== "done") { row.status = "paused"; row.pauseContext = pause; }
      message = input.reason ? text(input.reason, "Pause reason", 500) : "Work paused";
    } else if (action === "complete" || action === "reopen") {
      const phase = row.phases.find(p => p.id === input.phaseId); if (!phase) throw new Error("Phase is missing");
      this.stopClock(row); phase.completedAt = action === "complete" ? this.now() : null; this.run(row);
      message = `${action === "complete" ? "Completed" : "Reopened"} phase: ${phase.title}`;
    } else if (action === "archive" || action === "restore") {
      this.stopClock(row); row.archived = action === "archive"; if (row.status === "running") row.status = "paused";
      message = action === "archive" ? "To-do archived" : "To-do restored";
    } else throw new Error("Unsupported to-do action");
    // Metadata edits on completed tasks are not a new acceptance decision.
    // Use the previous manager: an edit may also try to clear it by reassigning.
    const closing = previous.status !== "done" && row.status === "done";
    if (closing && activeDelegation(row)) throw new Error("Submit the result and obtain manager acceptance before completing the final phase");
    if (closing && previous.acceptanceManagerId && actor.id && actor.id !== previous.acceptanceManagerId) throw new Error("Only the responsible manager can close this delegated goal");
    const reassigning = action === "edit" && row.assigneeId !== previous.assigneeId;
    if (actor.id && (action !== "edit" || reassigning) && !["delegate", "recall", "submit", "review"].includes(action) && (activeDelegation(previous) || previous.acceptanceManagerId) && actor.id !== handlingAgentId(previous)) throw new Error("Only the current responsible manager or worker can update this delegated task");
    if (row.status === "done") {
      row.completedAt = previous.status === "done" ? completionTime(previous) : this.now();
      row.archived = true;
      if (previous.status !== "done") message += "; to-do completed and automatically archived";
    } else {
      row.completedAt = null;
      if (previous.status === "done") row.archived = false;
    }
    if (row.status !== "paused") delete row.pauseContext;
    const handler = handlingAgentId(row), clockActive = row.phases.some(p => p.startedAt != null);
    if (clockActive && handler) {
      this.assertPhaseAvailable(handler, row.id, null);
      if (!row.activity || row.activity.agentId !== handler || previous.status !== "running" || action === "start" || input.activityId && row.activity.requestId !== input.activityId) {
        const handoffId = activeDelegation(row)?.id || null;
        const noticeRevision = input.notice ? row.revision + 1 : row.activity?.agentId === handler && row.activity.handoffId === handoffId ? row.activity.noticeRevision : undefined;
        row.activity = { agentId: handler, role: "legacy", handoffId, requestId: input.activityId || uuid(), turnId: null, startedAt: row.lastStartedAt, ...(noticeRevision === undefined ? {} : { noticeRevision }) };
      }
      for (const other of this.rows.values()) if (!isPhaseTask(other) && other.id !== row.id && handlingAgentId(other) === handler && other.status === "running") this.settleTimer(other, "Agent switched task; activity timer stopped");
    }
    row.revision++; row.updatedAt = this.now(); this.event(row, message, actor, followup ? { followup } : {}); this.save(row);
    for (const [agentId, id] of this.bindings) if (id === row.id && (row.archived || row.status === "done" || handler !== agentId)) this.bindings.delete(agentId);
    if (clockActive && handler) this.bindings.set(handler, row.id);
    this.changed(row.id); return { todo: this.view(row, true), serverTime: this.now() };
  }
  delivery(id, requestId, state, error) {
    const previous = this.raw(id), row = structuredClone(previous), entry = (row.delegations || []).find(e => e.delivery?.requestId === requestId);
    if (entry && activeDelegation(row, entry.phaseId)?.id !== entry.id) return;
    if (!entry?.delivery || entry.delivery.requestId !== requestId) return;
    entry.delivery.state = state;
    if (error) entry.delivery.error = String(error).slice(0, 500);
    // Transport receipts do not change the plan, report or workflow authority.
    // Keep the announced revision usable; real task changes still conflict.
    row.updatedAt = this.now(); this.save(row); this.changed(row.id);
  }
  delegated(agentId) {
    const phases = [...this.rows.values()].filter(r => isPhaseTask(r) && !r.archived && r.status !== "done").flatMap(row => openDelegations(row).filter(e => [e.managerId, e.workerId].includes(agentId)).map(entry => ({ id: row.id, phaseId: entry.phaseId, handoffId: entry.id, assigneeId: row.phases.find(p => p.id === entry.phaseId)?.assigneeId, handlingAgentId: handlingAgentId(row, entry.phaseId), reviewerId: entry.state === "review" ? entry.managerId : null, managerId: entry.managerId, workerId: entry.workerId, state: entry.state, delivery: entry.delivery?.state })));
    return [...phases, ...[...this.rows.values()].filter(row => !isPhaseTask(row) && !row.archived && row.status !== "done" && (row.delegations || []).some(entry => !["accepted", "recalled"].includes(entry.state) && [entry.managerId, entry.workerId].includes(agentId)))
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20)
      .map(row => { const entry = activeDelegation(row); return { id: row.id, assigneeId: row.assigneeId, handlingAgentId: handlingAgentId(row), reviewerId: entry.state === "review" ? entry.managerId : null, managerId: entry.managerId, workerId: entry.workerId, state: entry.state, delivery: entry.delivery?.state }; })].slice(0, 20);
  }
  assertCanArchiveAgent(agentId) {
    if (this.delegated(agentId).length) throw new Error("Review or recall this agent's open delegations before archiving the conversation");
  }
  bound(agentId) { return this.executionScope(agentId)?.row || null; }
  startForAgent(agentId, id, phaseId, activityId, notice = false) {
    const row = this.raw(id);
    if (isPhaseTask(row)) {
      const phase = row.phases.find(p => p.id === phaseId);
      if (!phase || row.archived || phase.completedAt != null || handlingAgentId(row, phaseId) !== agentId) throw new Error("Choose this agent's unfinished phase");
      this.change({ id: row.id, revision: row.revision, phaseId, activityId, source: "system", notice }, "start");
      return this.raw(row.id);
    }
    id = row.id;
    if (handlingAgentId(row) !== agentId || row.archived || row.status === "done") throw new Error("Choose an unfinished to-do assigned to this agent's execution or acceptance workflow");
    this.assertPhaseAvailable(agentId, row.id, null);
    for (const other of this.rows.values()) if (!isPhaseTask(other) && other.id !== id && handlingAgentId(other) === agentId && other.status === "running") this.settleTimer(other, "Agent switched task; activity timer stopped");
    const requestId = activityId || uuid();
    if (row.status !== "running" || activeDelegation(row)?.state === "working" && row.assigneeId !== agentId) this.change({ id, revision: row.revision, activityId: requestId, source: "system", execute: true, notice }, "start");
    if (this.raw(id).activity?.requestId !== requestId || notice && this.raw(id).activity?.noticeRevision === undefined) {
      const next = structuredClone(this.raw(id)), handoffId = activeDelegation(next)?.id || null;
      const noticeRevision = notice ? next.revision : next.activity?.agentId === agentId && next.activity.handoffId === handoffId ? next.activity.noticeRevision : undefined;
      next.activity = { agentId, role: "legacy", handoffId, requestId, turnId: null, startedAt: this.now(), ...(noticeRevision === undefined ? {} : { noticeRevision }) }; this.save(next);
    }
    this.bindings.set(agentId, id); return this.raw(id);
  }
  finishTurn(agentId, status, turnId) {
    const scope = this.executionScope(agentId);
    if (scope?.phase) {
      const { row, phase } = scope;
      if (turnId && phase.activity?.turnId === turnId) this.settleTimer(row, `Agent turn ${status}; activity timer stopped`, phase.id);
      return;
    }
    const row = scope?.row;
    if (turnId && row?.activity && (row.activity.agentId !== agentId || row.activity.turnId !== turnId)) return;
    if (row?.status === "running") this.settleTimer(row, `Agent turn ${status}; activity timer stopped`);
  }
  checkpoint() { for (const row of this.rows.values()) if (row.phases.some(p => p.startedAt != null)) {
    const next = structuredClone(row), running = next.phases.filter(p => p.startedAt != null).map(p => p.id); this.stopClock(next);
    for (const p of next.phases) if (running.includes(p.id)) p.startedAt = this.now();
    this.save(next);
  } }
  close() { for (const row of [...this.rows.values()]) this.settleTimer(row, "Office stopped; activity timers stopped"); }

}
module.exports = { OfficeTodos, phaseDuration: duration, activeDelegation, openDelegations, handlingAgentId, isPhaseTask, isWatcherOnlyEdit, canTransferOwnHandoff };
