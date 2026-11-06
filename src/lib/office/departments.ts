import type { OrganizationPerson } from "./organization";
export type DepartmentDescriptions = Record<string, string>;
export type OrganizationDepartment = { id: string; name: string; description: string; heads: OrganizationPerson[]; members: OrganizationPerson[] };
export { MAX_DEPARTMENT_DESCRIPTION, normalizeDepartmentDescriptions, mergeDepartmentDescriptions, organizationDepartments } from "./department-structure";
