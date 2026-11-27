export type DepartmentAsset = { kind: "guideline" | "workflow" | "tool"; name: string; summary: string; instructions: string; source: string; version: string; status: "active" | "draft" | "deprecated" };
export type DepartmentAssets = Record<string, Record<string, DepartmentAsset>>;
export type DepartmentAssetPatch = Record<string, Record<string, DepartmentAsset | null>>;
export type CompanyTools = Record<string, DepartmentAsset>;
export type CompanyToolPatch = Record<string, DepartmentAsset | null>;
export { normalizeCompanyTools, mergeCompanyTools, mergeCompanyToolPatches, ASSET_KINDS, ASSET_STATUSES, ASSET_LIMITS, normalizeDepartmentAssets, mergeDepartmentAssets, mergeDepartmentAssetPatches } from "./department-assets-structure";
