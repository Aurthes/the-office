"use strict";

// Read-only, bounded projection of records already kept by OfficeTodos.
// No events are added, history is not backfilled, and edits are not progress.
const short = value => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 180) : null;
const time = value => Number.isFinite(value) && value >= 0 ? value : null;
const metadata = /^(Agent turn .*; activity timer stopped$|Agent switched task; activity timer stopped$|Office (stopped; activity timers stopped$|restarted; activity timers stopped at the last checkpoint$)|Plan, .*updated$|Removed phase:|Separated execution assignment|Completed task automatically archived|To-do archived$|To-do restored$)/;
function taskTracking(row) {
  const phases = row.phases || [], mode = row.executionMode === "phases";
  const handoffs = (row.delegations || []).slice(-100), events = (row.events || []).slice(-100);
  const entries = [], notes = [];
  const add = (action, at, actor, phaseId, detail, source = "handoff") => {
    if (time(at) !== null) entries.push({ action, at, actorId: actor?.id || null, actorName: short(actor?.name), actorSource: actor?.source || "agent", phaseId: phaseId || null, detail: short(detail), source });
  };
  for (const entry of handoffs) {
    add("Delegated", entry.createdAt, { id: entry.managerId }, entry.phaseId);
    add("Submitted", entry.submittedAt, { id: entry.workerId }, entry.phaseId, entry.report);
    if (entry.review) add(entry.review.accepted ? "Accepted" : "Returned", entry.review.at, { id: entry.review.managerId || entry.managerId }, entry.phaseId, entry.review.notes);
    add("Recalled", entry.recalledAt, { id: entry.managerId }, entry.phaseId);
  }
  for (const event of events) {
    const message = event.message || "";
    if (time(event.at) !== null && Array.isArray(event.followup)) {
      for (const change of event.followup) if (["running", "paused"].includes(change.status) && (!mode && change.phaseId === null || mode && phases.some(p => p.id === change.phaseId))) add(change.status === "running" ? "Following resumed" : "Paused", event.at, event.actor, change.phaseId, null, "event");
      continue;
    }
    if (time(event.at) === null || metadata.test(message)) continue;
    const match = /^(Started phase: |Completed phase: |Reopened phase: |Delegated phase: |Submitted phase for manager acceptance: |Manager accepted phase |Manager returned phase |Paused phase: )/.exec(message);
    const matches = match ? phases.filter(p => message === match[0] + p.title || message.startsWith(match[0] + p.title + ": ") || message.startsWith(match[0] + p.title + ";")) : [];
    const phaseId = matches.length === 1 ? matches[0].id : null;
    const action = /^(Work started$|Started phase: )/.test(message) ? "Started"
      : /^Completed phase: /.test(message) ? "Completed"
      : /^Reopened phase: /.test(message) ? "Reopened"
      : /^Delegated (phase: |to )/.test(message) ? "Delegated"
      : /^Submitted (phase for manager acceptance: |for manager acceptance: )/.test(message) ? "Submitted"
      : /^Manager accepted(?:: | phase )/.test(message) ? "Accepted"
      : /^Manager returned( for changes: | phase )/.test(message) ? "Returned"
      : /^(Manager recalled delegation: |Phase handoff recalled: )/.test(message) ? "Recalled"
      : /^(Work paused$|Paused phase: |Office (restarted;|stopped;)|Agent switched to another to-do$|Agent turn .*(timer paused|waiting for follow-up))/.test(message) ? "Paused"
      : message === "To-do created" ? "Created" : null;
    if (!action) { notes.push({ at: event.at, text: short(message), actorId: event.actor?.id || null, actorName: short(event.actor?.name) }); continue; }
    // Prefer structured handoff identity/report to its duplicate display event.
    const duplicates = entries.filter(e => e.action === action && e.at === event.at && (!phaseId || e.phaseId === phaseId));
    if (duplicates.length) { if (duplicates.length === 1 && !duplicates[0].detail) duplicates[0].detail = short(message); continue; }
    add(action, event.at, event.actor, phaseId, phaseId && ["Started", "Completed", "Reopened", "Delegated"].includes(action) ? matches[0].title : message, "event");
  }
  // activity.startedAt survives checkpoints; legacy lastStartedAt also changes
  // on edits, so it must never be used as an execution/state timestamp.
  for (const p of mode ? phases : []) {
    const at = time(p.activity?.startedAt) ?? (mode ? time(p.lastStartedAt) : null);
    if (at !== null && !entries.some(e => e.action === "Started" && e.at === at && e.phaseId === (mode ? p.id : null))) add("Started", at, { id: p.activity?.agentId }, mode ? p.id : null, null, "activity");
  }
  entries.sort((a, b) => a.at - b.at);
  const states = new Map(), running = new Set();
  for (const entry of entries) {
    let key = entry.phaseId;
    if (mode && !key && entry.action === "Paused" && running.size === 1) key = [...running][0];
    if (mode && !key) continue; // Old ambiguous events cannot bind a phase.
    if (["Started", "Following resumed"].includes(entry.action)) running.add(key);
    if (["Paused", "Submitted", "Completed", "Accepted", "Returned", "Recalled", "Reopened", "Delegated"].includes(entry.action)) running.delete(key);
    if (entry.action !== "Created") states.set(key, entry);
  }
  const current = (mode ? phases.filter(p => p.completedAt == null) : [row]).map(p => {
    const phaseId = mode ? p.id : null, entry = [...handoffs].reverse().find(e => (e.phaseId || null) === phaseId && !["accepted", "recalled"].includes(e.state));
    const previous = states.get(phaseId), clockActive = mode ? p.startedAt != null : phases.some(phase => phase.startedAt != null);
    const pausedExplicitly = p.status === "paused" && (p.pauseContext || previous?.action === "Paused" && previous.actorSource !== "system" && (!entry?.submittedAt || previous.at >= entry.submittedAt));
    const status = entry?.state === "review" && !clockActive && !pausedExplicitly ? "review" : p.status;
    let since = null, reason = null, reasonCode = null, waitingForId = null;
    if (status === "running") since = previous?.action === "Following resumed" ? previous.at : (mode ? time(p.activity?.startedAt) ?? time(p.lastStartedAt) : null) ?? (previous?.action === "Started" ? previous.at : null);
    else if (status === "review") { since = time(entry?.submittedAt); reasonCode = "Submitted for manager acceptance"; waitingForId = entry?.managerId || null; }
    else if (status === "paused" && previous && ["Paused", "Accepted", "Recalled"].includes(previous.action)) { since = previous.at; reason = ["Paused", "Recalled"].includes(previous.action) && !/^(Work paused$|Paused phase: )/.test(previous.detail || "") ? previous.detail : null; }
    else if (status === "queued" && entry) {
      since = entry.review?.accepted === false ? time(entry.review.at) : time(entry.createdAt);
      reason = entry.review?.accepted === false ? short(entry.review.notes) : null; reasonCode = reason ? null : "Assigned; not started"; waitingForId = entry.workerId;
    }
    if (status === "paused" && p.pauseContext) { since = time(p.pauseContext.at); reason = short(p.pauseContext.reason); }
    const legacyTimerPause = status === "paused" && !p.pauseContext && previous?.action === "Paused" && previous.actorSource === "system" && /^(Agent turn |Office (stopped|restarted))/.test(previous.detail || "");
    if (legacyTimerPause) { reason = null; reasonCode = "Legacy timer stop; follow-up not recorded"; }
    return { phaseId, status: status || "unknown", since, reason, reasonCode, waitingForId,
      needsUserDecision: status === "paused" ? p.pauseContext?.needsUserDecision ?? null : null };
  });
  return { recent: entries.filter(e => e.action !== "Paused").slice(-3).reverse(), current,
    unscopedNote: notes.at(-1) || null, historyLimited: events.length >= 100 || handoffs.length >= 100 };
}
module.exports = { taskTracking };
