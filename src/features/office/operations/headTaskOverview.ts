import { CEO_ID, isDepartmentManager, type OrganizationView } from "@/lib/office/organization";
import { taskWatcherIds, needsFollowUp, shortPhaseCode, type DirectoryTaskSummary, type TaskProgressState, type TaskTracking } from "./agentDirectory";

export type HeadWork = {
  id: string; phaseId?: string; title: string; status: string; scopeLabel?: string;
  people: { role: string; agentId?: string | null }[]; state?: TaskProgressState; progressAt?: number | null;
};
export type HeadTaskRow = { id: string; code: string; title: string; work: HeadWork[]; tracking?: TaskTracking; closed?: boolean; progressAt?: number | null; completed?: { id: string; title: string; at: number | null }[] };

export function taskProgressAgentIds(organization: OrganizationView): Set<string> {
  return new Set([
    CEO_ID,
    ...organization.people.filter(isDepartmentManager).map(person => person.id),
    ...(organization.departments || []).flatMap(department => department.heads.map(head => head.id)),
  ]);
}

// Progress follows explicit watchers plus the Owner, independently of execution/department.
// Use the already loaded raw list; never infer work from chat, busy or updatedAt.
export function headTaskRows(headId: string, tasks: readonly DirectoryTaskSummary[]): HeadTaskRow[] {
  return [...new Map(tasks.map(task => [task.id, task])).values()].filter(task => taskWatcherIds(task).includes(headId)).map(task => {
    let work: HeadWork[];
    if (!needsFollowUp(task)) {
      work = [{ id: task.id, title: task.title, status: task.status === "done" ? "Completed" : "Archived", people: [] }];
    } else if (task.executionMode !== "phases") {
      // A legacy timer locates the current plan position, not its handoff or executor.
      const clocked = (task.phases || []).filter(phase => phase.startedAt != null);
      const candidate = clocked.length === 1 ? clocked[0] : null;
      const timed = task.status === "running" && candidate?.id && candidate.title?.trim()
        && (task.phases || []).filter(phase => phase.id === candidate.id).length === 1
        && candidate.completedAt == null && typeof candidate.startedAt === "number"
        && Number.isFinite(candidate.startedAt) && candidate.startedAt >= 0
        && (candidate.status == null || candidate.status === "running") ? candidate : null;
      work = [{ id: task.id, ...(timed ? { phaseId: timed.id, scopeLabel: "Current timed phase" } : {}), title: timed ? `${shortPhaseCode(timed.id!)} · ${timed.title}` : "Specific phase not recorded", status: task.reviewerId ? "Awaiting manager review" : task.status === "running" ? "Running" : task.status === "paused" ? "Paused" : task.status === "queued" ? "Not started" : "Not recorded",
        progressAt: recordedPauseAt(task.pauseContext), people: [...(task.reviewerId ? [{ role: "Reviewer", agentId: task.reviewerId }] : []), { role: "Task-level responsibility", agentId: task.assigneeId }], state: task.tracking?.current.find(item => item.phaseId === null) }];
    } else {
      work = (task.phases || []).flatMap(phase => {
        const state = task.tracking?.current.find(item => item.phaseId === phase.id);
        if (!phase.id || phase.completedAt != null || !["running", "paused", "review"].includes(phase.status || "") && !(phase.status === "queued" && state?.waitingForId)) return [];
        const handoff = [...(task.delegations || [])].reverse().find(e => e.phaseId === phase.id && !["accepted", "recalled"].includes(e.state));
        const reviewing = phase.status === "running" && phase.activity?.role === "reviewer";
        return [{ id: phase.id, phaseId: phase.id, title: `${shortPhaseCode(phase.id)} · ${phase.title}`,
          progressAt: recordedPauseAt(phase.pauseContext), status: phase.status === "review" ? "Awaiting manager review" : phase.status === "paused" ? "Paused" : phase.status === "queued" ? "Not started" : reviewing ? "Reviewing" : "Running", state,
          people: phase.status === "review" ? [{ role: "Reviewer", agentId: phase.reviewerId }, { role: "Submitted by", agentId: phase.assigneeId }]
            : ["paused", "queued"].includes(phase.status || "") ? [{ role: "Responsible", agentId: phase.assigneeId }]
              : phase.activity?.agentId ? [{ role: reviewing ? "Reviewing" : "Executing", agentId: phase.activity.agentId }]
                : handoff?.state === "working" ? [{ role: "Responsible", agentId: handoff.workerId }] : [{ role: "Executing", agentId: undefined }],
        }];
      });
      if (!work.length) {
        const pending = (task.phases || []).filter(phase => phase.completedAt == null);
        const queued = pending.length > 0 && pending.every(phase => phase.status === "queued");
        work = [{ id: task.id, title: queued ? "No phase started" : "Current work not recorded", status: queued ? "Not started" : "Not recorded", people: [] }];
      }
    }
    for (const item of work) {
      if (item.state?.status === "paused") item.status = item.state.needsUserDecision === true ? "Needs user decision" : "Paused";
      else if (item.state?.status === "review") item.status = "Awaiting manager review";
    }
    // Keep every real current phase, ordered ahead of parked/queued history.
    const rank = (w: HeadWork) => ["Running", "Reviewing"].includes(w.status) ? 0 : w.status === "Awaiting manager review" ? 1 : w.status === "Needs user decision" ? 2 : 3;
    work.sort((a, b) => rank(a) - rank(b));
    const completed = (task.phases || []).filter(p => p.id && p.completedAt != null).map(p => ({ id: p.id!, title: p.title || shortPhaseCode(p.id!), at: p.completedAt ?? null }));
    return { id: task.id, code: task.code || task.id, title: task.title, work, tracking: task.tracking, closed: !needsFollowUp(task), progressAt: lastTaskProgress(task), ...(completed.length ? { completed } : {}) };
  }).sort((a, b) => Number(b.work.some(w => ["Running", "Reviewing"].includes(w.status))) - Number(a.work.some(w => ["Running", "Reviewing"].includes(w.status))));
}


const recordedPauseAt = (pause: DirectoryTaskSummary["pauseContext"]) => pause && ["agent", "user"].includes(pause.actor?.source || "") && Number.isFinite(pause.at) && pause.at >= 0 ? pause.at : null;
// These are recorded work transitions, not document edits or timer bookkeeping.
const progressActions = new Set(["Started", "Following resumed", "Completed", "Submitted", "Accepted", "Returned", "Recalled", "Delegated", "Reopened", "Paused"]);
export function lastTaskProgress(task: DirectoryTaskSummary): number | null {
  const times = [task.completedAt, ...(task.phases || []).map(p => p.completedAt),
    ...(task.tracking?.recent || []).filter(e => progressActions.has(e.action) && !(e.action === "Paused" && e.actorSource === "system")).map(e => e.at),
    ...[task.pauseContext, ...(task.phases || []).map(p => p.pauseContext)].filter(p => p && ["agent", "user"].includes(p.actor?.source || "")).map(p => p!.at),
  ].filter((at): at is number => typeof at === "number" && Number.isFinite(at) && at >= 0);
  return times.length ? Math.max(...times) : null;
}
export function groupHeadTaskRows(rows: readonly HeadTaskRow[], now: number, windowMinutes: number) {
  return rows.flatMap(row => {
    const running = !row.closed && row.work.some(w => ["Running", "Reviewing"].includes(w.status));
    const recent = row.progressAt != null && row.progressAt <= now && now - row.progressAt < windowMinutes * 60000;
    if (row.closed && !recent) return [];
    return [{ ...row, activityGroup: running ? "running" as const : recent ? "recent" as const : "other" as const }];
  }).sort((a, b) => ({ running: 0, recent: 1, other: 2 }[a.activityGroup] - { running: 0, recent: 1, other: 2 }[b.activityGroup]) || (b.progressAt ?? -1) - (a.progressAt ?? -1) || a.id.localeCompare(b.id));
}
