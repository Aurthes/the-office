"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */
const { ceo: CEO_ID } = require("./identities.json");
const { isDepartmentManager } = require("./organization-structure");
const OPEN_DEPARTMENT_ID = "open-workspace";
const MAX_DEPARTMENT_DESCRIPTION = 4000;
const safeKey = id => typeof id === "string" && !!id.trim() && id.length <= 160 && !["__proto__", "constructor", "prototype"].includes(id);
const record = value => !!value && typeof value === "object" && !Array.isArray(value);

/** @param {unknown} value @returns {Record<string, string>} */
function normalizeDepartmentDescriptions(value) {
  if (!record(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, text]) => safeKey(id) && typeof text === "string" && !!text.trim())
    .map(([id, text]) => [id, text.trim().slice(0, MAX_DEPARTMENT_DESCRIPTION)]));
}

/** @param {unknown} current @param {unknown} patch @returns {Record<string, string>} */
function mergeDepartmentDescriptions(current, patch) {
  if (patch === null) return {};
  const next = normalizeDepartmentDescriptions(current);
  if (patch === undefined) return next;
  if (!record(patch)) throw new Error("Department descriptions must be an object.");
  for (const [id, text] of Object.entries(patch)) {
    if (!safeKey(id) || text !== null && (typeof text !== "string" || text.length > MAX_DEPARTMENT_DESCRIPTION)) throw new Error("Choose a valid department and a description of at most 4000 characters.");
    if (text === null || !text.trim()) delete next[id];
    else next[id] = text.trim();
  }
  return next;
}

/**
 * A view of current membership/reporting edges, never another stored roster.
 * @param {readonly {id: string, name: string}[]} projects
 * @param {readonly import("./organization").OrganizationPerson[]} people
 * @param {unknown} descriptions
 * @returns {import("./departments").OrganizationDepartment[]}
 */
function organizationDepartments(projects, people, descriptions = {}) {
  const text = normalizeDepartmentDescriptions(descriptions);
  const departments = new Map(projects.filter(p => safeKey(p.id)).map(p => [p.id, { id: p.id, name: p.name, description: Object.hasOwn(text, p.id) ? text[p.id] : "", heads: [], members: [] }]));
  if (!departments.has(OPEN_DEPARTMENT_ID)) departments.set(OPEN_DEPARTMENT_ID, { id: OPEN_DEPARTMENT_ID, name: "Open Workspace", description: text[OPEN_DEPARTMENT_ID] || "", heads: [], members: [] });
  const byId = new Map(people.map(p => [p.id, p]));
  const referenced = new Set(people.flatMap(p => p.reportsTo));
  for (const person of people) {
    if (person.id === CEO_ID) continue;
    const department = departments.get(person.departmentId) || departments.get(OPEN_DEPARTMENT_ID);
    department.members.push(person);
  }
  for (const department of departments.values()) {
    const members = new Set(department.members.map(p => p.id));
    const managers = department.members.filter(p => isDepartmentManager(p) || referenced.has(p.id));
    const candidates = new Set(managers.map(p => p.id));
    const hasDepartmentManager = (person, seen = new Set()) => person.reportsTo.some(id => {
      if (seen.has(id) || id === CEO_ID) return false;
      seen.add(id);
      return candidates.has(id) || (byId.has(id) && members.has(id) && hasDepartmentManager(byId.get(id), seen));
    });
    department.heads = managers.filter(p => !hasDepartmentManager(p));
    // One manager may own several departments. Derive external managers from
    // existing reporting edges only; the CEO is not a replacement department Head.
    if (!department.heads.length) {
      const external = new Set();
      for (const person of department.members) for (const id of person.reportsTo) if (id !== CEO_ID && !members.has(id) && byId.has(id)) external.add(id);
      department.heads = [...external].map(id => byId.get(id));
    }
  }
  return [...departments.values()];
}

module.exports = { OPEN_DEPARTMENT_ID, MAX_DEPARTMENT_DESCRIPTION, normalizeDepartmentDescriptions, mergeDepartmentDescriptions, organizationDepartments };
