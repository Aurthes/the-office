import { describe, expect, it, vi } from "vitest";
import { CEO_ID, OPEN_DEPARTMENT_ID, assertReportingStructure, reconcileOrganization, organizationPeople, updateOrganizationPosition, organizationPatch } from "@/lib/office/organization";
import { defaultStudioSettings, mergeStudioSettings, normalizeStudioSettings, resolveOfficePreferencePublic, sanitizeStudioSettings, type StudioSettingsPatch } from "@/lib/studio/settings";
import { StudioSettingsCoordinator } from "@/lib/studio/coordinator";

const roster = { projects: [{ id: "office", name: "Office" }, { id: "research", name: "Research" }], members: [
  { id: "worker1", projectId: "office" }, { id: "worker6", projectId: "office" }, { id: "researcher", projectId: "research" },
  { id: "firefighter", projectId: null }, { id: "ranger", projectId: null },
] };
const initial = () => reconcileOrganization({}, roster, { office: "worker6", [OPEN_DEPARTMENT_ID]: "ranger" });

describe("Office organization", () => {
  it("persists work strategy, preserves it across old-client edits and explicitly resets it", () => {
    let settings = mergeStudioSettings(defaultStudioSettings(), { office: { "ws://localhost:18790": { organization: { [CEO_ID]: { title: "CEO", reportsTo: [], delegationMode: "self" } } } } });
    settings = mergeStudioSettings(settings, { office: { "ws://localhost:18790": { organization: { [CEO_ID]: { title: "Owner", reportsTo: [] } } } } });
    expect(resolveOfficePreferencePublic(sanitizeStudioSettings(settings), "ws://localhost:18790").organization?.[CEO_ID].delegationMode).toBe("self");
    settings = mergeStudioSettings(settings, { office: { "ws://localhost:18790": { organization: { [CEO_ID]: { title: "Owner", reportsTo: [], delegationMode: null } } } } });
    expect(resolveOfficePreferencePublic(sanitizeStudioSettings(settings), "ws://localhost:18790").organization?.[CEO_ID].delegationMode).toBeNull();
  });
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
  it("keeps an elected head on recruitment and removes the archived layer without electing a worker", () => {
    const org = initial(); const expanded = { ...roster, members: [{ id: "new", projectId: "office" }, ...roster.members] };
    expect(reconcileOrganization(org, expanded).new.reportsTo).toEqual(["worker6"]);
    const after = reconcileOrganization(org, { ...roster, members: roster.members.filter(member => member.id !== "worker6") });
    expect(after.worker1).toEqual({ title: "Worker", reportsTo: [CEO_ID] });
    expect(after.worker6).toBeUndefined();
    expect(reconcileOrganization(after, { ...roster, members: roster.members.filter(member => member.id !== "worker6") })).toEqual(after);
  });
  it("splices multiple archived layers and managers while preserving titles, children and other lines", () => {
    const org = { [CEO_ID]: { title: "CEO", reportsTo: [] }, upper: { title: "Director", reportsTo: [CEO_ID] },
      removedUpper: { title: "Head", reportsTo: ["upper", CEO_ID] }, removed: { title: "Manager", reportsTo: ["removedUpper", "upper"] },
      worker: { title: "Engineer", reportsTo: ["removed", "upper"] }, child: { title: "Worker", reportsTo: ["worker"] } };
    const r = { projects: [], members: ["upper", "worker", "child"].map(id => ({ id, projectId: null })) };
    const after = reconcileOrganization(org, r);
    expect(after.worker).toEqual({ title: "Engineer", reportsTo: ["upper", CEO_ID] });
    expect(after.child.reportsTo).toEqual(["worker"]); expect(after.upper).toEqual(org.upper);
    expect(org.worker.reportsTo).toEqual(["removed", "upper"]);
    expect(organizationPatch(org, after)).toEqual({ removedUpper: null, removed: null, worker: after.worker });
  });
  it.each(["Head", "Manager", "manager", "经理"])("recreates a flattened department layer on promotion to %s", title => {
    const r = { ...roster, members: roster.members.filter(member => member.id !== "worker6") };
    const flat = reconcileOrganization(initial(), r);
    const hired = { ...r, members: [...r.members, { id: "new-manager", projectId: "office" }] };
    const withHire = reconcileOrganization(flat, hired);
    expect(withHire["new-manager"]).toEqual({ title: "Worker", reportsTo: [CEO_ID] });
    withHire.worker1.reportsTo.push("researcher");
    const after = updateOrganizationPosition(withHire, hired, "new-manager", { title, reportsTo: [CEO_ID] });
    expect(after.worker1).toEqual({ title: "Worker", reportsTo: ["new-manager", "researcher"] });
    expect(after.researcher).toEqual(withHire.researcher); expect(after.ranger).toEqual(withHire.ranger);
    expect(reconcileOrganization(after, hired)).toEqual(after);
    const anotherHire = reconcileOrganization(after, { ...hired, members: [...hired.members, { id: "latest", projectId: "office" }] });
    expect(anotherHire.latest.reportsTo).toEqual(["new-manager"]);
  });
  it("preserves manual reporting exceptions after a manager has already been designated", () => {
    const org = initial(); org.worker1.reportsTo = ["worker6", CEO_ID];
    const unchanged = updateOrganizationPosition(org, roster, "worker6", { title: "Head", reportsTo: [CEO_ID] });
    expect(unchanged.worker1.reportsTo).toEqual(["worker6", CEO_ID]);
    expect(organizationPatch(org, unchanged)).toEqual({});
    const edited = updateOrganizationPosition(org, roster, "worker1", { title: "Engineer", reportsTo: [CEO_ID] });
    expect(edited.worker6).toEqual(org.worker6); expect(edited.ranger).toEqual(org.ranger);
  });
  it("inserts a restored manager below the selected upstream person without flattening descendants", () => {
    const r = { projects: [], members: ["boss", "new", "peer", "child"].map(id => ({ id, projectId: null })) };
    const org = { [CEO_ID]: { title: "CEO", reportsTo: [] }, boss: { title: "Head", reportsTo: [CEO_ID] },
      new: { title: "Worker", reportsTo: ["boss"] }, peer: { title: "Engineer", reportsTo: ["boss"] }, child: { title: "Worker", reportsTo: ["peer"] } };
    const after = updateOrganizationPosition(org, r, "new", { title: "Manager", reportsTo: ["boss"] });
    expect(after.new.reportsTo).toEqual(["boss"]); expect(after.peer.reportsTo).toEqual(["new"]); expect(after.child.reportsTo).toEqual(["peer"]);
    expect(org.peer.reportsTo).toEqual(["boss"]);
  });
  it("falls back to CEO for an unavailable upstream and rejects a cycle without mutating the source", () => {
    const org = initial(); org.worker1.reportsTo = ["unknown"];
    expect(reconcileOrganization(org, roster).worker1.reportsTo).toEqual([CEO_ID]);
    const before = initial();
    expect(() => updateOrganizationPosition(before, roster, "worker6", { title: "Head", reportsTo: ["worker1"] })).toThrow("cycle");
    expect(before.worker6.reportsTo).toEqual([CEO_ID]);
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
