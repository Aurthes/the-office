import { isDepartmentManager, type OrganizationView } from "@/lib/office/organization";
import { needsFollowUp, shortPhaseCode, type DirectoryTaskSummary } from "./agentDirectory";

export type HeadWork = {
  id: string; phaseId?: string; title: string; status: string;
  people: { role: string; agentId?: string | null }[];
};
export type HeadTaskRow = { id: string; code: string; title: string; work: HeadWork[] };

export function departmentManagerIds(organization: OrganizationView): Set<string> {
  return new Set([
    ...organization.people.filter(isDepartmentManager).map(person => person.id),
    ...(organization.departments || []).flatMap(department => department.heads.map(head => head.id)),
  ]);
}

// Management follows explicit parent Owner, independently of execution/department.
// Use the already loaded raw list; never infer work from chat, busy or updatedAt.
export function headTaskRows(headId: string, tasks: readonly DirectoryTaskSummary[]): HeadTaskRow[] {
  return [...new Map(tasks.filter(task => task.ownerId === headId && needsFollowUp(task)).map(task => [task.id, task])).values()].map(task => {
    let work: HeadWork[];
    if (task.executionMode !== "phases") {
      work = [{ id: task.id, title: "Specific phase not recorded", status: task.reviewerId ? "Awaiting manager review" : task.status === "running" ? "Running" : task.status === "paused" ? "Paused" : task.status === "queued" ? "Not started" : "Not recorded",
        people: [...(task.reviewerId ? [{ role: "Reviewer", agentId: task.reviewerId }] : []), { role: "Task-level responsibility", agentId: task.assigneeId }] }];
    } else {
      work = (task.phases || []).flatMap(phase => {
        if (!phase.id || phase.completedAt != null || !["running", "paused", "review"].includes(phase.status || "")) return [];
        const reviewing = phase.status === "running" && phase.activity?.role === "reviewer";
        return [{ id: phase.id, phaseId: phase.id, title: `${shortPhaseCode(phase.id)} · ${phase.title}`,
          status: phase.status === "review" ? "Awaiting manager review" : phase.status === "paused" ? "Paused" : reviewing ? "Reviewing" : "Running",
          people: phase.status === "review" ? [{ role: "Reviewer", agentId: phase.reviewerId }, { role: "Submitted by", agentId: phase.assigneeId }]
            : phase.status === "paused" ? [{ role: "Responsible", agentId: phase.assigneeId }]
              : [{ role: reviewing ? "Reviewing" : "Executing", agentId: phase.activity?.agentId }],
        }];
      });
      if (!work.length) {
        const pending = (task.phases || []).filter(phase => phase.completedAt == null);
        const queued = pending.length > 0 && pending.every(phase => phase.status === "queued");
        work = [{ id: task.id, title: queued ? "No phase started" : "Current work not recorded", status: queued ? "Not started" : "Not recorded", people: [] }];
      }
    }
    return { id: task.id, code: task.code || task.id, title: task.title, work };
  });
}
