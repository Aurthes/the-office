import { describe, expect, it, vi } from "vitest";
import { CEO_ID, type OrganizationPerson } from "@/lib/office/organization";
import { normalizeDepartmentDescriptions, mergeDepartmentDescriptions, organizationDepartments } from "@/lib/office/departments";
import { defaultStudioSettings, mergeStudioSettings, normalizeStudioSettings, sanitizeStudioSettings, type StudioSettingsPatch } from "@/lib/studio/settings";
import { StudioSettingsCoordinator } from "@/lib/studio/coordinator";

const gateway = "ws://office";
const person = (id: string, departmentId: string | null, title = "Worker", reportsTo = [CEO_ID]): OrganizationPerson => ({ id, name: id, departmentId, department: departmentId || "Open Workspace", title, reportsTo });
const projects = [{ id: "a", name: "Research" }, { id: "b", name: "Research" }, { id: "empty", name: "Empty" }];

describe("shared department projection", () => {
  it("keeps empty and identically named departments by ID, references live people and excludes the CEO from Open Workspace", () => {
    const head = person("h", "a", "Head"), member = person("w", "a", "Engineer", ["h"]), orphan = person("orphan", "gone"), ceo = person(CEO_ID, null, "CEO", []);
    const departments = organizationDepartments(projects, [ceo, head, member, orphan], { a: "Research scope" });
    expect(departments.map(d => d.id)).toEqual(["a", "b", "empty", "open-workspace"]);
    expect(departments[0].heads).toEqual([head]); expect(departments[0].members[1]).toBe(member);
    expect(departments[0].description).toBe("Research scope");
    expect(departments[1].members).toEqual([]); expect(departments[2].heads).toEqual([]);
    expect(departments[3].members).toEqual([orphan]); expect(departments[3].members.some(p => p.id === CEO_ID)).toBe(false);
    expect(organizationDepartments(projects, [ceo, { ...member, reportsTo: [CEO_ID] }])[0].heads).toEqual([]);
  });
  it("uses the current reporting graph, including an existing Head managing another department", () => {
    const h = person("h", "a", "Manager"), nested = person("nested", "a", "Head", ["h"]), w = person("w", "b", "Worker", ["h"]);
    const result = organizationDepartments(projects, [h, nested, w]);
    expect(result[0].heads).toEqual([h]); expect(result[1].heads).toEqual([h]);
    expect(result[1].members).toEqual([w]); expect(w.title).toBe("Worker");
    expect(organizationDepartments(projects, [{ ...w, reportsTo: [CEO_ID] }])[1].heads).toEqual([]);
    expect(organizationDepartments([{ id: "toString", name: "Odd ID" }], [])[0].description).toBe("");
  });
});

describe("department settings", () => {
  it("normalizes persisted data and rejects invalid patches without accepting prototype keys", () => {
    expect(normalizeDepartmentDescriptions(JSON.parse('{"a":"  scope  ","bad":7,"__proto__":"x"}'))).toEqual({ a: "scope" });
    expect(mergeDepartmentDescriptions({ a: "old", b: "keep" }, { a: "new" })).toEqual({ a: "new", b: "keep" });
    expect(mergeDepartmentDescriptions({ a: "old", b: "keep" }, { a: "" })).toEqual({ b: "keep" });
    expect(mergeDepartmentDescriptions({ a: "old" }, null)).toEqual({});
    for (const patch of [JSON.parse('{"__proto__":"x"}'), { a: 1 }, { a: "x".repeat(4001) }, []]) expect(() => mergeDepartmentDescriptions({}, patch)).toThrow();
  });
  it("roundtrips public settings and saves or removes only the specified department", () => {
    let state = mergeStudioSettings(defaultStudioSettings(), { office: { [gateway]: { title: "A company", departmentDescriptions: { a: "One", b: "Two" } } } });
    state = normalizeStudioSettings(JSON.parse(JSON.stringify(state)));
    state = mergeStudioSettings(state, { office: { [gateway]: { departmentDescriptions: { a: "Changed" } } } });
    expect(sanitizeStudioSettings(state).office[gateway].departmentDescriptions).toEqual({ a: "Changed", b: "Two" });
    expect(state.office[gateway].title).toBe("A company");
    state = mergeStudioSettings(state, { office: { [gateway]: { departmentDescriptions: { a: null } } } });
    expect(state.office[gateway].departmentDescriptions).toEqual({ b: "Two" });
    state = mergeStudioSettings(state, { office: { [gateway]: { departmentDescriptions: null } } });
    expect(state.office[gateway].departmentDescriptions).toEqual({});
  });
  it("coalesces concurrent per-department edits without overwriting other entries", async () => {
    let state = mergeStudioSettings(defaultStudioSettings(), { office: { [gateway]: { departmentDescriptions: { a: "old", b: "old", keep: "untouched" } } } });
    const updateSettings = vi.fn(async (patch: StudioSettingsPatch) => { state = mergeStudioSettings(state, patch); return { settings: sanitizeStudioSettings(state) }; });
    const coordinator = new StudioSettingsCoordinator({ fetchSettings: async () => ({ settings: sanitizeStudioSettings(state) }), updateSettings }, 60000);
    coordinator.schedulePatch({ office: { [gateway]: { departmentDescriptions: { a: "one" } } } });
    coordinator.schedulePatch({ office: { [gateway]: { departmentDescriptions: { b: "two" } } } });
    await coordinator.flushPending();
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(state.office[gateway].departmentDescriptions).toEqual({ a: "one", b: "two", keep: "untouched" });
    coordinator.schedulePatch({ office: { [gateway]: { departmentDescriptions: null } } });
    coordinator.schedulePatch({ office: { [gateway]: { departmentDescriptions: { a: "after reset" } } } });
    await coordinator.flushPending();
    expect(state.office[gateway].departmentDescriptions).toEqual({ a: "after reset" });
    coordinator.dispose();
  });
});
