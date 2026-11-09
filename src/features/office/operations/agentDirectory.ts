import type { FieldworkTaskSummary } from "@/lib/office/fieldworkTask";
import type { AgentAvatarProfile } from "@/lib/avatars/profile";
import { CEO_ID, type OrganizationPerson } from "@/lib/office/organization";
import type { ChatRosterEntry } from "./chatRoster";

export type AgentDirectoryView = "project" | "activity" | "organization";
export type CurrentAgentTask = { id: string; title: string; code: string; roles?: ("Owner" | "Assignee" | "Reviewer")[]; phases?: { id: string; code: string; title: string; status: string; roles: ("Assignee" | "Reviewer")[] }[] };
export const shortPhaseCode = (id: string) => `P-${id.slice(0, 8)}`;
export type DirectoryAgent = ChatRosterEntry & { color: string; avatarProfile?: AgentAvatarProfile | null; tasks?: CurrentAgentTask[] };
export type DirectoryTaskSummary = FieldworkTaskSummary & { id: string; code?: string; title: string; assigneeId: string | null; assigneeName?: string | null; ownerId?: string | null; ownerName?: string | null; departmentId?: string | null; reviewerId?: string | null; status: string; archived: boolean; delegations?: { phaseId?: string; workerId: string; managerId: string; state: string }[] };
export const needsFollowUp = (task: DirectoryTaskSummary) => !task.archived && task.status !== "done";

// The directory shows active work, independently of department follow-up totals.
export function currentTasksByAgent(tasks: DirectoryTaskSummary[]): Map<string, CurrentAgentTask[]> {
  const result = new Map<string, CurrentAgentTask[]>();
  for (const task of tasks) {
    if (!needsFollowUp(task)) continue;
    const phaseMode = task.executionMode === "phases";
    const running = (task.phases || []).filter(p => p.id && p.completedAt == null && p.status === "running");
    if (phaseMode ? !running.length : task.status !== "running") continue;
    const handler = (item: { handlingAgentId?: string | null; assigneeId?: string | null }) => item.handlingAgentId || item.assigneeId;
    for (const id of new Set([task.ownerId, ...(phaseMode ? running.map(handler) : [handler(task)])])) {
      if (!id) continue;
      const assigned = result.get(id) || [];
      if (assigned.some(existing => existing.id === task.id)) continue;
      const phases = phaseMode ? running.filter(p => id === task.ownerId || handler(p) === id) : [];
      const roles: ("Owner" | "Assignee" | "Reviewer")[] = [];
      if (id === task.ownerId) roles.push("Owner");
      if (phaseMode ? phases.some(p => p.assigneeId === id) : id === task.assigneeId) roles.push("Assignee");
      if (phaseMode ? phases.some(p => p.reviewerId === id) : id === task.reviewerId) roles.push("Reviewer");
      assigned.push({ id: task.id, title: task.title, code: task.code || task.id, roles, ...(phaseMode ? { phases: phases.flatMap(p => p.id ? [{ id: p.id, code: shortPhaseCode(p.id), title: p.title,
        roles: [...(p.assigneeId === id ? ["Assignee" as const] : []), ...(p.reviewerId === id ? ["Reviewer" as const] : [])], status: "running" }] : []) } : {}) });
      result.set(id, assigned);
    }
  }
  return result;
}

export type ReportingNode = { person: OrganizationPerson; reference: boolean; children: ReportingNode[] };

export function reportingForest(people: OrganizationPerson[], agents: DirectoryAgent[]): ReportingNode[] {
  const records = new Map(people.map(person => [person.id, person]));
  // Sessions can arrive before their organization settings. They must stay reachable.
  for (const agent of agents) if (!records.has(agent.id)) records.set(agent.id, {
    id: agent.id, name: agent.name, title: "Worker", department: agent.projectName, departmentId: agent.projectId, reportsTo: [],
  });
  const children = new Map<string, OrganizationPerson[]>();
  for (const person of records.values()) for (const manager of person.reportsTo) {
    if (!records.has(manager)) continue;
    const reports = children.get(manager) || [];
    reports.push(person); children.set(manager, reports);
  }
  const seen = new Set<string>();
  const visit = (person: OrganizationPerson): ReportingNode => {
    const reference = seen.has(person.id);
    seen.add(person.id);
    return { person, reference, children: reference ? [] : (children.get(person.id) || []).map(visit) };
  };
  const roots = [...records.values()].filter(person => person.id === CEO_ID || !person.reportsTo.some(id => records.has(id)));
  const forest = roots.map(visit);
  // Also retain disconnected/corrupt historical relationships without recursing forever.
  for (const person of records.values()) if (!seen.has(person.id)) forest.push(visit(person));
  return forest;
}
