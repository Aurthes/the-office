import { describe, expect, it, vi } from "vitest";
import { CEO_ID, OPEN_DEPARTMENT_ID, assertReportingStructure, reconcileOrganization, organizationPeople } from "@/lib/office/organization";
import { defaultStudioSettings, mergeStudioSettings, normalizeStudioSettings, resolveOfficePreferencePublic, sanitizeStudioSettings, type StudioSettingsPatch } from "@/lib/studio/settings";
import { StudioSettingsCoordinator } from "@/lib/studio/coordinator";

const roster = { projects: [{ id: "office", name: "Office" }, { id: "research", name: "Research" }], members: [
  { id: "worker1", projectId: "office" }, { id: "worker6", projectId: "office" }, { id: "researcher", projectId: "research" },
  { id: "firefighter", projectId: null }, { id: "ranger", projectId: null },
] };
const initial = () => reconcileOrganization({}, roster, { office: "worker6", [OPEN_DEPARTMENT_ID]: "ranger" });

describe("Office organization", () => {
  it("gives every department a head, including Ranger in Open Workspace, without adding a session", () => {
    const org = initial();
    for (const id of ["worker6", "researcher", "ranger"]) expect(org[id]).toEqual({ title: "Head", reportsTo: [CEO_ID] });
    expect(org.worker1).toEqual({ title: "Worker", reportsTo: ["worker6"] });
    expect(org.firefighter).toEqual({ title: "Worker", reportsTo: ["ranger"] });
    expect(org[CEO_ID]).toEqual({ title: "CEO", reportsTo: [] });
    expect(roster.members).toHaveLength(5);
    expect(reconcileOrganization(org, roster)).toEqual(org);
  });
  it("keeps reporting to multiple managers and derives each manager's direct reports", () => {
    const org = initial(); org.worker1 = { title: "Engineer", reportsTo: ["worker6", "researcher"] };
    assertReportingStructure(org);
    const people = organizationPeople(reconcileOrganization(org, roster), roster, new Map());
    expect(people.filter(person => person.reportsTo.includes("researcher")).map(person => person.id)).toEqual(["worker1"]);
    expect(people.find(person => person.id === "ranger")?.department).toBe("Open Workspace");
  });
  it("keeps an elected head when a new worker arrives and replaces an archived head", () => {
    const org = initial(); const expanded = { ...roster, members: [{ id: "new", projectId: "office" }, ...roster.members] };
    expect(reconcileOrganization(org, expanded).new.reportsTo).toEqual(["worker6"]);
    const after = reconcileOrganization(org, { ...roster, members: roster.members.filter(member => member.id !== "worker6") });
    expect(after.worker1).toEqual({ title: "Head", reportsTo: [CEO_ID] });
    expect(after.worker6).toBeUndefined();
  });
  it("rejects self-reporting, indirect cycles and a manager above the CEO", () => {
    const org = initial();
    expect(() => assertReportingStructure({ ...org, worker1: { title: "Worker", reportsTo: ["worker1"] } })).toThrow("cycle");
    expect(() => assertReportingStructure({ ...org, worker6: { title: "Head", reportsTo: ["worker1"] } })).toThrow("cycle");
    expect(() => assertReportingStructure({ ...org, [CEO_ID]: { title: "CEO", reportsTo: ["worker6"] } })).toThrow("CEO");
  });
  it("persists positions through the public settings round trip and merges individual edits", () => {
    const saved = mergeStudioSettings(defaultStudioSettings(), { office: { "ws://127.0.0.1:18790": { organization: initial() } } });
    const loaded = normalizeStudioSettings(JSON.parse(JSON.stringify(saved)));
    const changed = mergeStudioSettings(loaded, { office: { "ws://localhost:18790": { organization: { worker1: { title: "Engineer", reportsTo: ["worker6", "researcher"] } } } } });
    const org = resolveOfficePreferencePublic(sanitizeStudioSettings(changed), "ws://127.0.0.1:18790").organization!;
    expect(org.worker1.reportsTo).toEqual(["worker6", "researcher"]);
    expect(org.ranger.reportsTo).toEqual([CEO_ID]);
    expect(() => mergeStudioSettings(changed, { office: { "ws://localhost:18790": { organization: { worker6: { title: "Head", reportsTo: ["worker1"] } } } } })).toThrow("cycle");
    expect(loaded.office["ws://localhost:18790"].organization?.worker1.title).toBe("Worker");
  });
  it("coalesces separate position edits without dropping either person", async () => {
    const response = { settings: sanitizeStudioSettings(defaultStudioSettings()) }, updateSettings = vi.fn<(patch: StudioSettingsPatch) => Promise<typeof response>>().mockResolvedValue(response);
    const coordinator = new StudioSettingsCoordinator({ fetchSettings: async () => response, updateSettings });
    coordinator.schedulePatch({ office: { gateway: { organization: { a: { title: "Head", reportsTo: [CEO_ID] } } } } }, 10000);
    coordinator.schedulePatch({ office: { gateway: { organization: { b: { title: "Worker", reportsTo: ["a"] } } } } }, 10000);
    await coordinator.flushPending();
    expect(updateSettings.mock.calls[0][0].office?.gateway?.organization).toEqual({ a: { title: "Head", reportsTo: [CEO_ID] }, b: { title: "Worker", reportsTo: ["a"] } });
    coordinator.dispose();
  });
});
