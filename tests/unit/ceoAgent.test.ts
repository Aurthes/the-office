import { createRequire } from "node:module";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CEO_ID, LEGACY_CEO_ID, normalizeOrganization, reconcileOrganization, organizationPeople } from "@/lib/office/organization";
import { createDefaultAgentAvatarProfile } from "@/lib/avatars/profile";
import { defaultStudioSettings, mergeStudioSettings, normalizeStudioSettings, resolveAgentAvatarProfile, resolveOfficePreferencePublic, sanitizeStudioSettings } from "@/lib/studio/settings";
import { buildShipLayout, shipDeck } from "@/features/ring-ship/layout";
import { monitorChairPose } from "@/features/ring-ship/monitor-room-geometry";
import { syncCrew, advanceCrew, worldPoint } from "@/features/ring-ship/crewMotion";

const require = createRequire(import.meta.url);
const { CodexOfficeStore } = require("../../server/codex-office-store.js");
const { OfficeTodos } = require("../../server/office-todos.js");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "office-ceo-test-")); roots.push(directory);
  const client = { ready: true, call: vi.fn(async (method: string) => method === "thread/start" ? { thread: { id: "native-ceo" } } : method === "turn/start" ? { turn: { id: "turn-ceo" } } : {}) };
  const store = new CodexOfficeStore(directory, client);
  return { directory, client, store };
}

it("provisions one ordinary UUID session in an Office-owned workspace without starting AI work", () => {
  const f = fixture(); f.store.ensureCeo();
  expect(CEO_ID).toMatch(/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i);
  expect(f.store.get(CEO_ID)).toMatchObject({ id: CEO_ID, name: "CEO", projectId: null, status: "idle", workspace: realpathSync(path.join(f.directory, "workspaces", "ceo")), settings: { model: null, effort: null, accessMode: ":workspace" } });
  const saved = vi.spyOn(f.store, "save"); f.store.ensureCeo();
  expect(f.store.list()).toHaveLength(1); expect(saved).not.toHaveBeenCalled(); expect(f.client.call).not.toHaveBeenCalled();
});

it("keeps a CEO's conversation, edits and permissions across startup and never resurrects an archived CEO", () => {
  const f = fixture(); f.store.ensureCeo();
  Object.assign(f.store.get(CEO_ID), { name: "Captain", codexThreadId: "existing-thread", hasTurns: true, settings: { model: "chosen", effort: "high", accessMode: ":read-only" } }); f.store.save();
  const restarted = new CodexOfficeStore(f.directory, f.client); restarted.ensureCeo();
  expect(restarted.get(CEO_ID)).toMatchObject({ name: "Captain", codexThreadId: "existing-thread", hasTurns: true, settings: { model: "chosen", effort: "high", accessMode: ":read-only" } });
  expect(restarted.list()).toHaveLength(1);
  restarted.get(CEO_ID).archived = true; restarted.save();
  const archived = new CodexOfficeStore(f.directory, f.client); archived.ensureCeo();
  expect(archived.list()).toHaveLength(0); expect(archived.data.sessions).toHaveLength(1);
});

it("runs, reports interruption and accepts task assignment through the normal session mechanisms", async () => {
  const f = fixture(); f.store.ensureCeo();
  const todos = new OfficeTodos(f.directory, { projects: () => f.store.projects(), agents: () => f.store.list(), changed: () => {} });
  expect(todos.create({ requestId: "ceo-task", title: "Check the release", assigneeId: CEO_ID, departmentId: null, phases: [{ title: "Verify" }] }).todo).toMatchObject({ assigneeId: CEO_ID, assigneeAvailable: true });
  await f.store.call("turn/start", { threadId: CEO_ID, input: [{ type: "text", text: "Hello" }] });
  expect(f.client.call).toHaveBeenCalledWith("turn/start", expect.objectContaining({ threadId: "native-ceo", cwd: f.store.get(CEO_ID).workspace,
    approvalPolicy: "on-request", sandboxPolicy: expect.objectContaining({ type: "workspaceWrite", writableRoots: [f.store.get(CEO_ID).workspace] }) }));
  f.store.handle({ method: "turn/started", params: { threadId: "native-ceo", turn: { id: "turn-ceo" } } });
  expect(f.store.get(CEO_ID).status).toBe("running");
  f.store.handle({ method: "turn/completed", params: { threadId: "native-ceo", turn: { id: "turn-ceo", status: "interrupted" } } });
  expect(f.store.get(CEO_ID)).toMatchObject({ status: "error", turnStatus: "interrupted", codexThreadId: "native-ceo" });
});

it("migrates the old organization root and avatar while preserving all reporting edges", () => {
  const avatar = createDefaultAgentAvatarProfile(LEGACY_CEO_ID), gateway = "ws://127.0.0.1:18790";
  const settings = normalizeStudioSettings({ ...defaultStudioSettings(), avatars: { [gateway]: { [LEGACY_CEO_ID]: avatar } }, office: { [gateway]: { organization: {
    [LEGACY_CEO_ID]: { title: "Captain", reportsTo: [] }, head: { title: "Head", reportsTo: [LEGACY_CEO_ID] }, worker: { title: "Engineer", reportsTo: ["head", LEGACY_CEO_ID] },
  } } } });
  const organization = resolveOfficePreferencePublic(sanitizeStudioSettings(settings), gateway).organization!;
  expect(organization[LEGACY_CEO_ID]).toBeUndefined(); expect(organization[CEO_ID]).toEqual({ title: "Captain", reportsTo: [] });
  expect(organization.head.reportsTo).toEqual([CEO_ID]); expect(organization.worker).toEqual({ title: "Engineer", reportsTo: ["head", CEO_ID] });
  expect(resolveAgentAvatarProfile(settings, gateway, CEO_ID)).toEqual(avatar);
  const patched = mergeStudioSettings(settings, { avatars: { [gateway]: { [LEGACY_CEO_ID]: avatar } }, office: { [gateway]: { organization: { worker: { title: "Engineer", reportsTo: [LEGACY_CEO_ID] } } } } });
  expect(resolveOfficePreferencePublic(sanitizeStudioSettings(patched), gateway).organization!.worker.reportsTo).toEqual([CEO_ID]);
  expect(Object.keys(patched.avatars["ws://localhost:18790"])).toEqual([CEO_ID]);
});

it("prefers an already saved real CEO over legacy copies regardless of key order", () => {
  const original = createDefaultAgentAvatarProfile("new-ceo"), legacy = createDefaultAgentAvatarProfile(LEGACY_CEO_ID), gateway = "ws://localhost:18790";
  for (const reversed of [false, true]) {
    const entries = [[CEO_ID, original], [LEGACY_CEO_ID, legacy]];
    const settings = normalizeStudioSettings({ ...defaultStudioSettings(), avatars: { [gateway]: Object.fromEntries(reversed ? entries.reverse() : entries) } });
    expect(resolveAgentAvatarProfile(settings, gateway, CEO_ID)).toEqual(original);
    expect(normalizeOrganization(Object.fromEntries(reversed ? [[LEGACY_CEO_ID, { title: "Old", reportsTo: [] }], [CEO_ID, { title: "Current", reportsTo: [] }]] : [[CEO_ID, { title: "Current", reportsTo: [] }], [LEGACY_CEO_ID, { title: "Old", reportsTo: [] }]]))[CEO_ID].title).toBe("Current");
  }
});

it("shows a single CEO at the root without making the CEO an Open Workspace department head", () => {
  const roster = { projects: [], members: [{ id: CEO_ID, projectId: null }, { id: "ranger", projectId: null }] };
  const organization = reconcileOrganization({}, roster), people = organizationPeople(organization, roster, new Map([[CEO_ID, "Captain"]]));
  expect(organization[CEO_ID]).toEqual({ title: "CEO", reportsTo: [] }); expect(organization.ranger).toEqual({ title: "Head", reportsTo: [CEO_ID] });
  expect(people.filter(person => person.id === CEO_ID)).toHaveLength(1); expect(people[0]).toMatchObject({ name: "Captain", department: "Company" });
});

it("places the real CEO at the existing monitor chair and uses normal work-state animation", () => {
  const roster = { projects: [{ id: "office", name: "Office" }], members: [{ id: "worker", projectId: "office" }] };
  const before = buildShipLayout(roster), after = buildShipLayout({ ...roster, members: [...roster.members, { id: CEO_ID, projectId: null }] }, before.allocation);
  expect(after.allocation).toEqual(before.allocation); expect(after.seats.worker).toEqual(before.seats.worker);
  const seat = after.seats[CEO_ID], cabin = after.cabins.find(cabin => cabin.kind === "monitor")!, chair = monitorChairPose(after, cabin);
  expect(seat).toMatchObject({ ...chair.point, cabinId: cabin.id, facing: chair.facing, seatHeight: chair.seatHeight, surfaceHeight: chair.surfaceHeight });
  expect(cabin.agentIds).toEqual([CEO_ID]); expect(after.cabins.filter(cabin => cabin.kind === "work").flatMap(cabin => cabin.agentIds)).not.toContain(CEO_ID);
  const layout = shipDeck(after, seat.deck), agent = syncCrew([{ id: CEO_ID, name: "CEO", status: "working", color: "#fff", item: "" }], layout, new Map(), 0)[0];
  advanceCrew([agent], layout, 100, 1 / 60, CEO_ID, []);
  expect(agent).toMatchObject({ status: "working", state: "sitting", interactionTarget: "desk", workstation: { seatHeight: chair.seatHeight, surfaceHeight: chair.surfaceHeight } });
  expect(worldPoint(agent).x).toBeCloseTo(chair.point.x, 10);
  expect(worldPoint(agent).z).toBeCloseTo(chair.point.z, 10);
});
