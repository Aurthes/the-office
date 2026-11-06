"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */
// Shared by the scene and gateway: one reporting graph and one reconciliation rule.
const { ceo: CEO_ID, legacyCeo: LEGACY_CEO_ID } = require("./identities.json");
const OPEN_DEPARTMENT_ID = "open-workspace";

/** @param {import("./organization").OfficePosition} [position] */
const isDepartmentManager = (position) => /^(head|manager|主管|经理|部门经理)$/i.test(position?.title.trim() || "");

/** @param {unknown} value @returns {import("./organization").OfficeOrganization} */
function normalizeOrganization(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, raw]) => {
    if (!id.trim() || id.length > 160 || ["__proto__", "constructor", "prototype"].includes(id) || !raw || typeof raw !== "object") return [];
    const canonicalRoot = value[CEO_ID];
    if (id === LEGACY_CEO_ID && canonicalRoot && typeof canonicalRoot === "object" && !Array.isArray(canonicalRoot)) return [];
    const position = raw;
    return [[id === LEGACY_CEO_ID ? CEO_ID : id, { title: typeof position.title === "string" ? position.title.trim().slice(0, 80) || "Worker" : "Worker",
      ...(["self", "auto", "prefer", null].includes(position.delegationMode) ? { delegationMode: position.delegationMode } : {}),
      reportsTo: Array.isArray(position.reportsTo) ? [...new Set(position.reportsTo.filter((parent) => typeof parent === "string" && !!parent.trim() && parent.length <= 160).map(parent => parent === LEGACY_CEO_ID ? CEO_ID : parent))] : [] }]];
  }));
}

/** @param {import("./organization").OfficeOrganization} organization */
function assertReportingStructure(organization) {
  if (organization[CEO_ID]?.reportsTo.length) throw new Error("The CEO has no reporting manager.");
  for (const [id, position] of Object.entries(organization)) if (id !== CEO_ID && !position.reportsTo.length) throw new Error("Choose at least one manager.");
  const visiting = new Set(), visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new Error("Reporting relationships cannot contain a cycle.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parent of organization[id]?.reportsTo || []) visit(parent);
    visiting.delete(id); visited.add(id);
  };
  Object.keys(organization).forEach(visit);
}

/** @param {import("./organization").OfficeOrganization} current @param {Record<string, import("./organization").OfficePosition | null> | null} patch @returns {import("./organization").OfficeOrganization} */
function mergeOrganization(current = {}, patch) {
  const normalizedPatch = normalizeOrganization(patch);
  // Older tabs know only title/reportsTo; their edits must not reset workflow.
  for (const [id, position] of Object.entries(normalizedPatch)) {
    const raw = patch?.[id] || patch?.[id === CEO_ID ? LEGACY_CEO_ID : id];
    if (raw && !Object.hasOwn(raw, "delegationMode") && current[id]?.delegationMode !== undefined) position.delegationMode = current[id].delegationMode;
  }
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
/** @param {import("./organization").OfficeOrganization} current @param {import("../../features/retro-office/core/companyLayout").CompanyRoster} roster @param {Record<string, string>} [preferredHeads] @returns {import("./organization").OfficeOrganization} */
function reconcileOrganization(current, roster, preferredHeads = {}) {
  current = normalizeOrganization(current);
  const ids = new Set([CEO_ID, ...roster.members.map(member => member.id)]);
  const resolved = new Map();
  const survivingManagers = (id, path = new Set()) => {
    if (ids.has(id)) return [id];
    if (resolved.has(id)) return resolved.get(id);
    if (path.has(id)) throw new Error("Reporting relationships cannot contain a cycle.");
    const parents = [...new Set((current[id]?.reportsTo || []).flatMap(parent => survivingManagers(parent, new Set([...path, id]))))];
    const result = parents.length ? parents : [CEO_ID]; resolved.set(id, result); return result;
  };
  const next = Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id)).map(([id, position]) =>
    [id, { ...position, reportsTo: [...new Set(position.reportsTo.flatMap(parent => survivingManagers(parent)))] }]));
  next[CEO_ID] ||= { title: "CEO", reportsTo: [] };
  const departments = new Map();
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

/** @param {string} id @param {import("./organization").OfficePosition} position @param {boolean} hasReports @returns {import("./organization").DelegationMode} */
function delegationMode(id, position, hasReports) {
  return position.delegationMode || (id === CEO_ID ? "prefer" : hasReports || isDepartmentManager(position) ? "auto" : "self");
}
module.exports = { isDepartmentManager, normalizeOrganization, assertReportingStructure, mergeOrganization, reconcileOrganization, delegationMode };
