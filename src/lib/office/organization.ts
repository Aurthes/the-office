import type { CompanyRoster } from "@/features/retro-office/core/companyLayout";
import type { AgentAvatarProfile } from "@/lib/avatars/profile";
import identities from "./identities.json";

export const CEO_ID = identities.ceo;
export const LEGACY_CEO_ID = identities.legacyCeo;
export const OPEN_DEPARTMENT_ID = "open-workspace";
export type OfficePosition = { title: string; reportsTo: string[] };
export type OfficeOrganization = Record<string, OfficePosition>;
export type OrganizationPerson = OfficePosition & { id: string; name: string; department: string; departmentId: string | null };
export type OrganizationView = { focusPerson?: (id: string) => void; focusRequest?: { id: string; request: number } | null; people: OrganizationPerson[]; ceoAvatar: AgentAvatarProfile | null; savePosition: (id: string, position: OfficePosition) => Promise<void> };

export const isDepartmentManager = (position?: OfficePosition) => /^(head|manager|主管|经理|部门经理)$/i.test(position?.title.trim() || "");

export function normalizeOrganization(value: unknown): OfficeOrganization {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, raw]) => {
    if (!id.trim() || id.length > 160 || ["__proto__", "constructor", "prototype"].includes(id) || !raw || typeof raw !== "object") return [];
    const canonicalRoot = (value as Record<string, unknown>)[CEO_ID];
    if (id === LEGACY_CEO_ID && canonicalRoot && typeof canonicalRoot === "object" && !Array.isArray(canonicalRoot)) return [];
    const position = raw as Record<string, unknown>;
    return [[id === LEGACY_CEO_ID ? CEO_ID : id, { title: typeof position.title === "string" ? position.title.trim().slice(0, 80) || "Worker" : "Worker",
      reportsTo: Array.isArray(position.reportsTo) ? [...new Set(position.reportsTo.filter((parent): parent is string => typeof parent === "string" && !!parent.trim() && parent.length <= 160).map(parent => parent === LEGACY_CEO_ID ? CEO_ID : parent))] : [] }]];
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
  const normalizedPatch = normalizeOrganization(patch);
  const next = patch === null ? {} : { ...normalizeOrganization(current), ...normalizedPatch };
  for (const [id, value] of Object.entries(patch || {})) if (value === null) {
    // Old tabs can remove an unfamiliar UUID while providing the same root
    // under its old NPC key. That is an alias update, not a root deletion.
    if (id === LEGACY_CEO_ID || id === CEO_ID && normalizedPatch[CEO_ID]) continue;
    delete next[id];
  }
  assertReportingStructure(next);
  return next;
}

// Project membership stays in the existing roster. Only titles and upward edges are stored here.
export function reconcileOrganization(current: OfficeOrganization, roster: CompanyRoster, preferredHeads: Record<string, string> = {}): OfficeOrganization {
  current = normalizeOrganization(current);
  const ids = new Set([CEO_ID, ...roster.members.map(member => member.id)]);
  const resolved = new Map<string, string[]>();
  const survivingManagers = (id: string, path = new Set<string>()): string[] => {
    if (ids.has(id)) return [id];
    if (resolved.has(id)) return resolved.get(id)!;
    if (path.has(id)) throw new Error("Reporting relationships cannot contain a cycle.");
    const parents = [...new Set((current[id]?.reportsTo || []).flatMap(parent => survivingManagers(parent, new Set([...path, id]))))];
    const result = parents.length ? parents : [CEO_ID]; resolved.set(id, result); return result;
  };
  const next = Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id)).map(([id, position]) =>
    [id, { ...position, reportsTo: [...new Set(position.reportsTo.flatMap(parent => survivingManagers(parent)))] }]));
  next[CEO_ID] ||= { title: "CEO", reportsTo: [] };
  const departments = new Map<string, string[]>();
  for (const member of roster.members) {
    if (member.id === CEO_ID) continue;
    const department = member.projectId || OPEN_DEPARTMENT_ID;
    departments.set(department, [...(departments.get(department) || []), member.id]);
  }
  for (const [department, members] of departments) {
    const preferred = preferredHeads[department];
    const peers = new Set(members), referenced = new Set(members.flatMap(id => next[id]?.reportsTo || []));
    const managers = members.filter(id => next[id] && (isDepartmentManager(next[id]) || referenced.has(id)));
    const existingHead = managers.find(id => !next[id].reportsTo.some(parent => peers.has(parent))) || managers[0];
    // Bootstrap a new department once. An archive must never elect a replacement.
    const head = members.includes(preferred) ? preferred : existingHead || (members.some(id => !!current[id]) ? undefined : members[0]);
    if (head && (!next[head] || head === preferred)) next[head] = { title: "Head", reportsTo: [CEO_ID] };
    for (const id of members) {
      next[id] ||= { title: "Worker", reportsTo: [head || CEO_ID] };
      if (head && preferred && id !== head && next[id].reportsTo.includes(CEO_ID)) next[id] = { title: "Worker", reportsTo: [head] };
      if (id !== CEO_ID && !next[id].reportsTo.length) next[id] = { ...next[id], reportsTo: [CEO_ID] };
    }
  }
  assertReportingStructure(next);
  return next;
}

export function updateOrganizationPosition(current: OfficeOrganization, roster: CompanyRoster, id: string, position: OfficePosition): OfficeOrganization {
  const ids = new Set([CEO_ID, ...roster.members.map(member => member.id)]);
  if (!ids.has(id) || !position.title.trim() || position.reportsTo.some(parent => !ids.has(parent))) throw new Error("Choose an existing person and a title.");
  const next = reconcileOrganization(current, roster), promoted = id !== CEO_ID && !isDepartmentManager(next[id]) && isDepartmentManager(position);
  next[id] = { title: position.title.trim(), reportsTo: [...new Set(position.reportsTo)] };
  if (promoted) {
    const department = roster.members.find(member => member.id === id)!.projectId || OPEN_DEPARTMENT_ID;
    const upstream = new Set(next[id].reportsTo);
    for (const member of roster.members) {
      if (member.id === id || (member.projectId || OPEN_DEPARTMENT_ID) !== department || isDepartmentManager(next[member.id])) continue;
      const peer = next[member.id];
      // Insert the new manager under the selected upstream managers. Preserve
      // other reporting lines and the hierarchies beneath the affected peers.
      peer.reportsTo = [...new Set(peer.reportsTo.map(parent => upstream.has(parent) ? id : parent))];
    }
  }
  assertReportingStructure(next); return next;
}

export function organizationPatch(current: OfficeOrganization, next: OfficeOrganization): Record<string, OfficePosition | null> {
  return Object.fromEntries([...new Set([...Object.keys(current), ...Object.keys(next)])]
    .filter(id => JSON.stringify(current[id]) !== JSON.stringify(next[id])).map(id => [id, next[id] || null]));
}

export function organizationPeople(organization: OfficeOrganization, roster: CompanyRoster, names: ReadonlyMap<string, string>): OrganizationPerson[] {
  return [{ id: CEO_ID, name: names.get(CEO_ID) || "CEO", department: "Company", departmentId: null, ...(organization[CEO_ID] || { title: "CEO", reportsTo: [] }) },
    ...roster.members.filter(member => member.id !== CEO_ID).map(member => ({ ...member, name: names.get(member.id) || member.id,
      department: roster.projects.find(project => project.id === member.projectId)?.name || "Open Workspace",
      departmentId: member.projectId, ...(organization[member.id] || { title: "Worker", reportsTo: [] }) }))];
}
