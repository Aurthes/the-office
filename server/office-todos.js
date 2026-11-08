"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { taskReplyContext } = require("./office-reply-context");
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
// Execution attribution and the person handling the workflow are separate.
const handlingAgentId = (row, phaseId) => {
  const entry = activeDelegation(row, phaseId);
  const phase = phaseId && row.phases?.find(p => p.id === phaseId);
  return entry ? entry.state === "review" ? entry.managerId : entry.workerId : isPhaseTask(row)
    ? phase?.activity?.agentId || phase?.acceptanceManagerId || taskOwnerId(row) : row.acceptanceManagerId || row.assigneeId;
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
      if (row.status === "running") {
        this.stopClock(row, checkpointAt);
        if (isPhaseTask(row)) for (const phase of row.phases) if (phase.status === "running") phase.status = activeDelegation(row, phase.id)?.state === "review" ? "review" : "paused";
        row.status = "paused"; row.revision++;
        this.event(row, "Office restarted; timer paused at the last checkpoint", { source: "system" }); this.save(row);
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
  event(row, message, actor) { row.events.push({ at: this.now(), message, actor }); row.events = row.events.slice(-100); }
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
    return { departmentId, departmentName: department?.name || previous.departmentName, assigneeId, assigneeName: agent?.name || (assigneeId ? previous?.assigneeName : null),
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
    return { todos: rows.slice(offset, offset + limit).map(row => this.view(row, false, sources)), total: rows.length, offset, limit, ...catalog, departments, serverTime: this.now() };
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
      if (typeof phase.id !== "string" || !Number.isFinite(phase.elapsedMs) || phase.elapsedMs < 0 || [phase.startedAt, phase.completedAt].some(t => t != null && !Number.isFinite(t)) || (phase.completedAt != null) !== (phase.status === "done") || (phase.startedAt != null) !== (phase.status === "running")) throw new Error("Invalid phase timing or status");
      const entry = activeDelegation(row, phase.id);
      if (phase.completedAt != null && entry || phase.status === "review" && entry?.state !== "review") throw new Error("Invalid phase acceptance state");
      const a = phase.activity;
      if (phase.startedAt != null && !a) throw new Error("Running phase needs its execution identity");
      if (a && (typeof a.agentId !== "string" || !["worker", "reviewer", "self"].includes(a.role) || typeof a.requestId !== "string" || (a.turnId != null && typeof a.turnId !== "string") || (a.handoffId != null && !(row.delegations || []).some(e => e.id === a.handoffId && e.phaseId === phase.id)))) throw new Error("Invalid phase activity");
      if (a && (a.role === "self" ? a.handoffId != null : entry?.id !== a.handoffId || a.agentId !== (a.role === "worker" ? entry?.workerId : entry?.managerId))) throw new Error("Invalid phase activity handoff");
    }
    if ((row.delegations || []).some(e => e.phaseId ? !row.phases.some(p => p.id === e.phaseId) : !["accepted", "recalled"].includes(e.state))) throw new Error("Invalid phase handoff scope");
  }
  summarizePhases(row) {
    row.status = row.phases.every(p => p.completedAt != null) && !openDelegations(row).length ? "done"
      : row.phases.some(p => p.startedAt != null) ? "running"
      : row.phases.some(p => ["paused", "review"].includes(p.status)) ? "paused" : "queued";
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
    if (phase && actor.id && !["delegate", "submit", "review", "recall"].includes(action) && actor.id !== handlingAgentId(row, phase.id) && actor.id !== owner) throw new Error("Only this phase's responsible agent or Owner can change its execution");
    let message;
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
          if (!updated) this.event(row, `Removed phase: ${old.title} (${Math.round(old.elapsedMs / 1000)}s)`, actor);
        }
        row.phases = next;
        if (row.acceptanceManagerId) for (const p of row.phases) if (p.completedAt == null) p.acceptanceManagerId ||= row.acceptanceManagerId;
      }
      message = "Plan, phase assignments or documentation updated";
    } else if (action === "delegate") {
      const manager = actor.id || handlingAgentId(row, phase.id);
      if (!manager || manager !== handlingAgentId(row, phase.id)) throw new Error("Only the responsible phase manager can delegate");
      if (entry?.state === "review") throw new Error("Review this phase's submitted result before delegating again");
      if (!input.assigneeId || input.assigneeId === manager || openDelegations(row).some(e => e.phaseId === phase.id && e.managerId === input.assigneeId)) throw new Error("Choose a direct report outside this phase's handoff chain");
      const instructions = text(input.instructions, "Delegation scope", 6000), acceptanceCriteria = text(input.acceptanceCriteria, "Acceptance criteria", 3000);
      this.stopClock(row, this.now(), phase.id); delete phase.activity;
      const candidate = actor.id ? this.replyContext(actor.id) : null;
      if (!row.replyContext && candidate && (!candidate.taskId || candidate.taskId === row.id)) row.replyContext = candidate;
      if (!entry) phase.acceptanceManagerId = manager;
      row.delegations ||= [];
      row.delegations.push({ id: uuid(), phaseId: phase.id, ...(input.usageTrigger === "todoRun" ? { trigger: "todoRun" } : {}), managerId: manager, workerId: input.assigneeId, instructions, acceptanceCriteria, state: "working", createdAt: this.now(), replyContext: taskReplyContext(row, candidate, phase.id), delivery: { recipientId: input.assigneeId, requestId: `delegation-${uuid()}`, state: "pending" } });
      phase.assigneeId = input.assigneeId; phase.assigneeName = this.agents().find(a => a.id === input.assigneeId)?.name || input.assigneeId; phase.status = "queued";
      message = `Delegated phase: ${phase.title}`;
    } else if (action === "submit") {
      if (entry.state !== "working" || actor.id !== entry.workerId) throw new Error("Only this handoff's worker can submit");
      entry.report = text(input.report, "Delivery report and evidence", 6000); entry.submittedAt = this.now(); entry.state = "review";
      entry.delivery = { recipientId: entry.managerId, requestId: `delegation-${uuid()}`, state: "pending" };
      this.stopClock(row, this.now(), phase.id); delete phase.activity; phase.status = "review";
      message = `Submitted phase for manager acceptance: ${phase.title}`;
    } else if (action === "review" || action === "recall") {
      if (actor.id && actor.id !== entry.managerId) throw new Error("Only this handoff's delegating manager can review or recall it");
      this.stopClock(row, this.now(), phase.id); delete phase.activity; delete entry.delivery;
      if (action === "recall") {
        entry.state = "recalled"; entry.recalledAt = this.now(); phase.status = "paused";
        const parent = activeDelegation(row, phase.id);
        phase.assigneeId = parent?.workerId || entry.managerId;
        phase.assigneeName = this.agents().find(a => a.id === phase.assigneeId)?.name || phase.assigneeId;
        message = `Phase handoff recalled: ${text(input.reason, "Recall reason", 500)}`;
      } else {
        if (entry.state !== "review" || typeof input.accept !== "boolean") throw new Error("Choose whether to accept this phase's submitted result");
        const notes = text(input.notes, "Acceptance evidence or return feedback", 6000);
        entry.review = { accepted: input.accept, notes, at: this.now(), managerId: entry.managerId, actor };
        entry.state = input.accept ? "accepted" : "working";
        phase.status = input.accept ? "paused" : "queued";
        if (!input.accept) entry.delivery = { recipientId: entry.workerId, requestId: `delegation-${uuid()}`, state: "pending" };
        else if (!activeDelegation(row, phase.id)) { phase.completedAt = this.now(); phase.status = "done"; }
        message = `Manager ${input.accept ? "accepted" : "returned"} phase ${phase.title}: ${notes}`;
      }
    } else if (action === "start") {
      if (phase.completedAt != null) throw new Error("Reopen this phase before starting");
      if (!entry && phase.assigneeId !== handlingAgentId(row, phase.id)) throw new Error("Use Start with agent to dispatch this assigned phase through its Owner");
      const agentId = handlingAgentId(row, phase.id);
      if (!agentId) throw new Error("Assign an Owner before starting");
      this.assertPhaseAvailable(agentId, row.id, phase.id);
      this.stopClock(row, this.now(), phase.id); phase.startedAt = this.now(); phase.lastStartedAt = this.now(); phase.status = "running";
      phase.activity = { agentId, role: entry ? entry.state === "review" ? "reviewer" : "worker" : "self", handoffId: entry?.id || null, requestId: input.activityId || uuid(), turnId: null };
      message = `Started phase: ${phase.title}`;
    } else if (action === "pause") {
      if (input.activityId && phase.activity?.requestId !== input.activityId) return this.get(input);
      this.stopClock(row, this.now(), phase.id); phase.status = entry?.state === "review" ? "review" : "paused";
      message = input.reason ? text(input.reason, "Pause reason", 500) : `Paused phase: ${phase.title}`;
    } else if (action === "complete" || action === "reopen") {
      if (entry) throw new Error("Submit and obtain this phase's manager acceptance before checking it complete or reopening it");
      if (actor.id && actor.id !== (phase.acceptanceManagerId || owner)) throw new Error("Only this phase's responsible manager can complete or reopen it");
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
    this.validatePhases(row);
    if (action === "start") this.bindings.set(phase.activity.agentId, { taskId: row.id, phaseId: phase.id, activityId: phase.activity.requestId });
    row.revision++; row.updatedAt = this.now(); this.event(row, message, actor); this.save(row); this.changed(row.id);
    return this.get({ id: row.id });
  }
  assertPhaseAvailable(agentId, taskId, phaseId) {
    for (const row of this.rows.values()) if (isPhaseTask(row) && !row.archived) for (const p of row.phases) {
      if ((row.id !== taskId || p.id !== phaseId) && p.activity?.agentId === agentId && p.startedAt != null) throw new Error("This agent is already working on another phase");
    }
    const legacy = [...this.rows.values()].find(r => !isPhaseTask(r) && !r.archived && r.status === "running" && handlingAgentId(r) === agentId);
    if (legacy && phaseId) throw new Error("This agent is already working on another task");
  }
  phaseScope(agentId) {
    const preferred = this.bindings.get(agentId);
    if (typeof preferred === "string") { const row = this.rows.get(preferred); if (row && !row.archived && row.status !== "done" && handlingAgentId(row) === agentId) return null; }
    if (preferred && typeof preferred === "object") {
      const row = this.rows.get(preferred.taskId), phase = row?.phases.find(p => p.id === preferred.phaseId);
      if (row && !row.archived && phase?.completedAt == null && phase?.activity?.requestId === preferred.activityId && phase.activity.agentId === agentId && handlingAgentId(row, phase.id) === agentId) return { row, phase };
    }
    const candidates = [];
    for (const row of this.rows.values()) if (isPhaseTask(row) && !row.archived && row.status !== "done") for (const phase of row.phases) {
      if (phase.activity?.agentId === agentId && handlingAgentId(row, phase.id) === agentId && phase.completedAt == null) candidates.push({ row, phase });
    }
    candidates.sort((a, b) => Number(b.phase.startedAt != null) - Number(a.phase.startedAt != null) || (b.phase.lastStartedAt || 0) - (a.phase.lastStartedAt || 0));
    if (candidates.length > 1 && (candidates[0].phase.startedAt != null) === (candidates[1].phase.startedAt != null) && candidates[0].phase.lastStartedAt === candidates[1].phase.lastStartedAt) return null;
    return candidates[0] || null;
  }
  context(agentId) {
    const scope = this.phaseScope(agentId), row = scope?.row || this.bound(agentId), phase = scope?.phase, entry = row && activeDelegation(row, phase?.id);
    return { protocol: 6, agentId, todoId: row?.id || null, assigneeId: phase ? phase.assigneeId ?? null : row?.assigneeId || null,
      handlingAgentId: row ? handlingAgentId(row, phase?.id) : null, reviewerId: entry?.state === "review" ? entry.managerId : null,
      ...(phase ? { runningPhaseId: phase.id, phaseTitle: phase.title, handoffId: entry?.id || null, activityId: phase.activity?.requestId, activityRole: phase.activity?.role } : row?.activity ? { activityId: row.activity.requestId, activityRole: "legacy", handoffId: entry?.id || null } : {}), delegatedTasks: this.delegated(agentId) };
  }
  recordTurn(value, session) {
    const row = value.taskId && this.rows.get(value.taskId), phased = isPhaseTask(row || {});
    const phase = phased && row.phases.find(p => p.id === value.phaseId), activity = phased ? phase?.activity : row?.activity;
    if (!row || row.archived || !activity || (phased ? phase.startedAt == null : row.status !== "running" || value.phaseId != null)
      || activity.agentId !== value.agentId || activity.requestId !== value.activityId || activity.handoffId !== (value.handoffId || null)
      || activity.role !== value.activityRole || handlingAgentId(row, phased ? phase.id : undefined) !== value.agentId
      || !value.turnId || activity.turnId && activity.turnId !== value.turnId) return;
    const next = structuredClone(row);
    (phased ? next.phases.find(p => p.id === phase.id).activity : next.activity).turnId = value.turnId;
    this.save(next);
    if (session?.lastTurnId === value.turnId && ["completed", "failed", "interrupted"].includes(session.turnStatus)) this.finishTurn(value.agentId, session.turnStatus, value.turnId);
  }
  change(input, action) {
    const previous = this.raw(input.id);
    if (isPhaseTask(previous) || input.executionMode === "phases") return this.changePhase(input, action);
    if (action === "complete" && previous.phases.find(p => p.id === input.phaseId)?.completedAt != null) return this.get(input);
    if (input.revision !== previous.revision) throw new Error("This to-do changed. Refresh it before saving");
    const row = structuredClone(previous), actor = this.actor(input), delegation = activeDelegation(row); let message;
    this.materializeOwner(row, true);
    if (delegation && ["edit", "archive"].includes(action) && (action === "archive" || input.assigneeId !== undefined && input.assigneeId !== row.assigneeId)) throw new Error("Finish or review the active delegation before reassigning or archiving this task");
    if (row.archived && action !== "restore" && !(row.status === "done" && ["edit", "reopen"].includes(action))) throw new Error("Restore this archived to-do first");
    if (action === "restore" && row.status === "done") throw new Error("Completed tasks stay archived. Add a phase or reopen a completed phase to follow up");
    if (action === "edit") {
      this.stopClock(row);
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
      else if (row.status === "running") this.run(row);
      else if (row.status === "done") row.status = "queued";
      message = "Plan, assignment or documentation updated";
    } else if (action === "delegate") {
      if (actor.id !== handlingAgentId(row) || !actor.id) throw new Error("Only the current responsible agent can delegate this task");
      if (delegation?.state === "review") throw new Error("Review the submitted result before delegating again");
      if (!input.assigneeId || input.assigneeId === actor.id || (row.delegations || []).some(entry => !["accepted", "recalled"].includes(entry.state) && entry.managerId === input.assigneeId)) throw new Error("Choose a direct report outside the active handoff chain");
      const instructions = text(input.instructions, "Delegation scope", 6000), acceptanceCriteria = text(input.acceptanceCriteria, "Acceptance criteria", 3000);
      this.stopClock(row);
      if (!delegation) row.acceptanceManagerId = actor.id;
      const candidate = this.replyContext(actor.id);
      if (!row.replyContext && candidate && (!candidate.taskId || candidate.taskId === row.id)) row.replyContext = candidate;
      row.delegations ||= [];
      row.delegations.push({ id: uuid(), managerId: actor.id, workerId: input.assigneeId, instructions, acceptanceCriteria, state: "working", createdAt: this.now(),
        replyContext: taskReplyContext(row, candidate),
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
      if (!delegation || delegation.state !== "working" || actor.id !== delegation.workerId) throw new Error("Only the assigned worker can submit the active delegation");
      delegation.report = text(input.report, "Delivery report and evidence", 6000); delegation.submittedAt = this.now(); delegation.state = "review";
      delegation.delivery = { recipientId: delegation.managerId, requestId: `delegation-${uuid()}`, state: "pending" };
      this.stopClock(row); row.status = "paused";
      message = `Submitted for manager acceptance: ${delegation.report}`;
    } else if (action === "review") {
      if (!delegation || delegation.state !== "review" || actor.id !== delegation.managerId) throw new Error("Only the delegating manager can review this submission");
      if (typeof input.accept !== "boolean") throw new Error("Choose whether to accept the submitted result");
      const notes = text(input.notes, "Acceptance evidence or return feedback", 6000);
      this.stopClock(row); delegation.review = { accepted: input.accept, notes, at: this.now(), managerId: actor.id };
      delegation.state = input.accept ? "accepted" : "working";
      delete delegation.delivery;
      if (!input.accept) {
        delegation.delivery = { recipientId: delegation.workerId, requestId: `delegation-${uuid()}`, state: "pending" };
      }
      row.status = input.accept ? "paused" : "queued";
      message = `${input.accept ? "Manager accepted" : "Manager returned for changes"}: ${notes}`;
    } else if (action === "start") {
      if (row.phases.every(p => p.completedAt != null)) throw new Error("Reopen a completed phase before starting");
      if ((input.execute === true || actor.id) && delegation?.state === "working") Object.assign(row, this.references({ assigneeId: handlingAgentId(row) }, row));
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
    const handler = handlingAgentId(row);
    if (row.status === "running" && handler) {
      this.assertPhaseAvailable(handler, row.id, null);
      if (!row.activity || row.activity.agentId !== handler || previous.status !== "running" || action === "start" || input.activityId && row.activity.requestId !== input.activityId) row.activity = { agentId: handler, role: "legacy", handoffId: activeDelegation(row)?.id || null, requestId: input.activityId || uuid(), turnId: null };
      for (const other of this.rows.values()) if (!isPhaseTask(other) && other.id !== row.id && handlingAgentId(other) === handler && other.status === "running") this.change({ id: other.id, revision: other.revision, source: "system", reason: "Agent switched to another to-do" }, "pause");
    }
    row.revision++; row.updatedAt = this.now(); this.event(row, message, actor); this.save(row);
    for (const [agentId, id] of this.bindings) if (id === row.id && (row.archived || row.status === "done" || handler !== agentId)) this.bindings.delete(agentId);
    if (row.status === "running" && handler) this.bindings.set(handler, row.id);
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
  bound(agentId) {
    const scoped = this.phaseScope(agentId); if (scoped) return scoped.row;
    const binding = this.bindings.get(agentId), preferred = typeof binding === "string" ? this.rows.get(binding) : null;
    if (preferred && !isPhaseTask(preferred) && !preferred.archived && preferred.status !== "done" && handlingAgentId(preferred) === agentId) return preferred;
    return [...this.rows.values()].filter(r => !isPhaseTask(r) && !r.archived && handlingAgentId(r) === agentId && r.status !== "done").sort((a, b) => (b.lastStartedAt || 0) - (a.lastStartedAt || 0) || b.updatedAt - a.updatedAt)[0] || null;
  }
  startForAgent(agentId, id, phaseId, activityId) {
    const row = this.raw(id);
    if (isPhaseTask(row)) {
      const phase = row.phases.find(p => p.id === phaseId);
      if (!phase || row.archived || phase.completedAt != null || handlingAgentId(row, phaseId) !== agentId) throw new Error("Choose this agent's unfinished phase");
      this.change({ id: row.id, revision: row.revision, phaseId, activityId, source: "system" }, "start");
      return this.raw(row.id);
    }
    id = row.id;
    if (handlingAgentId(row) !== agentId || row.archived || row.status === "done") throw new Error("Choose an unfinished to-do assigned to this agent's execution or acceptance workflow");
    this.assertPhaseAvailable(agentId, row.id, null);
    for (const other of this.rows.values()) if (!isPhaseTask(other) && other.id !== id && handlingAgentId(other) === agentId && other.status === "running") this.change({ id: other.id, revision: other.revision, source: "system", reason: "Agent switched to another to-do" }, "pause");
    const requestId = activityId || uuid();
    if (row.status !== "running" || activeDelegation(row)?.state === "working" && row.assigneeId !== agentId) this.change({ id, revision: row.revision, activityId: requestId, source: "system", execute: true }, "start");
    if (this.raw(id).activity?.requestId !== requestId) {
      const next = structuredClone(this.raw(id)); next.activity = { agentId, role: "legacy", handoffId: activeDelegation(next)?.id || null, requestId, turnId: null }; this.save(next);
    }
    this.bindings.set(agentId, id); return this.raw(id);
  }
  finishTurn(agentId, status, turnId) {
    const scope = this.phaseScope(agentId);
    if (scope) {
      const { row, phase } = scope;
      if (turnId && phase.activity?.turnId === turnId && phase.startedAt != null) this.change({ id: row.id, revision: row.revision, phaseId: phase.id, activityId: phase.activity.requestId, source: "system", reason: `Agent turn ${status}; phase timer paused` }, "pause");
      return;
    }
    const row = this.bound(agentId);
    if (turnId && row?.activity && (row.activity.agentId !== agentId || row.activity.turnId !== turnId)) return;
    if (row?.status === "running") this.change({ id: row.id, revision: row.revision, source: "system", reason: status === "completed" ? "Agent turn ended; waiting for follow-up or a phase update" : `Agent turn ${status}; timer paused` }, "pause");
  }
  checkpoint() { for (const row of this.rows.values()) if (row.status === "running") {
    const next = structuredClone(row), running = next.phases.filter(p => p.startedAt != null).map(p => p.id); this.stopClock(next);
    if (isPhaseTask(next)) { for (const p of next.phases) if (running.includes(p.id)) p.startedAt = this.now(); }
    else { const phase = next.phases.find(p => p.completedAt == null); if (phase) phase.startedAt = this.now(); }
    this.save(next);
  } }
  close() { for (const row of [...this.rows.values()]) if (row.status === "running") {
    if (isPhaseTask(row)) { for (const p of row.phases.filter(p => p.startedAt != null)) this.change({ id: row.id, phaseId: p.id, revision: this.raw(row.id).revision, source: "system", reason: "Office stopped; timer paused" }, "pause"); }
    else this.change({ id: row.id, revision: row.revision, source: "system", reason: "Office stopped; timer paused" }, "pause");
  } }
}
module.exports = { OfficeTodos, phaseDuration: duration, activeDelegation, openDelegations, handlingAgentId, isPhaseTask };
