import type { AgentAvatarProfile } from "@/lib/avatars/profile";
import { CEO_ID, type OrganizationPerson } from "@/lib/office/organization";
import type { ChatRosterEntry } from "./chatRoster";

export type AgentDirectoryView = "project" | "activity" | "organization";
export type CurrentAgentTask = { id: string; title: string; code: string };
export type DirectoryAgent = ChatRosterEntry & { color: string; avatarProfile?: AgentAvatarProfile | null; tasks?: CurrentAgentTask[] };
export type DirectoryTaskSummary = { id: string; title: string; assigneeId: string | null; status: string; archived: boolean };

// A title such as "Agent View Compression (AVC)" explicitly supplies its code.
// Other titles use initials, or a short readable title for languages without spaces.
export function taskCode(title: string): string {
  const explicit = title.match(/[（(]([A-Za-z][A-Za-z0-9-]{1,11})[)）]/);
  if (explicit) return explicit[1];
  const words = title.trim().split(/\s+/);
  if (words.length > 1 && words.every(word => /^[A-Za-z]/.test(word))) return words.slice(0, 6).map(word => word[0]).join("").toUpperCase();
  const chars = Array.from(title.trim());
  return chars.slice(0, 8).join("") + (chars.length > 8 ? "…" : "");
}

// Assignment lasts until completion, archive or reassignment, including pauses.
export function currentTasksByAgent(tasks: DirectoryTaskSummary[]): Map<string, CurrentAgentTask[]> {
  const result = new Map<string, CurrentAgentTask[]>();
  for (const task of tasks) {
    if (task.status === "done" || task.archived || !task.assigneeId) continue;
    const assigned = result.get(task.assigneeId) || [];
    if (assigned.some(existing => existing.id === task.id)) continue;
    assigned.push({ id: task.id, title: task.title, code: taskCode(task.title) });
    result.set(task.assigneeId, assigned);
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
