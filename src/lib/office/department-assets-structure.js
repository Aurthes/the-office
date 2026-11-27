"use strict";
const ASSET_KINDS = ["guideline", "workflow", "tool"];
const ASSET_STATUSES = ["active", "draft", "deprecated"];
const ASSET_LIMITS = { name: 120, summary: 240, instructions: 16000, source: 2000, version: 120 };
const record = value => !!value && typeof value === "object" && !Array.isArray(value);
const safeKey = id => typeof id === "string" && !!id.trim() && id === id.trim() && id.length <= 160 && !["__proto__", "constructor", "prototype"].includes(id);
/** @param {unknown} value @returns {import("./department-assets").DepartmentAsset} */
function asset(value) {
  if (!record(value) || !ASSET_KINDS.includes(value.kind) || !ASSET_STATUSES.includes(value.status)) throw new Error("Choose a valid asset type and status.");
  const fields = Object.fromEntries(Object.entries(ASSET_LIMITS).map(([key, max]) => {
    if (typeof value[key] !== "string" || !value[key].trim() || value[key].length > max) throw new Error(`Asset ${key} must contain 1–${max} characters.`);
    return [key, value[key].trim()];
  }));
  return { kind: value.kind, status: value.status, ...fields };
}
/** @param {unknown} value @returns {import("./department-assets").DepartmentAssets} */
function normalizeDepartmentAssets(value) {
  if (!record(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, entries]) => safeKey(id) && record(entries)).map(([id, entries]) => [id,
    Object.fromEntries(Object.entries(entries).flatMap(([key, value]) => { if (!safeKey(key)) return []; try { return [[key, asset(value)]]; } catch { return []; } })),
  ]));
}
/** @param {unknown} current @param {unknown} patch @returns {import("./department-assets").DepartmentAssets} */
function mergeDepartmentAssets(current, patch) {
  const next = normalizeDepartmentAssets(current);
  if (patch === undefined) return next;
  if (!record(patch)) throw new Error("Department assets must be an object of entry patches.");
  for (const [id, entries] of Object.entries(patch)) {
    if (!safeKey(id) || !record(entries)) throw new Error("Choose a valid department and asset entries.");
    const department = { ...next[id] };
    for (const [key, value] of Object.entries(entries)) {
      if (!safeKey(key)) throw new Error("Choose a valid asset ID.");
      if (value === null) delete department[key]; else department[key] = asset(value);
    }
    next[id] = department;
  }
  return next;
}
/** Preserve entry-level tombstones while coalescing pending settings patches.
 * @param {import("./department-assets").DepartmentAssetPatch | undefined} current
 * @param {import("./department-assets").DepartmentAssetPatch} patch
 * @returns {import("./department-assets").DepartmentAssetPatch}
 */
function mergeDepartmentAssetPatches(current, patch) {
  if (!record(patch)) throw new Error("Department assets must be an object of entry patches.");
  const next = { ...current };
  for (const [id, entries] of Object.entries(patch)) {
    if (!safeKey(id) || !record(entries)) throw new Error("Choose a valid department and asset entries.");
    next[id] = { ...next[id], ...entries };
  }
  return next;
}
function assetSummary([id, { kind, name, summary, status, version }]) { return { id, kind, name, summary, status, version }; }
/** Default context is an index, never a document or command. */
function departmentAssetIndex(registry, departmentId) {
  const rows = Object.entries(registry[departmentId] || {}).sort(([a], [b]) => a.localeCompare(b));
  return { tool: "office_tasks.todo_department_assets", departmentId, total: rows.length,
    counts: Object.fromEntries(ASSET_KINDS.map(kind => [kind, rows.filter(([, entry]) => entry.kind === kind).length])),
    entries: rows.slice(0, 5).map(([id, { kind, name, status, version }]) => ({ id, kind, name, status, version })), more: Math.max(0, rows.length - 5) };
}
function readAssets(entries, { assetId, kind, query = "", offset = 0, limit = 25 }) {
  if(assetId!==undefined&&!safeKey(assetId))throw new Error("Choose a valid asset ID.");
  if (assetId !== undefined) {
    if (!Object.hasOwn(entries, assetId)) throw new Error("Asset not found.");
    return { assetId, entry: entries[assetId] };
  }
  if (kind !== undefined && !ASSET_KINDS.includes(kind) || typeof query !== "string" || query.length > 240 || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error("Choose a valid asset filter and page (1–25 entries).");
  const needle = query.trim().toLowerCase();
  const rows = Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)).filter(([id, a]) => (!kind || a.kind === kind) && (!needle || [id, a.name, a.summary].some(text => text.toLowerCase().includes(needle))));
  return { entries: rows.slice(offset, offset + limit).map(assetSummary), total: rows.length, offset, limit };
}
function readDepartmentAssets(registry,input) {
  if(!safeKey(input.departmentId))throw new Error("Choose a valid department and asset ID.");
  return {departmentId:input.departmentId,...readAssets(registry[input.departmentId]||{},input)};
}
function normalizeCompanyTools(value) {
  if(!record(value))return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id,value])=>{if(!safeKey(id))return [];try{const tool=asset(value);return tool.kind==='tool'?[[id,tool]]:[];}catch{return [];}}));
}
function mergeCompanyTools(current,patch) {
  const next=normalizeCompanyTools(current);
  if(patch===undefined)return next;
  if(!record(patch))throw new Error("Company tools must be an object of entry patches.");
  for(const [id,value] of Object.entries(patch)) {
    if(!safeKey(id))throw new Error("Choose a valid asset ID.");
    if(value===null)delete next[id];else {const tool=asset(value);if(tool.kind!=='tool')throw new Error("Company entries must be tools.");next[id]=tool;}
  }
  return next;
}
function mergeCompanyToolPatches(current,patch) {
  if(!record(patch)||Object.keys(patch).some(id=>!safeKey(id)))throw new Error("Choose valid company tool entry patches.");
  return {...current,...patch};
}
function readCompanyTools(registry,input) {return readAssets(registry,{...input,kind:'tool'});}
function companyToolIndex(registry) {
  const rows=Object.entries(registry).sort(([a],[b])=>a.localeCompare(b));
  return {tool:"office_tasks.todo_company_tools",total:rows.length,entries:rows.slice(0,5).map(([id,{name,status,version}])=>({id,name,status,version})),more:Math.max(0,rows.length-5)};
}

module.exports = { normalizeCompanyTools, mergeCompanyTools, mergeCompanyToolPatches, readCompanyTools, companyToolIndex, ASSET_KINDS, ASSET_STATUSES, ASSET_LIMITS, normalizeDepartmentAssets, mergeDepartmentAssets, mergeDepartmentAssetPatches, departmentAssetIndex, readDepartmentAssets };
