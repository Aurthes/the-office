import type { CompanyRoster } from "@/features/retro-office/core/companyLayout";
import type { AgentAvatarProfile } from "@/lib/avatars/profile";

export const CEO_ID = "npc:ceo";
export const OPEN_DEPARTMENT_ID = "open-workspace";
export type OfficePosition = { title: string; reportsTo: string[] };
export type OfficeOrganization = Record<string, OfficePosition>;
export type OrganizationPerson = OfficePosition & { id: string; name: string; department: string; departmentId: string | null };
export type OrganizationView = { focusPerson?: (id: string) => void; focusRequest?: { id: string; request: number } | null; people: OrganizationPerson[]; ceoAvatar: AgentAvatarProfile | null; savePosition: (id: string, position: OfficePosition) => Promise<void> };

export function normalizeOrganization(value: unknown): OfficeOrganization {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, raw]) => {
    if (!id.trim() || id.length > 160 || ["__proto__", "constructor", "prototype"].includes(id) || !raw || typeof raw !== "object") return [];
    const position = raw as Record<string, unknown>;
    return [[id, { title: typeof position.title === "string" ? position.title.trim().slice(0, 80) || "Worker" : "Worker",
      reportsTo: Array.isArray(position.reportsTo) ? [...new Set(position.reportsTo.filter((parent): parent is string => typeof parent === "string" && !!parent.trim() && parent.length <= 160))] : [] }]];
  }));
}

export function assertReportingStructure(organization: OfficeOrganization) {
  if (organization[CEO_ID]?.reportsTo.length) throw new Error("The CEO has no reporting manager.");
  for (const [id, position] of Object.entries(organization)) if (id !== CEO_ID && !position.reportsTo.length) throw new Error("Choose at least one manager.");
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error("Reporting relationships cannot contain a cycle.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parent of organization[id]?.reportsTo || []) visit(parent);
    visiting.delete(id); visited.add(id);
  };
  Object.keys(organization).forEach(visit);
}

export function mergeOrganization(current: OfficeOrganization = {}, patch: Record<string, OfficePosition | null> | null): OfficeOrganization {
  const next = patch === null ? {} : { ...current, ...normalizeOrganization(patch) };
  for (const [id, value] of Object.entries(patch || {})) if (value === null) delete next[id];
  assertReportingStructure(next);
  return next;
}

// Project membership stays in the existing roster. Only titles and upward edges are stored here.
export function reconcileOrganization(current: OfficeOrganization, roster: CompanyRoster, preferredHeads: Record<string, string> = {}): OfficeOrganization {
  const ids = new Set([CEO_ID, ...roster.members.map(member => member.id)]);
  const next = Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id)).map(([id, position]) =>
    [id, { ...position, reportsTo: position.reportsTo.filter(parent => ids.has(parent)) }]));
  next[CEO_ID] ||= { title: "CEO", reportsTo: [] };
  const departments = new Map<string, string[]>();
  for (const member of roster.members) {
    const department = member.projectId || OPEN_DEPARTMENT_ID;
    departments.set(department, [...(departments.get(department) || []), member.id]);
  }
  for (const [department, members] of departments) {
    const preferred = preferredHeads[department];
    const head = members.includes(preferred) ? preferred : members.find(id => next[id]?.reportsTo.includes(CEO_ID)) || members[0];
    if (!next[head] || !next[head].reportsTo.includes(CEO_ID) || head === preferred) next[head] = { title: "Head", reportsTo: [CEO_ID] };
    for (const id of members) {
      next[id] ||= { title: "Worker", reportsTo: [head] };
      if (preferred && id !== head && next[id].reportsTo.includes(CEO_ID)) next[id] = { title: "Worker", reportsTo: [head] };
      if (id !== head && !next[id].reportsTo.length) next[id] = { ...next[id], reportsTo: [head] };
    }
  }
  assertReportingStructure(next);
  return next;
}

export function organizationPeople(organization: OfficeOrganization, roster: CompanyRoster, names: ReadonlyMap<string, string>): OrganizationPerson[] {
  return [{ id: CEO_ID, name: "CEO", department: "Company", departmentId: null, ...(organization[CEO_ID] || { title: "CEO", reportsTo: [] }) },
    ...roster.members.map(member => ({ ...member, name: names.get(member.id) || member.id,
      department: roster.projects.find(project => project.id === member.projectId)?.name || "Open Workspace",
      departmentId: member.projectId, ...(organization[member.id] || { title: "Worker", reportsTo: [] }) }))];
}
