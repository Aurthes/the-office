// @vitest-environment node
import { createRequire } from "node:module";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createDuckAppearanceFromSeed } from "@/lib/avatars/duck";
const require = createRequire(import.meta.url);
const { CodexOfficeStore } = require("../../server/codex-office-store");
const { OfficeCompany } = require("../../server/office-company");
const { tools, createGatewayClient } = require("../../server/office-todo-mcp");
const { ceo: CEO } = require("../../src/lib/office/identities.json");
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
async function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "recruit-templates-")); roots.push(root);
  const workspace = path.join(root, "workspace"); mkdirSync(workspace);
  let fullAllowed = true, modelAvailable = true;
  const client = { ready: true, call: vi.fn(async (method: string, _params?: unknown) => {
    void _params;
    if (method === "model/list") return { data: [
      ...(modelAvailable ? [{ model: "model-a", displayName: "Model A", supportedReasoningEfforts: [{ reasoningEffort: "high" }, { reasoningEffort: "low" }], defaultReasoningEffort: "high" }] : []),
      { model: "model-b", displayName: "Model B", supportedReasoningEfforts: [{ reasoningEffort: "medium" }], defaultReasoningEffort: "medium" },
    ] };
    if (method === "permissionProfile/list") return { data: [{ id: ":read-only", allowed: true }, { id: ":workspace", allowed: true }, { id: ":danger-full-access", allowed: fullAllowed }, { id: "unmapped", allowed: true }] };
    throw Error("Unexpected native call: " + method);
  }) };
  const directory = path.join(root, "office"), store = new CodexOfficeStore(directory, client); store.ensureCeo();
  const project = (await store.createProject({ name: "A", workspace, requestId: "project-a" })).project;
  const other = (await store.createProject({ name: "B", workspace, requestId: "project-b" })).project;
  const manager = (await store.createSession({ name: "Head", projectId: project.id, templateId: null, requestId: "head" })).threadId;
  const shared = (await store.createSession({ name: "Shared Head", projectId: null, workspace, templateId: null, requestId: "shared-head" })).threadId;
  const file = path.join(root, "settings.json");
  writeFileSync(file, JSON.stringify({ office: { "ws://localhost:18790": { organization: { [CEO]: { title: "CEO", reportsTo: [] }, [manager]: { title: "Head", reportsTo: [CEO] }, [shared]: { title: "Head", reportsTo: [CEO] } } } } }));
  const company = new OfficeCompany(store, { settingsFile: file, gatewayUrl: "ws://127.0.0.1:18790" });
  const save = (extra = {}) => store.saveRecruitmentTemplate({ name: "Careful", projectId: project.id, model: "model-a", effort: "high", accessMode: ":workspace", requestId: crypto.randomUUID(), ...extra });
  const recruit = (extra = {}) => company.recruit({ actorId: manager, name: "New employee", reason: "No suitable available employee", requestId: crypto.randomUUID(), ...extra });
  return { root, workspace, directory, store, client, project, other, manager, shared, file, company, save, recruit, allowFull: (value: boolean) => { fullAllowed = value; }, allowModel: (value: boolean) => { modelAvailable = value; } };
}

it("persists independent templates and per-department defaults without creating any employee or native context", async () => {
  const f = await fixture(), before = f.store.list().length;
  const a = (await f.save()).template, b = (await f.save({ name: "Read only", accessMode: ":read-only", model: "model-b", effort: "medium" })).template;
  await f.store.setRecruitmentDefault({ projectId: f.project.id, templateId: a.id, requestId: "default-a" });
  await f.store.setRecruitmentDefault({ projectId: f.other.id, templateId: b.id, requestId: "default-b" });
  await f.store.setRecruitmentDefault({ projectId: null, templateId: b.id, requestId: "default-open" });
  const reloaded = new CodexOfficeStore(f.directory, f.client);
  expect(reloaded.recruitmentTemplates()).toEqual({ templates: [a, b], defaults: { [f.project.id]: a.id, [f.other.id]: b.id, "open-workspace": b.id } });
  expect(reloaded.list()).toHaveLength(before);
  expect(Object.keys(a).sort()).toEqual(["accessMode", "effort", "id", "model", "name"]);
  expect(f.client.call.mock.calls.every(([method]) => ["model/list", "permissionProfile/list"].includes(method))).toBe(true);
});
it("runs manual and actual Head recruitment through the same complete function with identical configuration semantics and randomized persisted appearance", async () => {
  const f = await fixture(), template = (await f.save()).template;
  await f.store.setRecruitmentDefault({ projectId: f.project.id, templateId: template.id, requestId: "default" });
  const entry = vi.spyOn(f.store, "createSession");
  for (const selection of [undefined, null, template.id]) {
    const params = selection === undefined ? {} : { templateId: selection };
    const manual = await f.store.createSession({ name: "New employee", projectId: f.project.id, requestId: crypto.randomUUID(), ...params });
    const head = await f.recruit(params);
    const a = f.store.get(manual.threadId), b = f.store.get(head.threadId);
    expect(b.settings).toEqual(a.settings);
    expect(a.settings).toEqual(selection === null ? { model: null, effort: null, accessMode: ":workspace" } : { model: "model-a", effort: "high", accessMode: ":workspace" });
    for (const row of [a, b]) {
      expect(row.avatarSeed).toBe(row.id); expect(row.avatarProfile.duck).toEqual(createDuckAppearanceFromSeed(row.id));
      expect(row).not.toHaveProperty("codexThreadId"); expect(row).not.toHaveProperty("hasTurns"); expect(row).not.toHaveProperty("projectContext");
    }
    expect(a.avatarProfile.duck).not.toEqual(b.avatarProfile.duck);
    expect(b.recruitment.managerId).toBe(f.manager);
    expect(f.company.context(b.id).managers.map((row: { id: string }) => row.id)).toEqual([f.manager]);
  }
  expect(entry).toHaveBeenCalledTimes(6);
  const reloaded = new CodexOfficeStore(f.directory, f.client);
  expect(reloaded.list().map((row: { avatarProfile: unknown }) => row.avatarProfile)).toEqual(f.store.list().map((row: { avatarProfile: unknown }) => row.avatarProfile));
  expect(f.client.call.mock.calls.every(([method]) => ["model/list", "permissionProfile/list"].includes(method))).toBe(true);
});
it("carries manual RPC and a real todo_recruit MCP child through their gateway routes into the complete shared initializer", async () => {
  const f = await fixture(), template = (await f.save()).template;
  await f.store.setRecruitmentDefault({ projectId: f.project.id, templateId: template.id, requestId: "transport-default" });
  const shared = vi.spyOn(f.store, "createSession"), calls: { method: string; params: Record<string, unknown> }[] = [];
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  server.on("connection", ws => ws.on("message", async raw => {
    const frame = JSON.parse(String(raw));
    if (frame.method === "connect") { ws.send(JSON.stringify({ type: "res", id: frame.id, ok: frame.params.auth.token === "fixture-only", payload: {} })); return; }
    calls.push(frame);
    try {
      const payload = await (frame.method === "session.create" ? f.store.createSession(frame.params) : f.company.recruit(frame.params));
      ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload }));
    } catch (error) { ws.send(JSON.stringify({ type: "res", id: frame.id, ok: false, error: { message: String(error) } })); }
  }));
  const address = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
  const manual = createGatewayClient({ address, token: "fixture-only" });
  const child = spawn(process.execPath, [path.resolve("server/office-todo-mcp.js")], { env: { NODE_ENV: "test", OFFICE_TASK_GATEWAY_URL: address, OFFICE_TASK_GATEWAY_TOKEN: "fixture-only" }, stdio: ["pipe", "pipe", "pipe"] });
  try {
    const a = await manual.call("session.create", { name: "Transport employee", projectId: f.project.id, templateId: template.id, requestId: "manual-rpc" });
    child.stdin.write(JSON.stringify({ id: 1, method: "tools/call", params: { name: "todo_recruit", arguments: { actorId: f.manager, name: "Transport employee", templateId: template.id, reason: "No suitable report", requestId: "mcp-recruit" } } }) + "\n");
    const [output] = await once(child.stdout, "data"), response = JSON.parse(String(output));
    expect(response.result.isError).not.toBe(true);
    const b = JSON.parse(response.result.content[0].text);
    expect(calls.map(row => row.method)).toEqual(["session.create", "todo.recruit"]);
    expect(calls[1].params.templateId).toBe(template.id); expect(shared).toHaveBeenCalledTimes(2);
    expect(f.store.get(a.threadId).settings).toEqual(f.store.get(b.threadId).settings);
    for (const id of [a.threadId, b.threadId]) expect(f.store.get(id).avatarProfile.duck).toEqual(createDuckAppearanceFromSeed(id));
    const exited = once(child, "exit"); child.stdin.end(); expect((await exited)[0]).toBe(0);
  } finally {
    manual.close(); if (child.exitCode === null) child.kill();
    for (const ws of server.clients) ws.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
it("isolates department defaults including Open Workspace and preserves fresh behavior where no default exists", async () => {
  const f = await fixture(), a = (await f.save()).template;
  await f.store.setRecruitmentDefault({ projectId: f.project.id, templateId: a.id, requestId: "set-a" });
  const other = await f.store.createSession({ name: "Other", projectId: f.other.id, requestId: "other" });
  const shared = await f.company.recruit({ actorId: f.shared, name: "Shared", reason: "No suitable report", requestId: "shared" });
  expect(f.store.get(other.threadId).settings).toEqual({ model: null, effort: null, accessMode: ":workspace" });
  expect(f.store.get(shared.threadId).settings).toEqual({ model: null, effort: null, accessMode: ":workspace" });
  await f.store.setRecruitmentDefault({ projectId: null, templateId: a.id, requestId: "set-open" });
  const next = await f.company.recruit({ actorId: f.shared, name: "Configured shared", reason: "No suitable report", requestId: "configured-shared" });
  expect(f.store.get(next.threadId)).toMatchObject({ projectId: null, workspace: f.store.get(f.shared).workspace, settings: { model: "model-a", effort: "high" } });
});
it("keeps successful retries and employee snapshots stable after template edits and deletion, and clears deleted default references", async () => {
  const f = await fixture(), template = (await f.save()).template;
  await f.store.setRecruitmentDefault({ projectId: f.project.id, templateId: template.id, requestId: "set" });
  const request = { actorId: f.manager, name: "Once", reason: "No suitable report", templateId: template.id, requestId: "once" };
  const result = await f.company.recruit(request), snapshot = JSON.stringify(f.store.get(result.threadId));
  await f.save({ id: template.id, model: "model-b", effort: "medium", accessMode: ":read-only" });
  expect(JSON.stringify(f.store.get(result.threadId))).toBe(snapshot);
  expect(await f.company.recruit(request)).toEqual(result);
  await f.store.deleteRecruitmentTemplate({ id: template.id, requestId: "delete" });
  expect(f.store.recruitmentTemplates().defaults).toEqual({});
  const reloaded = new CodexOfficeStore(f.directory, f.client), company = new OfficeCompany(reloaded, { settingsFile: f.file, gatewayUrl: "ws://localhost:18790" });
  expect(await company.recruit(request)).toEqual(result);
  expect(JSON.stringify(reloaded.get(result.threadId))).toBe(snapshot);
  const count = reloaded.list().length;
  await expect(company.recruit({ ...request, requestId: "deleted-template" })).rejects.toThrow(/unavailable/);
  expect(reloaded.list()).toHaveLength(count);
});
it("requires confirmation at Full-access save and still enforces current model, effort and allowed permissions on every application", async () => {
  const f = await fixture(), count = f.store.list().length;
  await expect(f.save({ accessMode: ":danger-full-access" })).rejects.toThrow(/Full access/);
  const template = (await f.save({ accessMode: ":danger-full-access", confirmFullAccess: true })).template;
  const input = { name: "Full", projectId: f.project.id, templateId: template.id, requestId: "full" };
  const { threadId } = await f.store.createSession(input);
  expect(f.store.get(threadId).settings.accessMode).toBe(":danger-full-access");
  const head = await f.recruit({ templateId: template.id });
  expect(f.store.get(head.threadId).settings).toEqual(f.store.get(threadId).settings);
  f.allowFull(false);
  await expect(f.store.createSession({ ...input, requestId: "forbidden" })).rejects.toThrow(/权限模式/);
  await expect(f.recruit({ templateId: template.id })).rejects.toThrow(/权限模式/);
  await expect(f.save({ accessMode: ":danger-full-access", confirmFullAccess: true })).rejects.toThrow(/权限模式/);
  f.allowModel(false);
  await expect(f.store.createSession({ ...input, requestId: "removed-model" })).rejects.toThrow(/模型/);
  await expect(f.recruit({ templateId: template.id })).rejects.toThrow(/模型/);
  await expect(f.save({ model: "model-b", effort: "high" })).rejects.toThrow(/推理强度/);
  await expect(f.save({ accessMode: "unmapped" })).rejects.toThrow(/valid/);
  expect(f.store.list()).toHaveLength(count + 2);
  expect(f.store.get(threadId).settings.accessMode).toBe(":danger-full-access");
});
it("rejects invalid saved/default references and preserves Head eligibility, department and reporting boundaries", async () => {
  const f = await fixture(), count = f.store.list().length;
  f.store.data.recruitmentDefaults = { [f.project.id]: "missing" };
  await expect(f.recruit()).rejects.toThrow(/unavailable/);
  expect(f.store.list()).toHaveLength(count);
  expect(() => f.company.recruit({ actorId: CEO, name: "Not a department Head", reason: "Need help", requestId: "ceo" })).toThrow(/Head/);
  await expect(f.store.setRecruitmentDefault({ projectId: "missing", templateId: null, requestId: "invalid-project" })).rejects.toThrow(/project/);
  const created = await f.recruit({ projectId: f.other.id, templateId: null });
  expect(f.store.get(created.threadId).projectId).toBe(f.project.id);
  expect(tools.find((tool: { name: string }) => tool.name === "todo_recruit").inputSchema.properties.templateId.type).toEqual(["string", "null"]);
  expect(tools.some((tool: { name: string }) => tool.name.includes("template") && tool.name !== "todo_recruit")).toBe(false);
  const disk = readFileSync(path.join(f.directory, "office.json"), "utf8");
  expect(disk).not.toContain("codexThreadId");
});
it("rechecks project folder membership after asynchronous native configuration validation before creating an employee", async () => {
  const f = await fixture(), template = (await f.save()).template, count = f.store.list().length;
  const original = f.client.call.getMockImplementation()!;
  let release: () => void = () => {}, started: () => void = () => {};
  const hold = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { started = resolve; });
  f.client.call.mockImplementation(async (method, params) => { if (method === "model/list") { started(); await hold; } return original(method, params); });
  const creating = f.store.createSession({ name: "Pending", projectId: f.project.id, templateId: template.id, requestId: "pending-create" });
  await ready;
  const replacement = path.join(f.root, "replacement"); mkdirSync(replacement);
  const canonical = f.store.directory(replacement);
  await f.store.updateProject({ projectId: f.project.id, name: "A", rootPaths: [canonical], workspaces: { [f.manager]: canonical }, requestId: "move-folder" });
  release();
  await expect(creating).rejects.toThrow(/Project folders changed/);
  expect(f.store.list()).toHaveLength(count);
});
