// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { CodexSessionRefresh } = require("../../server/codex-session-refresh.js");
const { conversations, forTurn } = require("../../server/codex-conversations.js");
const { refreshIntent } = require("../../server/codex-refresh-intent.js");
function fixture() {
  const row = { id: "employee", name: "Worker", codexThreadId: "old", settings: { model: null, effort: null, accessMode: ":workspace" }, workspace: "/work", projectId: "project", recovery: { stopped: true }, refreshOperations: {}, conversationVersion: 1 };
  const saved = { id: row.id, revision: 4, sections: { focus: "Current decision", decisions: "Reason", followUp: "", links: "task source" } };
  const state = { turnStateKnown: true, turnStatus: "completed", lastTurnId: "turn", turnVersion: 3, inputStopVersion: 0, pendingSends: 0 };
  const store = { data: { sessions: [row] }, get: (id: string) => { if (id !== row.id) throw new Error("missing"); return row; }, save: vi.fn(), companyContext: () => ({ role: "worker" }), todoContext: () => ({ tasks: [] }), sessionFolders: () => ["/work"], starting: new Set(), inflight: new Map(), mutableOperations: new Map() };
  const controls = { state: () => state, attach: vi.fn(async () => {}), refreshTurn: vi.fn(async () => {}), approvalCount: () => 0, questions: () => [] };
  Object.assign(store, { pendingQuestions: () => [] });
  const native = { ready: true, scopeGeneration: 1, call: vi.fn(async (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (method === "thread/turns/list") return { data: params.threadId === "old" ? [{ id: "turn", status: "completed" }] : [], nextCursor: null };
    if (method === "thread/resume") return { model: "pinned", modelProvider: "openai", reasoningEffort: "high" };
    if (method === "thread/start") return { thread: { id: "new" }, model: "pinned", modelProvider: "openai", reasoningEffort: "high" };
    if (method === "thread/inject_items") return {};
    throw new Error("Unexpected model execution: " + method);
  }) };
  const facts = vi.fn((): string[] => []), committed = vi.fn(), context = { tools: [], packet: () => ({ items: [{ type: "developerMessage", content: [{ type: "text", text: "Identity + State only" }] }] }), taskIds: () => ["task"], taskRelated: () => false };
  const options = { store, controls, native, facts, committed, context, states: { read: () => saved, context: () => saved } };
  const refresh = new CodexSessionRefresh(options);
  const input = { threadId: row.id, requestId: "refresh-request", mode: "manual", expectedVersion: 1, stateRevision: 4, stateVerified: true, noUntrackedWork: true, noPendingReports: true };
  return { row, saved, state, store, controls, native, facts, committed, context, options, refresh, input };
}
describe("identity-preserving session refresh", () => {
  it.each([0, 5])("allows empty State revision %s for manual and explicit automatic refresh without State review", async revision => {
    for (const mode of ["manual", "automatic"]) {
      const f = fixture(); f.saved.revision = revision;
      f.saved.sections = { focus: "", decisions: "", followUp: "", links: "" };
      const input = { ...f.input, stateRevision: revision, stateVerified: undefined };
      expect((await f.refresh.status(f.row.id)).blockers).toEqual([]);
      const cp = mode === "automatic" ? f.refresh.checkpoint({ ...input, requestId: "checkpoint", turnId: "turn", closedScope: { kind: "conversation" } }) : null;
      expect(await f.refresh.refresh({ ...input, mode, ...(cp ? { checkpointId: cp.id, independentNewTopic: true, triggerRequestId: "one-message" } : {}) })).toMatchObject({ status: "completed" });
      expect(f.row.codexThreadId).toBe("new");
    }
  });
  it.each(["task", "message", "voice", "terminal", "unknown execution", "missing declaration", "invalid State"])("empty State still blocks %s", async reason => {
    const f = fixture(); f.saved.revision = 0; f.saved.sections = { focus: "", decisions: "", followUp: "", links: "" };
    const input = { ...f.input, stateRevision: 0, stateVerified: undefined };
    if (["task", "message", "voice", "terminal"].includes(reason)) f.facts.mockReturnValue([reason]);
    if (reason === "unknown execution") f.state.turnStateKnown = false;
    if (reason === "invalid State") {
      f.options.states.read = () => { throw Error("invalid"); };
      expect((await f.refresh.status(f.row.id)).blockers).toContain("Agent State is unavailable or invalid");
    }
    expect(await f.refresh.refresh({ ...input, ...(reason === "missing declaration" ? { noPendingReports: false } : {}) })).toMatchObject({ status: reason === "invalid State" ? "failed" : "blocked" });
    expect(f.native.call).not.toHaveBeenCalled();
  });
  it("MCP accepts zero State revision and does not require legacy State-review attestation", () => {
    const { tools } = require("../../server/office-todo-mcp.js");
    for (const name of ["session_refresh", "session_refresh_checkpoint"]) {
      const tool = tools.find((t: {name: string}) => t.name === name);
      expect(tool.inputSchema.properties.stateRevision.minimum).toBe(0);
      expect(tool.inputSchema.required).not.toContain("stateVerified");
      expect(tool.inputSchema.required).toContain("noPendingReports");
    }
  });
  it("atomically retains old history and identity, pins effective settings and injects only the clean context", async () => {
    const f = fixture(), before = structuredClone(f.row);
    const result = await f.refresh.refresh(f.input);
    expect(result).toMatchObject({ status: "completed", conversationVersion: 2, oldHistoryReadable: true, oldConversationUsable: false });
    expect(f.row).toMatchObject({ id: before.id, name: before.name, projectId: before.projectId, settings: before.settings, workspace: before.workspace, codexThreadId: "new", conversationVersion: 2, recovery: { stopped: true }, previousConversations: [{ nativeThreadId: "old", version: 1, turnIds: ["turn"] }] });
    expect(f.native.call).toHaveBeenCalledWith("thread/start", expect.objectContaining({ model: "pinned", modelProvider: "openai", approvalPolicy: "on-request", sandbox: "workspace-write", config: { model_reasoning_effort: "high", sandbox_workspace_write: { writable_roots: ["/work"], network_access: false } } }));
    expect(f.native.call.mock.calls.map(([m]) => m)).not.toContain("turn/start");
    expect(forTurn(f.row, "turn").nativeThreadId).toBe("old"); expect(forTurn(f.row, "new-turn").nativeThreadId).toBe("new");
    expect(f.committed).toHaveBeenCalledOnce(); expect(f.refresh.held(f.row.id)).toBe(false);
  });
  it("returns the original durable receipt after lost acknowledgement without another candidate", async () => {
    const f = fixture(), first = await f.refresh.refresh(f.input); f.native.call.mockClear();
    expect(await new CodexSessionRefresh(f.options).refresh(Object.fromEntries(Object.entries(f.input).reverse()))).toEqual(first); expect(f.native.call).not.toHaveBeenCalled();
    await expect(f.refresh.refresh({ ...f.input, stateRevision: 5 })).rejects.toThrow("conflicts");
  });
  it("deduplicates concurrent identical operations and fences only their employee", async () => {
    const f = fixture(), one = f.refresh.refresh(f.input), two = f.refresh.refresh(f.input);
    expect(f.refresh.held(f.row.id)).toBe(true); expect(f.refresh.held("other")).toBe(false);
    expect(f.refresh.sendAllowed(f.row.id, "message")).toBe(false);
    expect(await f.refresh.refresh({ ...f.input, requestId: "other" })).toMatchObject({ status: "blocked" });
    expect(await one).toEqual(await two); expect(f.native.call.mock.calls.filter(([m]) => m === "thread/start")).toHaveLength(1);
  });
  it.each(["Stop", "State", "model", "generation", "task", "turn"])("rejects preparation when %s changes, retaining the old usable conversation", async change => {
    const f = fixture(), call = f.native.call.getMockImplementation()!;
    f.native.call.mockImplementation(async (m, p) => { const result = await call(m, p); if (m === "thread/inject_items") {
      if (change === "Stop") f.refresh.cancel(f.row.id);
      if (change === "State") f.saved.revision++;
      if (change === "model") f.row.settings.model = "changed" as never;
      if (change === "generation") f.native.scopeGeneration++;
      if (change === "task") f.refresh.workChanged("task", {});
      if (change === "turn") f.state.turnVersion++;
    } return result; });
    expect(await f.refresh.refresh(f.input)).toMatchObject({ status: "failed", oldConversationUsable: true });
    expect(f.row.codexThreadId).toBe("old"); expect(f.committed).not.toHaveBeenCalled();
  });
  it.each(["active", "unknown", "send", "approval", "pending", "State", "facts", "mutation"])("blocks %s before creating a native candidate", async blocker => {
    const f = fixture();
    if (blocker === "active") Object.assign(f.state, { activeTurnId: "active" });
    if (blocker === "unknown") f.state.turnStateKnown = false;
    if (blocker === "send") f.state.pendingSends++;
    if (blocker === "approval") f.controls.approvalCount = () => 1;
    if (blocker === "pending") f.store.starting.add(f.row.id);
    if (blocker === "State") f.saved.revision = 0;
    if (blocker === "facts") f.facts.mockReturnValue(["pending employee report"]);
    if (blocker === "mutation") f.store.mutableOperations.set(f.row.id, new Set(["settings"]));
    expect(await f.refresh.refresh(f.input)).toMatchObject({ status: "blocked" }); expect(f.native.call).not.toHaveBeenCalled();
  });
  it("rolls back the in-memory mapping after a failed atomic save; never deletes old history", async () => {
    const f = fixture(); f.store.save.mockImplementation(() => { if (f.row.codexThreadId === "new") throw new Error("disk full"); });
    expect(await f.refresh.refresh(f.input)).toMatchObject({ status: "failed", oldConversationUsable: true });
    expect(f.row.codexThreadId).toBe("old"); expect(f.row.conversationVersion).toBe(1); expect(f.committed).not.toHaveBeenCalled();
  });
  it("records unknown candidate-creation result and never replays it on restart", async () => {
    const f = fixture(), call = f.native.call.getMockImplementation()!;
    f.native.call.mockImplementation(async (m, p) => { if (m === "thread/start") throw new Error("transport lost"); return call(m, p); });
    const result = await f.refresh.refresh(f.input); expect(result).toMatchObject({ status: "uncertain" });
    f.native.call.mockClear(); expect(await new CodexSessionRefresh(f.options).refresh(f.input)).toEqual(result); expect(f.native.call).not.toHaveBeenCalled();
  });
  it("interrupted preparation stays old-current after restart, without starting or sending anything", () => {
    const f = fixture(); Object.assign(f.row.refreshOperations, { lost: { id: "lost", status: "preparing", oldNativeThreadId: "old" } });
    new CodexSessionRefresh(f.options); expect(f.row.refreshOperations).toMatchObject({ lost: { status: "uncertain", oldConversationUsable: true } }); expect(f.native.call).not.toHaveBeenCalled();
  });
  it("rejects Stop or a new conversation while a user's earlier authentication read is pending", () => {
    const f = fixture(), boundary = f.refresh.inputBoundary(f.row.id);
    f.state.inputStopVersion++; expect(() => f.refresh.assertInputBoundary(f.row.id, boundary)).toThrow("Stop cancelled");
    f.state.inputStopVersion--; f.row.conversationVersion++; expect(() => f.refresh.assertInputBoundary(f.row.id, boundary)).toThrow("Conversation changed");
  });
  it("retains Stop cancellation even when the fresh readiness read also finds a blocker", async () => {
    const f = fixture(); let release!: () => void;
    f.controls.attach.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const result = f.refresh.refresh(f.input); f.refresh.cancel(f.row.id); f.state.pendingSends = 1; release();
    expect(await result).toMatchObject({ status: "failed", triggerCancelled: true, oldConversationUsable: true });
    expect(f.native.call).not.toHaveBeenCalled();
  });
  it("requires factual gates again after candidate injection", async () => {
    const f = fixture(), call = f.native.call.getMockImplementation()!;
    f.native.call.mockImplementation(async (m, p) => { const result = await call(m, p); if (m === "thread/inject_items") f.facts.mockReturnValue(["new inbox input"]); return result; });
    expect(await f.refresh.refresh(f.input)).toMatchObject({ status: "failed" }); expect(f.row.codexThreadId).toBe("old");
  });
  it("requires an explicit current checkpoint and one exact next-topic request; reserves only that dispatch", async () => {
    const f = fixture(); const cp = f.refresh.checkpoint({ ...f.input, requestId: "checkpoint", turnId: "turn", closedScope: { kind: "conversation" } });
    const p = { ...f.input, mode: "automatic", checkpointId: cp.id, independentNewTopic: true, triggerRequestId: "one-message" };
    expect(await f.refresh.refresh(p)).toMatchObject({ status: "completed" });
    expect(f.refresh.sendAllowed(f.row.id, "another")).toBe(false); expect(f.refresh.sendAllowed(f.row.id, "one-message")).toBe(true);
    f.refresh.claimTrigger(f.row.id, "one-message", "batch");
    expect(f.refresh.sendAllowed(f.row.id, "one-message")).toBe(false); expect(f.refresh.sendAllowed(f.row.id, "batch")).toBe(true);
    expect(() => f.refresh.claimTrigger(f.row.id, "one-message", "second-batch")).toThrow("must not be replayed");
    const restart = new CodexSessionRefresh(f.options); expect(restart.sendAllowed(f.row.id, "another")).toBe(false);
    restart.settleTrigger(f.row.id, "batch"); expect(restart.sendAllowed(f.row.id, "another")).toBe(true);
  });
  it.each(["missing", "revision", "config", "turn", "failed", "not-independent"])("does not auto refresh with a %s checkpoint boundary", async boundary => {
    const f = fixture(); const cp = f.refresh.checkpoint({ ...f.input, requestId: "checkpoint", turnId: "turn", closedScope: { kind: "conversation" } });
    if (boundary === "revision") f.saved.sections.focus = "changed without same revision";
    if (boundary === "config") f.row.name = "Renamed";
    if (boundary === "turn") f.state.lastTurnId = "next-turn";
    if (boundary === "failed") f.state.turnStatus = "failed";
    expect(await f.refresh.refresh({ ...f.input, mode: "automatic", checkpointId: boundary === "missing" ? "absent" : cp.id, independentNewTopic: boundary !== "not-independent", triggerRequestId: "message" })).toMatchObject({ status: "blocked" });
    expect(f.native.call).not.toHaveBeenCalled();
  });
  it("Stop cancels the exact next-input reservation without rolling back a committed mapping", async () => {
    const f = fixture(), cp = f.refresh.checkpoint({ ...f.input, requestId: "checkpoint", turnId: "turn", closedScope: { kind: "conversation" } });
    await f.refresh.refresh({ ...f.input, mode: "automatic", checkpointId: cp.id, independentNewTopic: true, triggerRequestId: "message" });
    f.refresh.cancel(f.row.id); expect(f.refresh.sendAllowed(f.row.id, "another")).toBe(true); expect(f.row.codexThreadId).toBe("new");
    expect(f.row.refreshOperations).toMatchObject({ "refresh-request": { triggerCancelled: true } });
  });
  it("fails closed on malformed retained history instead of associating another employee's turn", () => {
    const f = fixture(); Object.assign(f.row, { conversationVersion: 2, previousConversations: [{ version: 1, nativeThreadId: "old", turnIds: "corrupt" }] });
    expect(() => conversations(f.row)).toThrow("invalid"); expect(() => forTurn(f.row, "turn")).toThrow("invalid");
  });
  it("does not infer topic intent from prose or accept additional metadata", () => {
    expect(refreshIntent(undefined)).toBeUndefined();
    expect(() => refreshIntent({ independentNewTopic: true })).toThrow();
    expect(() => refreshIntent({ checkpointId: "cp", independentNewTopic: true, prompt: "new task" })).toThrow();
    expect(refreshIntent({ checkpointId: "cp", independentNewTopic: true })).toEqual({ checkpointId: "cp", independentNewTopic: true });
  });
});

describe("version-bound reads and dispatch", () => {
  const { CodexOfficeStore } = require("../../server/codex-office-store.js");
  const { CodexSessionControls } = require("../../server/codex-session-controls.js");
  const { loadConversationHistoryPage } = require("../../server/codex-session-history.js");
  const deferred = () => { let resolve!: (v: unknown) => void, reject!: (e: Error) => void; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
  function reads() {
    const row = { id: "employee", codexThreadId: "new", conversationVersion: 2, historyEpoch: "new-epoch", status: "idle", hasTurns: false, settings: { accessMode: ":workspace" }, previousConversations: [{ version: 1, nativeThreadId: "old", historyEpoch: "old-epoch", turnIds: ["old-turn"] }] };
    const store = Object.assign(Object.create(CodexOfficeStore.prototype), { data: { sessions: [row], projects: [] }, client: { ready: true, call: vi.fn(async () => ({ data: [], nextCursor: "more" })) }, starting: new Set(), save: vi.fn() });
    const controls = { state: () => ({ historyEpoch: row.historyEpoch }) }, userSends = { observe: vi.fn() };
    return { row, store, controls, userSends, options: { store, controls, userSends } };
  }
  it("binds opaque history cursors to their version and never observes old history into the current user journal", async () => {
    const f = reads();
    const old = await loadConversationHistoryPage(f.options, f.row.id, undefined, undefined, 1);
    expect(old).toMatchObject({ readOnly: true, conversationVersion: 1 }); expect(f.userSends.observe).not.toHaveBeenCalled();
    await loadConversationHistoryPage(f.options, f.row.id, old.nextCursor, undefined, 1);
    expect(f.store.client.call).toHaveBeenLastCalledWith("thread/timeline/list", expect.objectContaining({ threadId: "old", cursor: "more" }));
    await expect(loadConversationHistoryPage(f.options, f.row.id, old.nextCursor)).rejects.toThrow("another conversation version");
    await expect(loadConversationHistoryPage(f.options, f.row.id, "legacy-native-cursor")).rejects.toThrow("another conversation version");
    await loadConversationHistoryPage(f.options, f.row.id); expect(f.userSends.observe).toHaveBeenCalledOnce();
  });
  it.each([false, true])("does not apply a stale native read or its missing-rollout failure (error=%s) to a refreshed employee", async failure => {
    const f = reads(), wait = deferred(); f.store.client.call.mockImplementation(() => wait.promise);
    const pending = f.store.call("thread/turns/list", { threadId: f.row.id, limit: 1 });
    f.row.codexThreadId = "newer"; f.row.conversationVersion++; f.row.historyEpoch = "next";
    if (failure) wait.reject(new Error("no rollout found")); else wait.resolve({ data: [{ id: "old-turn", status: "inProgress" }] });
    await expect(pending).rejects.toMatchObject({ code: "SESSION_VERSION_CHANGED" });
    expect(f.row.codexThreadId).toBe("newer"); expect(f.row.status).toBe("idle"); expect(f.store.save).not.toHaveBeenCalled();
  });
  it("rejects edits/mutations on retained versions and filters old-native events", async () => {
    const f = reads();
    await expect(f.store.call("turn/start", { threadId: f.row.id, conversationVersion: 1 })).rejects.toThrow("read-only");
    expect(f.store.handle({ method: "turn/started", params: { threadId: "old", turn: { id: "late" } } })).toBeNull();
    expect(f.row.status).toBe("idle"); expect(f.store.client.call).not.toHaveBeenCalled();
  });
  it("blocks direct user, urgent, Continue and automatic sends at their shared admission point", async () => {
    const client = { ready: true, call: vi.fn() }, controls = new CodexSessionControls(client, () => [], { refreshBlocked: () => true });
    await expect(controls.send("employee", "text", "id", [], { userSend: {} })).rejects.toMatchObject({ code: "SESSION_REFRESHING" });
    for (const options of [{}, { resumeInterrupted: true }, { onlyIfIdle: false }, { automaticRetry: {} }]) {
      expect(await controls.send("employee", "text", "id", [], options)).toMatchObject({ status: options.automaticRetry ? "cancelled" : "busy" });
    }
    expect(client.call).not.toHaveBeenCalled(); controls.close();
  });
  it("ignores late attachment/turn reads after a new native version and keeps original settings", async () => {
    let version = 1; const wait = deferred(); const client = { ready: true, call: vi.fn((m: string) => m === "thread/resume" ? wait.promise : Promise.resolve({ data: [] })) };
    const controls = new CodexSessionControls(client, () => [], { conversationVersion: () => version });
    const before = controls.state("employee"); before.settings = { model: "original" }; const attaching = controls.attach("employee");
    version++; controls.refreshed("employee", "new-epoch"); wait.resolve({ model: "stale", reasoningEffort: "low" }); await attaching;
    expect(controls.state("employee")).toMatchObject({ settings: { model: "original" }, historyEpoch: "new-epoch", activeTurnId: null });
    expect(controls.state("employee")).not.toBe(before); controls.close();
  });
});
