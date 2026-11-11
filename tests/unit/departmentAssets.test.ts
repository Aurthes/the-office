import { describe, expect, it } from "vitest";
import { normalizeDepartmentAssets, mergeDepartmentAssets, mergeDepartmentAssetPatches, type DepartmentAsset } from "@/lib/office/department-assets";
import { defaultStudioSettings, mergeStudioSettings, sanitizeStudioSettings } from "@/lib/studio/settings";
import { StudioSettingsCoordinator } from "@/lib/studio/coordinator";
const asset: DepartmentAsset = { kind: "tool", name: "Existing checker", summary: "Use for a bounded health question", instructions: "Read only.\n```sh\nexample --output /new/report\n```", source: "https://example.com/code", version: "v1", status: "active" };
const key = "ws://localhost:18790";
describe("department-owned assets", () => {
  it("roundtrips through settings/public projection and survives old clients' unrelated changes", () => {
    const settings = mergeStudioSettings(defaultStudioSettings(), { office: { [key]: { departmentAssets: { dept: { checker: asset } } } } });
    const edited = mergeStudioSettings(settings, { office: { [key]: { title: "New name", organization: { worker: { title: "Dev", reportsTo: ["head"] } } } } });
    expect(edited.office[key].departmentAssets).toEqual({ dept: { checker: asset } });
    expect(sanitizeStudioSettings(edited).office[key].departmentAssets).toEqual({ dept: { checker: asset } });
    expect(normalizeDepartmentAssets(JSON.parse(JSON.stringify(edited.office[key].departmentAssets)))).toEqual({ dept: { checker: asset } });
  });
  it("merges entries rather than replacing departments, including coordinator tombstones and unrelated fields", async () => {
    const first = { office: { [key]: { title: "Kept", departmentAssets: { dept: { one: asset, obsolete: asset }, other: { third: asset } } } } };
    const second = { office: { [key]: { departmentAssets: { dept: { two: { ...asset, kind: "workflow" as const }, obsolete: null } } } } };
    let patch: Parameters<typeof mergeStudioSettings>[1] = {};
    const coordinator = new StudioSettingsCoordinator({ fetchSettings: async () => ({ settings: sanitizeStudioSettings(defaultStudioSettings()) }), updateSettings: async value => { patch = value; return { settings: sanitizeStudioSettings(mergeStudioSettings(defaultStudioSettings(), value)) }; } }, 60000);
    try { coordinator.schedulePatch(first); coordinator.schedulePatch(second); await coordinator.flushPending(); } finally { coordinator.dispose(); }
    expect(patch.office?.[key]?.departmentAssets?.dept).toEqual({ one: asset, two: { ...asset, kind: "workflow" }, obsolete: null });
    const result = mergeStudioSettings(defaultStudioSettings(), patch).office[key];
    expect(result.title).toBe("Kept"); expect(result.departmentAssets).toEqual({ dept: { one: asset, two: { ...asset, kind: "workflow" } }, other: { third: asset } });
    expect(mergeDepartmentAssetPatches(first.office[key].departmentAssets, second.office[key].departmentAssets).dept.obsolete).toBeNull();
  });
  it("supports rename/edit/deprecation by stable ID and explicit entry deletion only", () => {
    const current = { dept: { stable: asset, other: asset } };
    const next = mergeDepartmentAssets(current, { dept: { stable: { ...asset, name: "Renamed", status: "deprecated" } } });
    expect(next.dept.stable).toMatchObject({ name: "Renamed", status: "deprecated" });expect(next.dept.other).toEqual(asset);
    expect(mergeDepartmentAssets(next, { dept: { stable: null } }).dept).toEqual({ other: asset });expect(current.dept.stable.name).toBe(asset.name);
  });
  it.each([null, [], { dept: null }, JSON.parse('{"__proto__":{}}'), { dept: { constructor: asset } }, { dept: { a: { ...asset, kind: "run" } } }, { dept: { a: { ...asset, source: null } } }, { dept: { a: { ...asset, name: " " } } }, { dept: { a: { ...asset, instructions: "x".repeat(16001) } } }]) ("rejects invalid writes atomically", patch => {
    const before = { dept: { stable: asset } };expect(() => mergeDepartmentAssets(before, patch)).toThrow();expect(before).toEqual({ dept: { stable: asset } });
  });
  it("tolerates malformed stored assets without poisoning valid assets or normal roles", () => {
    expect(normalizeDepartmentAssets({ dept: { good: asset, broken: { ...asset, status: "invalid" } }, bad: null })).toEqual({ dept: { good: asset } });
    expect(normalizeDepartmentAssets(null)).toEqual({});
  });
});
