// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultStudioSettings, mergeStudioSettings, sanitizeStudioSettings } from "@/lib/studio/settings";
import { organizationDepartments } from "@/lib/office/departments";
const require = createRequire(import.meta.url);
const { CodexOfficeStore } = require("../../server/codex-office-store");
const { OfficeCompany, WORKFLOW } = require("../../server/office-company");
const { tools, handle } = require("../../server/office-todo-mcp");
const { ceo: CEO } = require("../../src/lib/office/identities.json");
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
async function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "office-departments-")); roots.push(root);
  const workspace = path.join(root, "workspace"); mkdirSync(workspace);
  const call = vi.fn(async (method: string) => method === "thread/start" ? { thread: { id: "native-fixture" } } : { turn: { id: "turn" } });
  const store = new CodexOfficeStore(path.join(root, "office"), { ready: true, call }); store.ensureCeo();
  const makeProject = async (name: string) => (await store.createProject({ name, rootPaths: [workspace], requestId: crypto.randomUUID() })).project;
  const product = await makeProject("Product"), research = await makeProject("Research"), empty = await makeProject("Research");
  const makeAgent = async (name: string, projectId?: string) => (await store.createSession({ name, projectId, workspace, requestId: crypto.randomUUID() })).threadId;
  const head = await makeAgent("Product Head", product.id), worker = await makeAgent("Builder", product.id), researcher = await makeAgent("Research Head", research.id), sharedHead = await makeAgent("Shared Head");
  const organization = { [CEO]: { title: "CEO", reportsTo: [] }, [head]: { title: "Head", reportsTo: [CEO] }, [worker]: { title: "Engineer", reportsTo: [head] }, [researcher]: { title: "Head", reportsTo: [CEO] }, [sharedHead]: { title: "Head", reportsTo: [CEO] } };
  const gateway = "ws://localhost:18790";
  let settings = mergeStudioSettings(defaultStudioSettings(), { office: { [gateway]: { organization, departmentDescriptions: { [product.id]: "Own product implementation and product-specific investigation.", [research.id]: "General feature and signal research.", "open-workspace": "Other unowned work." } } } });
  const file = path.join(root, "settings.json"), save = () => writeFileSync(file, JSON.stringify({ ...sanitizeStudioSettings(settings), gateway: { token: "never-in-context" } })); save();
  const company = new OfficeCompany(store, { settingsFile: file, gatewayUrl: "ws://127.0.0.1:18790" });
  const patch = (value: Parameters<typeof mergeStudioSettings>[1]) => { settings = mergeStudioSettings(settings, value); save(); };
  return { root, store, company, call, head, worker, researcher, sharedHead, product, research, empty, gateway, file, patch };
}
describe("department responsibilities in the actual company context", () => {
  it("keeps responsibilities, membership, roles and reporting while omitting redundant model fields", async () => {
    const f = await fixture(), full = f.company.context(CEO), model = f.company.forTurn(CEO);
    expect(model.departments.map((d: { id: string }) => d.id)).toEqual(full.departments.map((d: { id: string }) => d.id));
    for (const department of model.departments) {
      const original = full.departments.find((d: { id: string }) => d.id === department.id);
      expect(department.description).toBe(original.description);
      expect(department.members).toEqual(original.members.map(({ id, name, title, reportsTo }: { id: string; name: string; title: string; reportsTo: string[] }) => ({ id, name, title, reportsTo })));
      expect(department.heads.map((p: { id: string }) => p.id)).toEqual(original.heads.map((p: { id: string }) => p.id));
    }
    expect(Buffer.byteLength(JSON.stringify(model))).toBeLessThan(Buffer.byteLength(JSON.stringify(full)));
    expect(f.company.context(CEO)).toEqual(full);
    expect(() => f.company.assertDelegate(f.worker, f.researcher)).toThrow("direct report");
  });
  it("reads the UI's saved descriptions and derives the same full directory for the CEO", async () => {
    const f = await fixture(), view = f.company.context(CEO);
    const saved = JSON.parse(readFileSync(f.file, "utf8"));
    expect(view.departments).toEqual(organizationDepartments(f.store.projects(), f.company.organization(), saved.office[f.gateway].departmentDescriptions));
    expect(view.departmentScope).toBe("company"); expect(view.departments).toHaveLength(4);
    expect(view.departments.find((d: { id: string }) => d.id === f.product.id)).toMatchObject({ heads: [{ id: f.head }], members: [{ id: f.head }, { id: f.worker, title: "Engineer" }] });
    expect(view.departments.at(-1).members.map((p: { id: string }) => p.id)).toEqual([f.sharedHead]);
    expect(JSON.stringify(view)).not.toContain("never-in-context");
  });
  it("defaults Head and worker to their own department but lets anyone look up the others without extra authority", async () => {
    const f = await fixture();
    for (const id of [f.head, f.worker]) expect(f.company.forTurn(id)).toMatchObject({ departmentScope: "own", departments: [{ id: f.product.id }] });
    expect(f.company.context(f.worker).departments).toHaveLength(1);
    expect(f.company.context(f.worker, { departmentId: f.research.id }).departments).toMatchObject([{ id: f.research.id, heads: [{ id: f.researcher }], description: "General feature and signal research." }]);
    expect(f.company.context(f.worker, { allDepartments: true }).departments).toHaveLength(4);
    expect(f.company.context(f.worker, { departmentId: null }).departments).toMatchObject([{ id: "open-workspace", heads: [{ id: f.sharedHead }] }]);
    expect(() => f.company.assertDelegate(f.worker, f.researcher)).toThrow("direct report");
    expect(() => f.company.assertDelegate(f.head, f.researcher)).toThrow("direct report");
    expect(() => f.company.assertDelegate(CEO, f.head)).not.toThrow();
  });
  it("refreshes descriptions, roles, membership, names and Head vacancies from the current source", async () => {
    const f = await fixture(); f.company.context(CEO);
    f.patch({ office: { [f.gateway]: { departmentDescriptions: { [f.product.id]: "Updated product scope" }, organization: { [f.worker]: { title: "Specialist", reportsTo: [f.head] } } } } });
    f.store.project(f.product.id).name = "Renamed";
    expect(f.company.context(f.worker).departments[0]).toMatchObject({ name: "Renamed", description: "Updated product scope", members: [{ id: f.head }, { id: f.worker, title: "Specialist" }] });
    f.store.get(f.head).archived = true;
    expect(f.company.context(f.worker).departments[0].heads).toEqual([]);
    expect(f.company.context(f.worker).departments[0].members).toMatchObject([{ id: f.worker, title: "Specialist" }]);
    f.store.get(f.worker).projectId = f.research.id;
    expect(f.company.context(f.worker).departments[0].id).toBe(f.research.id);
    f.store.get(f.worker).projectId = null;
    expect(f.company.context(f.worker).departments[0].id).toBe("open-workspace");
    expect(f.store.projects()).toHaveLength(3);
  });
  it("keeps empty and same-named departments separate, rejects invalid queries and does not invent an owner", async () => {
    const f = await fixture();
    expect(f.company.context(CEO).departments.filter((d: { name: string }) => d.name === "Research")).toHaveLength(2);
    expect(f.company.context(f.worker, { departmentId: f.empty.id }).departments[0]).toMatchObject({ members: [], heads: [], description: "" });
    for (const options of [{ departmentId: "missing" }, { allDepartments: "true" }, { departmentId: null, allDepartments: true }]) expect(() => f.company.context(f.worker, options)).toThrow();
  });
  it("injects changed responsibilities into an existing native conversation once without recreating it", async () => {
    const f = await fixture(); f.store.companyContext = (id: string) => f.company.forTurn(id);
    const row = f.store.get(f.worker); row.codexThreadId = "existing-native";
    await f.store.call("turn/start", { threadId: f.worker, input: [] });
    await f.store.call("turn/start", { threadId: f.worker, input: [] });
    expect(f.call.mock.calls.filter(([m]) => m === "thread/inject_items")).toHaveLength(1);
    f.patch({ office: { [f.gateway]: { departmentDescriptions: { [f.product.id]: "Fresh scope" } } } });
    await f.store.call("turn/start", { threadId: f.worker, input: [] });
    const injections = f.call.mock.calls.filter(([m]) => m === "thread/inject_items");
    expect(injections).toHaveLength(2); expect(JSON.stringify(injections.at(-1))).toContain("Fresh scope");
    expect(f.call.mock.calls.some(([m]) => m === "thread/start")).toBe(false);
  });
  it("keeps ordinary chat available when optional company settings fail and fails closed for delegation", async () => {
    const f = await fixture(); f.company.context(f.head); writeFileSync(f.file, "invalid");
    expect(f.company.forTurn(f.worker)).toMatchObject({ unavailable: true, delegationMode: "self" });
    expect(() => f.company.context(f.worker, { allDepartments: true })).toThrow();
    expect(() => f.company.assertDelegate(CEO, f.head)).toThrow();
    f.store.companyContext = (id: string) => f.company.forTurn(id);
    await expect(f.store.call("turn/start", { threadId: f.worker, input: [] })).resolves.toBeDefined();
  });
  it("publishes the existing read-only MCP lookup with optional department selection", async () => {
    const catalog = await handle({ method: "tools/list" }), tool = catalog.tools.find((t: { name: string }) => t.name === "todo_organization");
    expect(tool.inputSchema.required).toEqual(["actorId"]);
    expect(tool.inputSchema.properties.allDepartments.type).toBe("boolean");
    expect(tool.inputSchema.properties.departmentId.type).toEqual(["string", "null"]);
    expect(tool.annotations.readOnlyHint).toBe(true); expect(tools).toHaveLength(17);
    expect(WORKFLOW).toContain("Open Workspace Head"); expect(WORKFLOW).toContain("explicit instruction");
    expect(WORKFLOW).toContain("never bypass reporting");
  });
});

describe("Head recruitment using persistent Office sessions", () => {
  it("grants department Heads including Open Workspace, but not ordinary workers, the recruitment capability", async () => {
    const f = await fixture(), before = f.store.list().length;
    expect(f.company.context(f.head).canRecruit).toBe(true); expect(f.company.context(f.sharedHead).canRecruit).toBe(true);
    expect(f.company.context(f.worker).canRecruit).toBe(false);
    for (const actorId of [f.worker, CEO]) expect(() => f.company.recruit({ actorId, name: "New employee", reason: "All suitable reports are busy", requestId: crypto.randomUUID() })).toThrow(/Head/);
    expect(f.store.list()).toHaveLength(before);
  });
  it("creates one persistent normal-permission direct report and replays retries without starting work", async () => {
    const f = await fixture(), before = f.store.list().length, settingsBefore = readFileSync(f.file, "utf8");
    const request = { actorId: f.head, name: "New builder", reason: "Existing suitable employees are occupied", requestId: crypto.randomUUID() };
    const result = await f.company.recruit(request); expect(await f.company.recruit(request)).toEqual(result);
    expect(f.store.list()).toHaveLength(before + 1);
    expect(f.store.get(result.threadId)).toMatchObject({ name: "New builder", projectId: f.product.id, workspace: f.store.get(f.head).workspace, status: "idle", settings: { accessMode: ":workspace", model: null, effort: null }, recruitment: { managerId: f.head, reason: request.reason } });
    expect(f.company.context(result.threadId)).toMatchObject({ title: "Worker", canRecruit: false, managers: [{ id: f.head }] });
    expect(f.company.context(f.head).directReports.map((p: { id: string }) => p.id)).toContain(result.threadId);
    expect(() => f.company.assertDelegate(f.head, result.threadId)).not.toThrow(); expect(f.call).not.toHaveBeenCalled();
    expect(readFileSync(f.file, "utf8")).toBe(settingsBefore);
    const restoredStore = new CodexOfficeStore(path.join(f.root, "office"), { ready: true, call: f.call });
    const restoredCompany = new OfficeCompany(restoredStore, { settingsFile: f.file, gatewayUrl: f.gateway });
    expect(await restoredCompany.recruit(request)).toEqual(result);
    expect(restoredCompany.context(result.threadId).managers[0].id).toBe(f.head);
  });
  it("keeps Open Workspace recruits unassigned to projects and under its existing Head", async () => {
    const f = await fixture(), { threadId } = await f.company.recruit({ actorId: f.sharedHead, name: "Shared helper", reason: "No suitable report is available", requestId: crypto.randomUUID() });
    expect(f.store.get(threadId)).toMatchObject({ projectId: null, workspace: f.store.get(f.sharedHead).workspace });
    expect(f.company.context(threadId)).toMatchObject({ title: "Worker", managers: [{ id: f.sharedHead }], departments: [{ id: "open-workspace", heads: [{ id: f.sharedHead }] }] });
  });
  it("reports to the recruiting Head in a multi-Head department and lets saved organization edits override bootstrap", async () => {
    const f = await fixture();
    const second = (await f.store.createSession({ name: "Second Head", projectId: f.product.id, requestId: crypto.randomUUID() })).threadId;
    f.patch({ office: { [f.gateway]: { organization: { [second]: { title: "Head", reportsTo: [CEO] } } } } });
    const { threadId } = await f.company.recruit({ actorId: second, name: "Second helper", reason: "No suitable available reports", requestId: crypto.randomUUID() });
    expect(f.company.context(threadId).managers.map((p: { id: string }) => p.id)).toEqual([second]);
    f.patch({ office: { [f.gateway]: { organization: { [threadId]: { title: "Specialist", reportsTo: [f.head] } } } } });
    expect(f.company.context(threadId)).toMatchObject({ title: "Specialist", managers: [{ id: f.head }] });
  });
  it("uses the same bootstrap for the UI and gateway without overriding a later department move", async () => {
    const f = await fixture(), { threadId } = await f.company.recruit({ actorId: f.head, name: "Helper", reason: "No suitable available report", requestId: crypto.randomUUID() });
    const { reconcileOrganization } = require("../../src/lib/office/organization-structure");
    const saved = JSON.parse(readFileSync(f.file, "utf8")).office[f.gateway].organization;
    const members = f.store.list().map((p: { id: string; projectId: string | null; recruitment?: { managerId: string } }) => ({ id: p.id, projectId: p.projectId, recruitedBy: p.recruitment?.managerId }));
    expect(reconcileOrganization(saved, { projects: f.store.projects(), members })[threadId]).toMatchObject({ title: "Worker", reportsTo: [f.head] });
    f.store.get(threadId).projectId = f.research.id;
    expect(f.company.context(threadId).managers.map((p: { id: string }) => p.id)).toEqual([f.researcher]);
  });
  it("fails closed before creation on missing or invalid reporting data and rejects invalid recruitment input", async () => {
    const f = await fixture(), before = f.store.list().length, request = { actorId: f.head, name: "Helper", reason: "No available suitable report", requestId: crypto.randomUUID() };
    for (const extra of [{ reason: "" }, { reason: "x".repeat(501) }, { name: "" }, { requestId: "" }]) expect(() => f.company.recruit({ ...request, ...extra })).toThrow();
    f.company.context(f.head); writeFileSync(f.file, "invalid");
    expect(() => f.company.recruit(request)).toThrow(); expect(f.company.forTurn(f.head).canRecruit).toBe(false);
    expect(f.store.list()).toHaveLength(before);
  });
  it("does not let the ordinary session-create input forge recruitment metadata", async () => {
    const f = await fixture(), { threadId } = await f.store.createSession({ name: "Manual", projectId: f.product.id, recruitment: { managerId: f.worker }, requestId: crypto.randomUUID() });
    expect(f.store.get(threadId).recruitment).toBeUndefined();
    const tool = tools.find((t: { name: string }) => t.name === "todo_recruit");
    expect(tool.inputSchema.required).toEqual(["actorId", "name", "reason", "requestId"]); expect(tool.inputSchema.properties).not.toHaveProperty("departmentId");
    expect(tool.annotations.readOnlyHint).toBe(false);
    expect(WORKFLOW).toContain("First check"); expect(WORKFLOW).toContain("If none is available");
  });
});
