import { OPEN_DEPARTMENT_ID, type OrganizationPerson } from "./organization";
export type DepartmentDescriptions = Record<string, string>;
export type OrganizationDepartment = { id: string; name: string; description: string; heads: OrganizationPerson[]; members: OrganizationPerson[] };
export { MAX_DEPARTMENT_DESCRIPTION, normalizeDepartmentDescriptions, mergeDepartmentDescriptions, organizationDepartments } from "./department-structure";

// Compact button text only; department IDs and canonical names stay unchanged.
export function departmentButtonLabel(id: string | null | undefined, name: string): string {
  return !id || id === OPEN_DEPARTMENT_ID ? "OW" : name === "Strategic Intelligence" ? "Strat Intel" : name;
}
