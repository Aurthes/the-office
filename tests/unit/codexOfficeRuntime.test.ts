import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { officeEnvironment } = require("../../server/codex-office-client.js");
const { CodexOfficeStore } = require("../../server/codex-office-store.js");
const { CodexSessionControls } = require("../../server/codex-session-controls.js");
const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "office-state-test-")); roots.push(root);
  const workspace = path.join(root, "workspace"); mkdirSync(workspace);
  const client = { ready: true, respond: vi.fn(), call: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method: string) => {
    if (method === "model/list") return { data: [{ model: "model-a", displayName: "A", supportedReasoningEfforts: [{ reasoningEffort: "high" }], defaultReasoningEffort: "high" }] };
    if (method === "permissionProfile/list") return { data: [{ id: ":workspace", allowed: true }, { id: ":read-only", allowed: true }, { id: ":danger-full-access", allowed: true }] };
    if (method === "thread/start") return { thread: { id: "native-own-thread" }, model: "model-a" };
    if (method === "thread/turns/list") return { data: [], nextCursor: null };
    if (method === "turn/start") return { turn: { id: "turn-1" } };
    return {};
  }) };
  const directory = path.join(root, "office"), store = new CodexOfficeStore(directory, client);
  return { root, workspace, client, store, directory };
}
async function session(f: ReturnType<typeof fixture>) {
  const { project } = await f.store.createProject({ name: "Own project", workspace: f.workspace, requestId: "project" });
  return (await f.store.createSession({ name: "Own chat", projectId: project.id, requestId: "session" })).threadId;
}
describe("independent Office runtime", () => {
  it("persists an unassigned agent, scopes its turns and terminal roots to its chosen folder, and does not create a project", async () => {
    const f = fixture();
    const input = { name: "Open Space agent", projectId: null, workspace: f.workspace, requestId: "open-space" };
    const { threadId } = await f.store.createSession(input);
    expect(await f.store.createSession(input)).toEqual({ threadId });
    const store = new CodexOfficeStore(f.directory, f.client);
    expect(store.projects()).toEqual([]);
    expect(store.list()[0]).toMatchObject({ id: threadId, projectId: null, project: "Open Workspace", workspace: realpathSync(f.workspace) });
    expect(store.sessionFolders(store.get(threadId))).toEqual([realpathSync(f.workspace)]);
    expect(f.client.call).not.toHaveBeenCalled();
    await store.call("turn/start", { threadId, input: [{ type: "text", text: "hello" }] });
    expect(f.client.call).toHaveBeenLastCalledWith("turn/start", expect.objectContaining({ cwd: realpathSync(f.workspace), sandboxPolicy: expect.objectContaining({ writableRoots: [realpathSync(f.workspace)] }) }));
    const context = f.client.call.mock.calls.find(([method]) => method === "thread/inject_items");
    expect(JSON.stringify(context)).toContain('Open Workspace');
    expect(() => store.createSession({ ...input, requestId: "invalid-project", projectId: "missing" })).toThrow("Choose an Office project");
    expect(() => store.createSession({ ...input, requestId: "invalid-folder", workspace: path.join(f.root, "missing") })).toThrow("existing absolute");
  });
  it("isolates state and strips inherited App connection overrides without changing the parent environment", () => {
    const f = fixture(), foreign = path.join(f.root, "native"); mkdirSync(foreign); writeFileSync(path.join(foreign, "sentinel"), "unchanged");
    const environment = { PATH: "/bin", CODEX_HOME: foreign, CODEX_SQLITE_HOME: foreign, CODEX_APP_SERVER_WS_URL: "ws://old", CODEX_ORIGINATOR_OVERRIDE: "native-app", CLAW3D_CODEX_CONTROL_SOCKET: "/old.sock", BROWSER_USE_ACCESS_PIPE_PATH: "/app-browser.sock", NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S: "app-tool-identity", OPENAI_API_KEY: "feature-api-test-key" };
    const value = officeEnvironment(path.join(f.root, "isolated"), environment);
    expect(value.env.CODEX_HOME).toBe(value.home); expect(value.env.CODEX_SQLITE_HOME).toBe(value.home);
    expect(value.env.CODEX_APP_SERVER_WS_URL).toBeUndefined(); expect(value.env.CODEX_ORIGINATOR_OVERRIDE).toBeUndefined(); expect(value.env.CLAW3D_CODEX_CONTROL_SOCKET).toBeUndefined();
    expect(value.env.OPENAI_API_KEY).toBeUndefined(); expect(environment.OPENAI_API_KEY).toBe("feature-api-test-key");
    expect(value.env.BROWSER_USE_ACCESS_PIPE_PATH).toBeUndefined(); expect(value.env.NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S).toBeUndefined();
    expect(environment.CODEX_HOME).toBe(foreign); expect(readFileSync(path.join(foreign, "sentinel"), "utf8")).toBe("unchanged");
    expect(() => officeEnvironment(foreign, environment)).toThrow("separate");
    const link = path.join(f.root, "alias"); symlinkSync(foreign, link); expect(() => officeEnvironment(link, environment)).toThrow("separate");
    expect(() => officeEnvironment(path.join(homedir(), ".codex", "office"), {})).toThrow("separate");
  });
  it("persists empty Office sessions across restarts without creating or reading Codex threads", async () => {
    const f = fixture(), id = await session(f);
    const restarted = new CodexOfficeStore(f.directory, f.client);
    expect(restarted.list().map((r: { id: string }) => r.id)).toEqual([id]);
    expect(await restarted.call("thread/turns/list", { threadId: id })).toEqual({ data: [], nextCursor: null });
    expect(f.client.call).not.toHaveBeenCalled();
    await expect(restarted.call("thread/resume", { threadId: "foreign-thread" })).rejects.toThrow("Office session");
  });
  it("creates the Codex thread only on send and uses public next-turn settings", async () => {
    const f = fixture(), id = await session(f), controls = new CodexSessionControls(f.store, () => [], { settings: f.store });
    await controls.updateSettings(id, { model: "model-a", effort: "high", accessMode: ":read-only" });
    expect(f.client.call.mock.calls.some(([m]) => m === "thread/settings/update")).toBe(false);
    await controls.send(id, "hello", "send-1");
    expect(f.client.call).toHaveBeenCalledWith("thread/start", { cwd: realpathSync(f.workspace), sandbox: "read-only", approvalPolicy: "on-request", model: "model-a" });
    expect(f.client.call).toHaveBeenCalledWith("turn/start", expect.objectContaining({ threadId: "native-own-thread", model: "model-a", effort: "high", sandboxPolicy: { type: "readOnly", networkAccess: false } }));
    expect(f.store.get(id).codexThreadId).toBe("native-own-thread");
    const restarted = new CodexOfficeStore(f.directory, f.client); expect(restarted.current(id)).toMatchObject({ model: "model-a", effort: "high", accessMode: ":read-only" });
  });
  it("does not silently replace a thread after an uncertain first send", async () => {
    const f = fixture(), id = await session(f);
    f.store.get(id).codexThreadId = "uncertain"; f.store.get(id).attemptedTurn = true; f.store.save();
    f.client.call.mockRejectedValueOnce(new Error("no rollout found"));
    await expect(f.store.call("thread/resume", { threadId: id })).rejects.toThrow("no rollout");
    expect(f.store.get(id).codexThreadId).toBe("uncertain");
  });
  it("opens voice on an empty Office chat with its current folders and permissions, and maps voice events back", async () => {
    const f = fixture(), id = await session(f), second = path.join(f.root, "second"); mkdirSync(second);
    const row = f.store.get(id), project = f.store.projects()[0];
    await f.store.updateProject({ projectId: project.id, name: "Voice project", rootPaths: [f.workspace, second], requestId: "voice-folders" });
    await f.store.update(id, { model: "model-a", effort: "high", accessMode: ":read-only" });
    const params = { threadId: id, version: "v3", outputModality: "audio", transport: { type: "webrtc", sdp: "v=0" } };
    await f.store.call("thread/realtime/start", params);
    expect(f.client.call).toHaveBeenCalledWith("thread/start", expect.objectContaining({ cwd: row.workspace, sandbox: "read-only", approvalPolicy: "on-request", config: { model_reasoning_effort: "high", sandbox_workspace_write: { writable_roots: [realpathSync(f.workspace), realpathSync(second)], network_access: false } } }));
    expect(f.client.call).toHaveBeenCalledWith("thread/inject_items", expect.objectContaining({ threadId: "native-own-thread" }));
    expect(f.client.call).toHaveBeenLastCalledWith("thread/realtime/start", { ...params, threadId: "native-own-thread", includeStartupContext: false, initialItems: [{ role: "developer", text: expect.stringContaining("Voice project") }] });
    expect(f.store.handle({ method: "thread/realtime/sdp", params: { threadId: "native-own-thread", sdp: "v=0-answer" } })).toEqual({ method: "thread/realtime/sdp", params: { threadId: id, sdp: "v=0-answer" } });
    await f.store.call("thread/realtime/stop", { threadId: id });
    expect(f.client.call).toHaveBeenLastCalledWith("thread/realtime/stop", { threadId: "native-own-thread" });
    expect(f.client.call.mock.calls.some(([method]) => method === "turn/start")).toBe(false);
    await f.store.call("thread/realtime/start", params);
    expect(f.client.call).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "native-own-thread", sandbox: "read-only" }));
  });
  it("bounds voice context to visible chat messages and preserves a running task's configuration", async () => {
    const f = fixture(), id = await session(f), row = f.store.get(id);
    Object.assign(row, { codexThreadId: "running-thread", hasTurns: true, status: "running" });
    f.client.call.mockImplementation(async (method: string) => method === "thread/turns/list" ? { data: [{ id: "turn", items: [
      { id: "user", type: "userMessage", content: [{ type: "text", text: "Current request" }] },
      { id: "commentary", type: "agentMessage", phase: "commentary", text: "PRIVATE_WORK_LOG" },
      { id: "answer", type: "agentMessage", phase: "final", text: "中".repeat(8000) },
    ] }], nextCursor: null } : {});
    await f.store.call("thread/realtime/start", { threadId: id });
    expect(f.client.call.mock.calls.some(([method]) => method === "thread/resume")).toBe(false);
    const params = f.client.call.mock.calls.at(-1)?.[1] as { initialItems: { role: string; text: string }[]; includeStartupContext: boolean };
    expect(params.includeStartupContext).toBe(false);
    expect(params.initialItems).toContainEqual({ role: "user", text: "Current request" });
    expect(JSON.stringify(params.initialItems)).not.toContain("PRIVATE_WORK_LOG");
    expect(params.initialItems.reduce((size, item) => size + Buffer.byteLength(item.text), 0)).toBeLessThanOrEqual(16000);
    expect(params.initialItems.at(-1)?.text).not.toContain("�");
  });
  it("maps live events and context usage to Office identity, never a foreign session", async () => {
    const f = fixture(), id = await session(f); f.store.get(id).codexThreadId = "native-own-thread";
    const controls = new CodexSessionControls(f.store, () => [], { settings: f.store });
    expect(f.store.handle({ method: "turn/started", params: { threadId: "foreign", turn: { id: "bad" } } })).toBeNull();
    const frame = f.store.handle({ method: "thread/tokenUsage/updated", params: { threadId: "native-own-thread", tokenUsage: { last: { inputTokens: 120 }, modelContextWindow: 1000 } } });
    controls.handle(frame); expect(controls.snapshot(id).tokenUsage.last.inputTokens).toBe(120);
  });
  it("keeps project/session operations in Office storage and deduplicates creation", async () => {
    const f = fixture(), id = await session(f);
    const again = await f.store.createSession({ name: "Own chat", projectId: f.store.projects()[0].id, requestId: "session" }); expect(again.threadId).toBe(id);
    await f.store.renameSession({ threadId: id, name: "Renamed", requestId: "rename" });
    await f.store.archiveSession({ threadId: id, requestId: "archive" });
    await expect(f.store.archiveSession({ threadId: id, requestId: "archive" })).resolves.toEqual({ threadId: id, archived: true });
    expect(f.store.list()).toEqual([]); expect(f.client.call).not.toHaveBeenCalled();
  });
  it("archives the mapped Codex thread once before removing the Office session", async () => {
    const f = fixture(), id = await session(f);
    Object.assign(f.store.get(id), { codexThreadId: "native-own-thread", hasTurns: true });
    const input = { threadId: id, requestId: "archive-mapped" };
    await expect(f.store.archiveSession(input)).resolves.toEqual({ threadId: id, archived: true });
    await f.store.archiveSession(input);
    expect(f.client.call.mock.calls).toEqual([["thread/archive", { threadId: "native-own-thread" }]]);
    expect(f.store.list()).toEqual([]);
  });
  it("keeps a busy or uncertain archive visible and does not retry the same request", async () => {
    const f = fixture(), id = await session(f);
    Object.assign(f.store.get(id), { codexThreadId: "native-own-thread", hasTurns: true, status: "running" });
    await expect(f.store.archiveSession({ threadId: id, requestId: "archive-busy" })).rejects.toThrow("Stop");
    expect(f.client.call).not.toHaveBeenCalled();
    f.store.get(id).status = "idle";
    f.client.call.mockRejectedValueOnce(new Error("response lost"));
    const input = { threadId: id, requestId: "archive-uncertain" };
    await expect(f.store.archiveSession(input)).rejects.toThrow("response lost");
    expect(() => f.store.archiveSession(input)).toThrow("check the result before retrying");
    expect(f.client.call).toHaveBeenCalledTimes(1);
    expect(f.store.list().map((row: { id: string }) => row.id)).toEqual([id]);
  });
  it("grants only the requested permissions for this turn, and grants nothing when declined", async () => {
    const f = fixture(), id = await session(f), controls = new CodexSessionControls(f.store, () => [], { settings: f.store });
    const permissions = { network: { enabled: true } };
    controls.handle({ id: 9, method: "item/permissions/requestApproval", params: { threadId: id, turnId: "turn", permissions } });
    expect(controls.snapshot(id).approvals[0].supported).toBe(true);
    controls.reply(id, "9", "accept"); expect(f.client.respond).toHaveBeenCalledWith(9, { permissions, scope: "turn" });
    controls.handle({ id: 10, method: "item/permissions/requestApproval", params: { threadId: id, turnId: "turn", permissions } });
    controls.reply(id, "10", "decline"); expect(f.client.respond).toHaveBeenCalledWith(10, { permissions: {}, scope: "turn" });
  });
  it("references canonical existing folders, groups chats and changes primary only for new chats", async () => {
    const f = fixture(), b = path.join(f.root, "repo-b"); mkdirSync(b);
    const alias = path.join(f.root, "alias"); symlinkSync(b, alias);
    const { project } = await f.store.createProject({ name: "Multi", rootPaths: [f.workspace, b, alias], requestId: "multi" });
    expect(project.rootPaths).toEqual([realpathSync(f.workspace), realpathSync(b)]);
    const { threadId } = await f.store.createSession({ name: "First", projectId: project.id, requestId: "first" });
    await f.store.updateProject({ projectId: project.id, name: "Multi", rootPaths: [b, f.workspace], requestId: "primary" });
    expect(f.store.get(threadId).workspace).toBe(realpathSync(f.workspace));
    const next = await f.store.createSession({ name: "Second", projectId: project.id, requestId: "second" });
    expect(f.store.get(next.threadId).workspace).toBe(realpathSync(b));
    expect(f.store.inspectProject(project.id).sessions).toHaveLength(2);
    expect(() => f.store.createProject({ name: "Missing", rootPaths: [path.join(f.root, "missing")], requestId: "missing" })).toThrow();
  });
  it("changes context and permissions on the next turn without restarting or replacing the Codex chat", async () => {
    const f = fixture(), id = await session(f), b = path.join(f.root, "repo-b"); mkdirSync(b);
    const row = f.store.get(id), project = f.store.projects()[0];
    row.codexThreadId = "existing"; row.hasTurns = true;
    await f.store.call("turn/start", { threadId: id, input: [{ type: "text", text: "first" }] });
    await f.store.updateProject({ projectId: project.id, name: project.name, rootPaths: [f.workspace, b], requestId: "add" });
    await f.store.call("turn/start", { threadId: id, input: [{ type: "text", text: "second" }] });
    const injections = f.client.call.mock.calls.filter(([method]) => method === "thread/inject_items");
    expect(JSON.stringify(injections.at(-1))).toContain(realpathSync(b));
    expect(f.client.call).toHaveBeenLastCalledWith("turn/start", expect.objectContaining({ threadId: "existing", cwd: realpathSync(f.workspace), sandboxPolicy: expect.objectContaining({ writableRoots: [realpathSync(f.workspace), realpathSync(b)] }) }));
    await f.store.updateProject({ projectId: project.id, name: project.name, rootPaths: [f.workspace], requestId: "remove" });
    await f.store.call("turn/start", { threadId: id, input: [] });
    expect(f.client.call).toHaveBeenLastCalledWith("turn/start", expect.objectContaining({ sandboxPolicy: expect.objectContaining({ writableRoots: [realpathSync(f.workspace)] }) }));
    expect(f.client.call.mock.calls.some(([method]) => method === "thread/start")).toBe(false);
  });
  it("requires an explicit idle-chat replacement when removing its cwd and preserves history identity", async () => {
    const f = fixture(), id = await session(f), b = path.join(f.root, "repo-b"); mkdirSync(b);
    const row = f.store.get(id), project = f.store.projects()[0]; row.codexThreadId = "same-history";
    await expect(f.store.updateProject({ projectId: project.id, name: "Work", rootPaths: [b], requestId: "no-choice" })).rejects.toThrow("replacement");
    expect(project.rootPaths).toEqual([realpathSync(f.workspace)]);
    f.store.isBusy = () => true;
    await expect(f.store.updateProject({ projectId: project.id, name: "Work", rootPaths: [b], workspaces: { [id]: realpathSync(b) }, requestId: "busy" })).rejects.toThrow("Stop");
    f.store.isBusy = () => false;
    await f.store.updateProject({ projectId: project.id, name: "Work", rootPaths: [b], workspaces: { [id]: realpathSync(b) }, requestId: "replace" });
    expect(row).toMatchObject({ workspace: realpathSync(b), codexThreadId: "same-history" });
    expect(new CodexOfficeStore(f.directory, f.client).get(id).workspace).toBe(realpathSync(b));
  });
  it("keeps a dispatch's folder context and policy together across concurrent project edits", async () => {
    const f = fixture(), id = await session(f), b = path.join(f.root, "repo-b"); mkdirSync(b);
    const row = f.store.get(id), project = f.store.projects()[0]; row.codexThreadId = "existing";
    await f.store.updateProject({ projectId: project.id, name: "Before", rootPaths: [f.workspace, b], requestId: "add" });
    let release!: () => void;
    f.client.call.mockImplementationOnce(async () => new Promise<Record<string, never>>(resolve => { release = () => resolve({}); }));
    const pending = f.store.call("turn/start", { threadId: id, input: [] });
    await Promise.resolve(); await Promise.resolve();
    await f.store.updateProject({ projectId: project.id, name: "After", rootPaths: [f.workspace], requestId: "remove" });
    release(); await pending;
    expect(f.client.call).toHaveBeenLastCalledWith("turn/start", expect.objectContaining({ sandboxPolicy: expect.objectContaining({ writableRoots: [realpathSync(f.workspace), realpathSync(b)] }) }));
    await f.store.call("turn/start", { threadId: id, input: [] });
    expect(f.client.call).toHaveBeenLastCalledWith("turn/start", expect.objectContaining({ sandboxPolicy: expect.objectContaining({ writableRoots: [realpathSync(f.workspace)] }) }));
  });

});
