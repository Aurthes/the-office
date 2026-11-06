import type { CompanyRoster } from "@/features/retro-office/core/companyLayout";
import type { AgentAvatarProfile } from "@/lib/avatars/profile";
import { isDepartmentManager, reconcileOrganization, assertReportingStructure } from "./organization-structure";
import identities from "./identities.json";
import type { OrganizationDepartment } from "./departments";

export const CEO_ID = identities.ceo;
export const LEGACY_CEO_ID = identities.legacyCeo;
export const OPEN_DEPARTMENT_ID = "open-workspace";
export type DelegationMode = "self" | "auto" | "prefer";
export type OfficePosition = { title: string; reportsTo: string[]; delegationMode?: DelegationMode | null };
export type OfficeOrganization = Record<string, OfficePosition>;
export type OrganizationPerson = OfficePosition & { id: string; name: string; department: string; departmentId: string | null };
export type OrganizationView = { departments?: OrganizationDepartment[]; openDepartment?: (id?: string) => void; saveDepartmentDescription?: (id: string, description: string) => Promise<void>; focusPerson?: (id: string) => void; focusRequest?: { id: string; request: number } | null; people: OrganizationPerson[]; ceoAvatar: AgentAvatarProfile | null; savePosition: (id: string, position: OfficePosition) => Promise<void> };

export { isDepartmentManager, normalizeOrganization, assertReportingStructure, mergeOrganization, reconcileOrganization, delegationMode } from "./organization-structure";

export function updateOrganizationPosition(current: OfficeOrganization, roster: CompanyRoster, id: string, position: OfficePosition): OfficeOrganization {
  const ids = new Set([CEO_ID, ...roster.members.map(member => member.id)]);
  if (!ids.has(id) || !position.title.trim() || position.reportsTo.some(parent => !ids.has(parent))) throw new Error("Choose an existing person and a title.");
  const next = reconcileOrganization(current, roster), promoted = id !== CEO_ID && !isDepartmentManager(next[id]) && isDepartmentManager(position);
  next[id] = { title: position.title.trim(), reportsTo: [...new Set(position.reportsTo)], ...(next[id]?.delegationMode !== undefined ? { delegationMode: next[id].delegationMode } : {}), ...(position.delegationMode !== undefined ? { delegationMode: position.delegationMode } : {}) };
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
