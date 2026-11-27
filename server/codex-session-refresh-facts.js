"use strict";
const { isPhaseTask, taskOwnerId } = require("./office-todos");
// Pure factual gates. Author declarations and explicit new-topic intent are
// separate; no prose, timer, task-name or question-name classification.
function refreshFacts({ store, userSends, delivery, delegation, schedules, voice, workspace, todos, reservation, stopping }, id, trigger, mode = "automatic") {
  const reasons = [], add = value => reasons.push(value);
  if (stopping() || reservation.held) add("Office is stopping or the backend is reserved");
  if (userSends.unavailable || userSends.blocked(id)) add("Earlier user input is pending or unconfirmed; review saved messages");
  const all = [...Object.values(delivery.data.messages), ...delivery.sources()];
  const pending = all.filter(m => m.recipient === id && ["pending", "sending", "uncertain"].includes(m.state));
  const source = trigger && pending.find(m => m.id === trigger.requestId && m.hash === trigger.sourceHash && m.state === "pending");
  const ownDrain = source && delivery.refreshPreparing?.get(id) === source.id;
  if (delivery.inflight.has(id) && !ownDrain || delivery.urgentInflight.has(id) || delegation.inflight.has(id)) add("Agent delivery is in flight");
  if (pending.some(m => m !== source)) add("An inbox message or task report is pending or unconfirmed");
  if (Object.values(delivery.data.batches).some(b => b.recipient === id && ["sending", "uncertain"].includes(b.state))) add("A native delivery receipt is unconfirmed");
  const next = source?.taskId && trigger?.nextScope?.taskId === source.taskId && (trigger.nextScope.phaseId || null) === (source.phaseId || null) ? trigger.nextScope : null;
  // Task responsibility limits automatic eligibility, never a manual fresh start.
  if (mode !== "manual") for (const task of todos.rows.values()) {
    if (task.archived || task.status === "done") continue;
    const exempt = phase => next && next.taskId === task.id && (next.phaseId || null) === (phase?.id || null)
      && (phase || task).assigneeId === id && !(phase || task).elapsedMs && !(phase || task).lastStartedAt && !(phase || task).startedAt
      && (phase || task).status === "queued";
    if (isPhaseTask(task)) {
      const unfinished = task.phases.filter(p => p.status !== "done" && !p.completedAt);
      if (unfinished.some(p => !exempt(p) && p.assigneeId === id)) add(`Unfinished assigned phase in ${task.code || task.id}`);
      if (unfinished.some(p => p.acceptanceManagerId === id)) add(`Independent acceptance responsibility remains open in ${task.code || task.id}`);
      if (taskOwnerId(task) === id && unfinished.some(p => !exempt(p))) add(`Follow-up responsibility remains open in ${task.code || task.id}`);
      for (const handoff of task.delegations || []) if (["working", "review"].includes(handoff.state) && [handoff.workerId, handoff.managerId].includes(id)) {
        const phase = task.phases.find(p => p.id === handoff.phaseId);
        if (!(exempt(phase) && handoff.workerId === id && handoff.delivery?.requestId === source?.id && handoff.state === "working")) add(`A worker report or independent acceptance is outstanding in ${task.code || task.id}`);
      }
    } else if (!exempt(null) && (task.assigneeId === id || taskOwnerId(task) === id || task.acceptanceManagerId === id || (task.delegations || []).some(h => ["working", "review"].includes(h.state) && [h.workerId,h.managerId].includes(id)))) add(`Unfinished responsibility in ${task.code || task.id}`);
  }
  const checkpoint = store.get(id).refreshCheckpoint;
  if (mode !== "manual" && trigger && checkpoint?.closedScope?.kind === "task") {
    const scope = checkpoint.closedScope, task = todos.rows.get(scope.taskId), phase = task?.phases?.find(p => p.id === scope.phaseId);
    if (!task || (scope.phaseId ? !phase || phase.status !== "done" : task.status !== "done" && !task.archived)) add("Checkpoint's declared old scope is not actually completed");
    if (next?.taskId === scope.taskId) add("The next phase of the same task is not a separate independent topic");
  }
  if (voice.active?.threadId === id) add("A voice call is starting or active");
  if (workspace.starts.has(id) || workspace.snapshot(id)?.running) add("A workspace terminal is starting or active");
  for (const task of schedules.data.tasks.filter(t => t.threadId === id)) {
    const run = task.runs?.at(-1);
    if (["waiting", "dispatching", "running", "unknown"].includes(run?.status)) add("A scheduled run is pending, active or unconfirmed");
    if (task.enabled && task.nextRunAt != null) add("An enabled future schedule has no verified conversation-dependency boundary; keep the schedule unchanged");
  }
  return [...new Set(reasons)];
}
module.exports = { refreshFacts };
