import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { officeEnvironment } = require("../../server/codex-office-client.js");
const { CodexOfficeStore } = require("../../server/codex-office-store.js");
const { CodexSessionControls } = require("../../server/codex-session-controls.js");
const { DEPARTMENT_HEAD_GUIDELINE } = require("../../server/office-head-guideline.js");
const { ceo: CEO_ID } = require("../../src/lib/office/identities.json");
const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "office-state-test-")); roots.push(root);
  const workspace = path.join(root, "workspace"); mkdirSync(workspace);
  const client = { ready: true, respond: vi.fn(), call: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method: string) => {
    if (method === "model/list") return { data: [{ model: "model-a", displayName: "A", supportedReasoningEfforts: [{ reasoningEffort: "high" }], defaultReasoningEffort: "high" }] };
    if (method === "permissionProfile/list") return { data: [{ id: ":workspace", allowed: true }, { id: ":read-only", allowed: true }, { id: ":danger-full-access", allowed: true }] };
    if (method === "thread/start") return { thread: { id: "native-own-thread" }, model: "model-a" };
    if (["thread/turns/list", "thread/timeline/list"].includes(method)) return { data: [], nextCursor: null };
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
  it("keeps purpose metadata outside native requests and tags both start and steer acknowledgements", async () => {
    const f = fixture(), id = await session(f), capture = vi.fn(); f.store.onTurnDispatch = capture;
    await f.store.call("turn/start", { threadId: id, input: [] }, { purpose: "automation", trigger: "schedule", originId: "run" });
    expect(capture).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "start", usage: { purpose: "automation", trigger: "schedule", originId: "run" } }));
    f.client.call.mockResolvedValueOnce({ turnId: "turn-1" });
    await f.store.call("turn/steer", { threadId: id, expectedTurnId: "turn-1", input: [] }, { purpose: "chat_work" });
    expect(capture).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "steer", turnId: "turn-1", usage: { purpose: "chat_work" } }));
    expect(JSON.stringify(f.client.call.mock.calls)).not.toMatch(/automation|chat_work|originId/);
    expect(f.client.call.mock.calls.every(call => call.length === 2)).toBe(true);
  });
  it("captures immutable dispatch IDs for optional telemetry without adding a native request or blocking chat", async () => {
    const f = fixture(), id = await session(f);
    let task = "original-task"; const answering = ["q-original"];
    f.store.todoContext = () => ({ todoId: task });
    f.store.questionContext = () => ({ answering });
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; }), original = f.client.call.getMockImplementation()!;
    f.client.call.mockImplementation(async (method, params) => { if (method === "turn/start") await gate; return original(method, params); });
    const capture = vi.fn(() => { throw new Error("Telemetry unavailable"); }); f.store.onTurnDispatch = capture;
    const pending = f.store.call("turn/start", { threadId: id, input: [] });
    await vi.waitFor(() => expect(f.client.call.mock.calls.some(([method]) => method === "turn/start")).toBe(true));
    task = "new-task"; answering.push("q-later"); release(); await pending;
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ taskId: "original-task", questionIds: ["q-original"], nativeThreadId: "native-own-thread", turnId: "turn-1" }));
    expect(f.client.call.mock.calls.map(([method]) => method)).not.toContain("thread/read");
  });
  it("persists the first attempted turn before dispatch but skips unchanged later writes", async () => {
    const f = fixture(), id = await session(f);
    const original = f.client.call.getMockImplementation()!;
    f.client.call.mockImplementation(async (method, params) => {
      if (method === "turn/start") expect(JSON.parse(readFileSync(path.join(f.directory, "office.json"), "utf8")).sessions.find((row: { id: string }) => row.id === id).attemptedTurn).toBe(true);
      return original(method, params);
    });
    const save = vi.spyOn(f.store, "save");
    await f.store.call("turn/start", { threadId: id, input: [] }); expect(save.mock.calls.length).toBeGreaterThan(0);
    save.mockClear(); await f.store.call("turn/start", { threadId: id, input: [] }); expect(save).not.toHaveBeenCalled();
  });
  it("refreshes task context on an existing thread when work switches without resetting native settings", async () => {
    const f = fixture(), id = await session(f);
    let todoId = "first";
    f.store.todoContext = (agentId: string) => ({ protocol: 1, agentId, todoId });
    await f.store.call("turn/start", { threadId: id, input: [{ type: "text", text: "Work" }] });
    todoId = "second";
    await f.store.call("turn/start", { threadId: id, input: [{ type: "text", text: "Continue" }] });
    const injections = f.client.call.mock.calls.filter(([method]) => method === "thread/inject_items");
    expect(injections).toHaveLength(2);
    expect(JSON.stringify(injections[1])).toContain("second");
    expect(JSON.stringify(injections[1])).not.toContain("Office task workflow:");
    expect(f.client.call.mock.calls.filter(([method]) => method === "thread/start")).toHaveLength(1);
  });

  it.each(["Head", "Manager", "主管", "经理", "部门经理"])("includes the shared guideline for the current %s role in the existing developer context", async title => {
    const f = fixture(), id = await session(f);
    const company = { agentId: id, title, canRecruit: false, directReports: [] };
    f.store.companyContext = vi.fn(() => company);
    await f.store.call("turn/start", { threadId: id, input: [] });
    const injection = f.client.call.mock.calls.find(([method]) => method === "thread/inject_items")![1] as { items: Array<{ role: string; content: Array<{ text: string }> }> };
    expect(injection.items).toHaveLength(1); expect(injection.items[0].role).toBe("developer");
    const text = injection.items[0].content[0].text;
    expect(JSON.parse(text.split("\n")[1]).company).toEqual(company);
    expect(text.endsWith("\n" + DEPARTMENT_HEAD_GUIDELINE)).toBe(true);
    expect(text.split(DEPARTMENT_HEAD_GUIDELINE)).toHaveLength(2);
    expect(text).toContain("inactive for other roles or unavailable role data");
    expect(text).toContain("replaces earlier Head role definitions");
    expect(DEPARTMENT_HEAD_GUIDELINE.split(/\s+/)).toHaveLength(107);
    expect(f.store.companyContext).toHaveBeenCalledExactlyOnceWith(id);
    expect(f.client.call.mock.calls.map(([method]) => method)).toEqual(["thread/start", "thread/inject_items", "turn/start"]);
  });

  it.each([
    { title: "Worker", canRecruit: true, directReports: [{ id: "report" }] },
    { title: "CEO", canRecruit: true, directReports: [{ id: "report" }] },
    { title: "Head", unavailable: true },
    { canRecruit: true },
    { title: null },
    { title: 42 },
    null,
  ])("does not infer a Head role from unavailable or non-Head company data: %j", async company => {
    const f = fixture(), id = await session(f); f.store.companyContext = () => company;
    await f.store.call("turn/start", { threadId: id, input: [] });
    expect(JSON.stringify(f.client.call.mock.calls)).not.toContain(DEPARTMENT_HEAD_GUIDELINE);
  });

  it("excludes the CEO identity even if its reported title is Head", async () => {
    const f = fixture(); f.store.ensureCeo();
    f.store.companyContext = () => ({ agentId: CEO_ID, title: "Head" });
    await f.store.call("turn/start", { threadId: CEO_ID, input: [] });
    expect(JSON.stringify(f.client.call.mock.calls)).not.toContain(DEPARTMENT_HEAD_GUIDELINE);
  });

  it("reuses the Head context hash on the second turn and after a store restart", async () => {
    const f = fixture(), id = await session(f);
    const companyContext = vi.fn(() => ({ agentId: id, title: "Head" })); f.store.companyContext = companyContext;
    const injections = () => f.client.call.mock.calls.filter(([method]) => method === "thread/inject_items");
    await f.store.call("turn/start", { threadId: id, input: [] });
    const hash = f.store.get(id).projectContext;
    await f.store.call("turn/start", { threadId: id, input: [] });
    const restored = new CodexOfficeStore(f.directory, f.client); restored.companyContext = companyContext;
    await restored.call("turn/start", { threadId: id, input: [] });
    expect(injections()).toHaveLength(1); expect(restored.get(id).projectContext).toBe(hash);
    expect(companyContext).toHaveBeenCalledTimes(3);
    expect(f.client.call.mock.calls.map(([method]) => method)).toEqual(["thread/start", "thread/inject_items", "turn/start", "turn/start", "turn/start"]);
  });

  it("captures the Head role with company JSON before awaiting native startup, then removes it on demotion", async () => {
    const f = fixture(), id = await session(f), company = { agentId: id, title: "Head" };
    f.store.companyContext = vi.fn(() => company);
    const original = f.client.call.getMockImplementation()!;
    f.client.call.mockImplementation(async (method, params) => {
      if (method === "thread/start") company.title = "Worker";
      return original(method, params);
    });
    const injections = () => f.client.call.mock.calls.filter(([method]) => method === "thread/inject_items");
    await f.store.call("turn/start", { threadId: id, input: [] });
    const first = JSON.stringify(injections()[0]); expect(first).toContain(DEPARTMENT_HEAD_GUIDELINE); expect(first).not.toContain("Worker");
    const headHash = f.store.get(id).projectContext;
    await f.store.call("turn/start", { threadId: id, input: [] });
    expect(JSON.stringify(injections()[1])).toContain("Worker"); expect(JSON.stringify(injections()[1])).not.toContain(DEPARTMENT_HEAD_GUIDELINE);
    expect(f.store.get(id).projectContext).not.toBe(headHash);
    await f.store.call("turn/start", { threadId: id, input: [] }); expect(injections()).toHaveLength(2);
    expect(f.store.companyContext).toHaveBeenCalledTimes(3);
  });

  it("refreshes legacy cached context once, then reuses it on subsequent turns", async () => {
    const f = fixture(), id = await session(f);
    f.store.companyContext = () => ({ agentId: id, title: "Head" });
    await f.store.call("turn/start", { threadId: id, input: [] });
    const injections = () => f.client.call.mock.calls.filter(([method]) => method === "thread/inject_items");
    const payload = (injections()[0][1] as { items: Array<{ content: Array<{ text: string }> }> }).items[0].content[0].text;
    // Previous releases cached only this JSON, excluding workflow instructions.
    const legacy = payload.split("\n").find(line => line.startsWith('{"project":'));
    expect(legacy).toBeTruthy(); f.store.get(id).projectContext = legacy; f.store.save();
    const restored = new CodexOfficeStore(f.directory, f.client);
    restored.companyContext = f.store.companyContext;
    await restored.call("turn/start", { threadId: id, input: [] });
    expect(injections()).toHaveLength(2);
    expect(JSON.stringify(injections()[1])).toContain("Current Office project context");
    expect(JSON.stringify(injections()[1])).not.toContain("Office question workflow:");
    await restored.call("turn/start", { threadId: id, input: [] });
    expect(injections()).toHaveLength(2);
  });

  it("batches independently cached Q and project context without queries or repeated organization data", async () => {
    const f = fixture(), id = await session(f);
    let title = "Head", summary = "First question";
    f.store.companyContext = () => ({ agentId: id, title });
    f.store.questionContext = () => ({ context: { questions: [{ id: "q-current", summary }] } });
    const injections = () => f.client.call.mock.calls.filter(([method]) => method === "thread/inject_items");
    await f.store.call("turn/start", { threadId: id, input: [] });
    expect((injections()[0][1] as { items: unknown[] }).items).toHaveLength(2);
    await f.store.call("turn/start", { threadId: id, input: [] }); expect(injections()).toHaveLength(1);
    summary = "Second question";
    await f.store.call("turn/start", { threadId: id, input: [] });
    expect((injections()[1][1] as { items: unknown[] }).items).toHaveLength(1);
    expect(JSON.stringify(injections()[1])).toContain("Second question");
    expect(JSON.stringify(injections()[1])).not.toContain('company');
    expect(JSON.stringify(injections()[1])).not.toContain('workingDirectory');
    title = "Changed Head";
    await f.store.call("turn/start", { threadId: id, input: [] });
    expect(JSON.stringify(injections()[2])).toContain("Changed Head");
    expect(JSON.stringify(injections()[2])).not.toContain("Second question");
    const restored = new CodexOfficeStore(f.directory, f.client);
    restored.companyContext = f.store.companyContext; restored.questionContext = f.store.questionContext;
    await restored.call("turn/start", { threadId: id, input: [] }); expect(injections()).toHaveLength(3);
    expect(f.client.call.mock.calls.every(([method]) => ["thread/start", "thread/inject_items", "turn/start"].includes(method))).toBe(true);
  });

  it("forwards an explicit historical fork boundary to Codex once and keeps the source configuration",async()=>{
    const f=fixture(),id=await session(f),source=f.store.get(id);
    Object.assign(source,{codexThreadId:"native-own-thread",hasTurns:true});source.settings.model="custom-model";
    f.client.call.mockResolvedValueOnce({thread:{id:"native-past-fork"}});
    const input={threadId:id,lastTurnId:"completed-past-turn",requestId:"fork-past"};
    const result=await f.store.forkSession(input);expect(await f.store.forkSession(input)).toEqual(result);
    expect(f.client.call.mock.calls).toEqual([["thread/fork",{threadId:"native-own-thread",lastTurnId:"completed-past-turn",excludeTurns:true,deferGoalContinuation:true}]]);
    expect(f.store.get(result.threadId)).toMatchObject({codexThreadId:"native-past-fork",workspace:source.workspace,projectId:source.projectId,settings:source.settings});
    expect(f.store.get(result.threadId).settings).not.toBe(source.settings);
  });
  it("rejects invalid historical boundaries and never falls back to cloning later context after a native rejection",async()=>{
    const f=fixture(),id=await session(f);
    expect(()=>f.store.forkSession({threadId:id,lastTurnId:"past",requestId:"empty"})).toThrow("completed turn");
    Object.assign(f.store.get(id),{codexThreadId:"native-own-thread",hasTurns:true});
    for(const lastTurnId of [null,"",123])expect(()=>f.store.forkSession({threadId:id,lastTurnId,requestId:"invalid"})).toThrow("completed turn");
    f.client.call.mockRejectedValueOnce(new Error("The referenced turn cannot be in progress"));
    await expect(f.store.forkSession({threadId:id,lastTurnId:"running",requestId:"running"})).rejects.toThrow("in progress");
    expect(f.client.call).toHaveBeenCalledTimes(1);expect(f.store.list()).toHaveLength(1);
  });
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
  it("keeps structured async questions in Office state and streams them across restart", async () => {
    const f = fixture(), id = await session(f); f.store.get(id).codexThreadId = "native-own-thread";
    const controls = new CodexSessionControls(f.store, (threadId: string) => f.store.pendingQuestions(threadId), { settings: f.store });
    const event = { method: "item/completed", params: { threadId: "native-own-thread", turnId: "t", item: { id: "prompt", type: "agentMessage", delivery: "async", questions: [{ title: "Choose?", options: ["First", "Second"] }], text: "Choose?" } } };
    controls.handle(f.store.handle(event));
    expect(controls.snapshot(id).questions[0].questions[0].options).toEqual([{ label: "First" }, { label: "Second" }]);
    const restarted = new CodexOfficeStore(f.directory, f.client);
    expect(restarted.pendingQuestions(id)).toEqual(f.store.pendingQuestions(id));
    f.store.handle(event); expect(f.store.pendingQuestions(id)).toHaveLength(1);
    f.store.clearQuestions(id, ["async:prompt"]); expect(f.store.pendingQuestions(id)).toEqual([]);
  });
  it("recovers legacy Office questions from the first bounded public latest-turn read", async () => {
    const f = fixture(), id = await session(f); Object.assign(f.store.get(id), { codexThreadId: "native-own-thread", hasTurns: true });
    f.client.call.mockResolvedValue({ data: [{ id: "t", status: "completed", items: [{ type: "agentMessage", id: "old-prompt", delivery: "async", questions: [{ title: "Still pending?" }] }] }] });
    await f.store.call("thread/turns/list", { threadId: id, limit: 1, itemsView: "notLoaded", sortDirection: "desc" });
    expect(f.client.call).toHaveBeenLastCalledWith("thread/turns/list", { threadId: "native-own-thread", limit: 1, itemsView: "full", sortDirection: "desc" });
    expect(f.store.pendingQuestions(id)[0].requestId).toBe("async:old-prompt");
    await f.store.call("thread/turns/list", { threadId: id, limit: 1, itemsView: "notLoaded", sortDirection: "desc" });
    expect(f.client.call).toHaveBeenLastCalledWith("thread/turns/list", expect.objectContaining({ itemsView: "notLoaded" }));
  });
  it("marks only completed results as candidates for browser unread badges", async () => {
    const f = fixture(), id = await session(f); f.store.get(id).codexThreadId = "native-own-thread";
    const event = (method: string, status: string) => f.store.handle({ method, params: { threadId: "native-own-thread", turn: { id: "t", status } } });
    event("turn/completed", "completed"); expect(f.store.list()[0].completedResult).toEqual({ key: "t", unread: true });
    event("turn/started", "inProgress"); expect(f.store.list()[0].completedResult).toBeNull();
    event("turn/completed", "interrupted"); expect(f.store.list()[0].completedResult).toBeNull();
    event("turn/completed", "failed"); expect(f.store.list()[0]).toMatchObject({ status: "error", completedResult: null });
  });
  it("reconciles a task interrupted by a backend restart using the owner's public latest-turn read", async () => {
    const f = fixture(), id = await session(f); Object.assign(f.store.get(id), { codexThreadId: "native-own-thread", hasTurns: true, status: "unknown", completionKey: "stale-result" });
    f.client.call.mockResolvedValue({ data: [{ id: "stopped", status: "interrupted", items: [] }] });
    await f.store.call("thread/turns/list", { threadId: id, limit: 1, itemsView: "notLoaded", sortDirection: "desc" });
    expect(f.store.list()[0]).toMatchObject({ status: "error", turnStatus: "interrupted", completedResult: null });
    expect(f.store.list()[0]).not.toHaveProperty("pendingQuestions");
  });
  it("restores persisted running tasks without opening the chat, then continues in the original thread", async () => {
    const f = fixture(), id = await session(f);
    Object.assign(f.store.get(id), { codexThreadId: "native-own-thread", hasTurns: true, status: "running" }); f.store.save();
    const restarted = new CodexOfficeStore(f.directory, f.client);
    f.client.call.mockImplementation(async (method: string) => method === "thread/turns/list"
      ? { data: [{ id: "stopped", status: "interrupted", items: [] }] }
      : method === "turn/start" ? { turn: { id: "continued" } } : {});
    const controls = new CodexSessionControls(restarted);
    await controls.refreshTurn(id);
    expect(f.client.call).not.toHaveBeenCalledWith("thread/resume", expect.anything());
    expect(restarted.list()[0]).toMatchObject({ status: "error", turnStatus: "interrupted", completedResult: null });
    expect(controls.snapshot(id)).toMatchObject({ activeTurnId: null, turnStatus: "interrupted" });
    await controls.send(id, "Continue where you left off.", "resume-after-restart", [], { resumeInterrupted: true });
    expect(f.client.call).toHaveBeenCalledWith("turn/start", expect.objectContaining({ threadId: "native-own-thread" }));
    restarted.handle({ method: "turn/started", params: { threadId: "native-own-thread", turn: { id: "continued" } } });
    expect(restarted.list()[0]).toMatchObject({ status: "running", turnStatus: "inProgress" });
  });
  it("keeps a newly started turn when an older history read finishes", async () => {
    const f = fixture(), id = await session(f);
    Object.assign(f.store.get(id), { codexThreadId: "native-own-thread", hasTurns: true, status: "running", turnStatus: "inProgress", lastTurnId: "old" });
    f.client.call.mockImplementation(async () => {
      f.store.handle({ method: "turn/started", params: { threadId: "native-own-thread", turn: { id: "new" } } });
      return { data: [{ id: "old", status: "interrupted", items: [] }] };
    });
    await f.store.call("thread/turns/list", { threadId: id, limit: 1, itemsView: "notLoaded", sortDirection: "desc" });
    expect(f.store.list()[0]).toMatchObject({ status: "running", turnStatus: "inProgress", lastTurnId: "new" });
  });
  it("persists the automatic recovery budget in Office state across store and controller reconstruction", async () => {
    vi.useFakeTimers();
    const f = fixture(), id = await session(f);
    let store = f.store, controls: InstanceType<typeof CodexSessionControls>;
    Object.assign(store.get(id), { codexThreadId: "native-own-thread", hasTurns: true });
    let latest = { id: "initial", status: "failed", error: { message: "Any provider failure" } }, starts = 0;
    const emit = () => controls.handle(store.handle({ method: latest.status === "inProgress" ? "turn/started" : "turn/completed", params: { threadId: "native-own-thread", turn: latest } }));
    const makeControls = () => new CodexSessionControls(store, () => [], { recovery: {
      read: () => store.get(id).recovery,
      write: (_id: string, recovery: unknown) => { store.get(id).recovery = recovery; store.save(); },
    } });
    f.client.call.mockImplementation(async method => {
      if (method === "thread/turns/list") return { data: [latest] };
      if (method === "turn/start") { latest = { ...latest, id: `retry-${++starts}`, status: "inProgress" }; emit(); return { turn: latest }; }
      return {};
    });
    controls = makeControls();
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        await controls.recover(id); await vi.advanceTimersByTimeAsync(15000);
        expect(starts).toBe(attempt);
        latest = { ...latest, status: "failed" }; emit(); controls.close();
        expect(JSON.parse(readFileSync(store.file, "utf8")).sessions[0].recovery.attempts).toBe(attempt);
        store = new CodexOfficeStore(f.directory, f.client); controls = makeControls();
      }
      await controls.recover(id); await vi.advanceTimersByTimeAsync(60000);
      expect(starts).toBe(3); expect(controls.snapshot(id).retryExhausted).toBe(true);
      expect(f.client.call.mock.calls.filter(([m]) => m === "turn/start").every(([, p]) => JSON.stringify(p).includes("native-own-thread"))).toBe(true);
    } finally { controls.close(); vi.useRealTimers(); }
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
    expect(f.client.call).toHaveBeenCalledWith("thread/start", expect.objectContaining({ cwd: realpathSync(f.workspace), sandbox: "read-only", approvalPolicy: "on-request", model: "model-a", dynamicTools: [expect.objectContaining({ name: "office" })] }));
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
    f.client.call.mockImplementation(async (method: string) => method === "thread/timeline/list" ? { data: [
      { id: "user", type: "userMessage", content: [{ type: "text", text: "Current request" }] },
      { id: "commentary", type: "agentMessage", phase: "commentary", text: "PRIVATE_WORK_LOG" },
      { id: "answer", type: "agentMessage", phase: "final", text: "中".repeat(8000) },
    ].map(item => ({ type: "item", turnId: "turn", item })), nextCursor: null } : {});
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
