// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { OfficeTodos, activeDelegation } = require("../../server/office-todos");
const { CodexOfficeStore } = require("../../server/codex-office-store");
const { CodexSessionControls } = require("../../server/codex-session-controls");
const { OfficeCompany } = require("../../server/office-company");
const { OfficeDelegation } = require("../../server/office-delegation");
const { WORKFLOW } = require("../../server/office-company");
const { ceo: CEO } = require("../../src/lib/office/identities.json");
const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })); });
async function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "phase-runtime-")); roots.push(root);
  const workspace = path.join(root, "work"); mkdirSync(workspace);
  let now = 1000, serial = 0;
  const client = { ready: true, call: vi.fn(async (method: string) => method === "thread/start" ? { thread: { id: `native-${++serial}` } } : method === "turn/start" ? { turn: { id: `turn-${++serial}` } } : {}) };
  const store = new CodexOfficeStore(path.join(root, "office"), client); store.ensureCeo();
  const make = async (name: string) => (await store.createSession({ name, workspace, requestId: name })).threadId;
  const owner = await make("Owner"), a = await make("A"), b = await make("B"), c = await make("C");
  const file = path.join(root, "settings.json");
  writeFileSync(file, JSON.stringify({ office: { "ws://localhost:18790": { organization: { [CEO]: { title: "CEO", reportsTo: [] }, [owner]: { title: "Head", reportsTo: [CEO] }, [a]: { title: "Head", reportsTo: [owner] }, [b]: { title: "Worker", reportsTo: [owner] }, [c]: { title: "Worker", reportsTo: [a] } } } } }));
  const company = new OfficeCompany(store, { settingsFile: file });
  const deps = { projects: () => store.projects(), agents: () => store.list(), now: () => now };
  const todos = new OfficeTodos(path.join(root, "office"), deps);
  store.todoContext = (id: string) => todos.context(id); store.companyContext = (id: string) => company.forTurn(id);
  const controls = new CodexSessionControls(store);
  store.onTurnDispatch = (value: { agentId: string; turnId: string }) => {
    const state = controls.state(value.agentId); todos.recordTurn(value, state.lastTurnId === value.turnId ? state : store.get(value.agentId));
  };
  const nativeFrame = (method: string, agentId: string, turnId: string, status = "completed") => {
    const mapped = store.handle({ method, params: { threadId: store.get(agentId).codexThreadId, turn: { id: turnId, status } } });
    controls.handle(mapped);
    if (method === "turn/completed") todos.finishTurn(mapped.params.threadId, mapped.params.turn.status, mapped.params.turn.id);
  };
  const available = new Map<string, boolean>();
  const send = vi.fn(async (id: string, message: string, requestId: string, context: unknown, usage: unknown) => {
    const result = await store.call("turn/start", { threadId: id, input: [{ type: "text", text: message }] }, usage);
    return { status: "started", turnId: result.turn.id };
  });
  const runtime = new OfficeDelegation({ store, todos, company, canSend: async (id: string) => available.get(id) !== false && todos.phaseScope(id)?.phase.startedAt == null, canRecall: async () => true, send });
  const task = todos.create({ requestId: "task", actorId: owner, title: "Shared work", executionMode: "phases", phases: [{ title: "Teaser", assigneeId: a }, { title: "Clone", assigneeId: b }, { title: "Verify", assigneeId: owner }] }).todo;
  const [pa, pb, pc] = task.phases.map((p: { id: string }) => p.id);
  const input = (phaseId: string, actorId = owner, extra = {}) => ({ id: task.id, phaseId, actorId, revision: todos.raw(task.id).revision, requestId: crypto.randomUUID(), ...extra });
  const delegate = (phaseId: string, assigneeId: string, actorId = owner) => runtime.delegate(input(phaseId, actorId, { assigneeId, instructions: "Bounded work", acceptanceCriteria: "Evidence" }));
  const entry = (phaseId: string) => activeDelegation(todos.raw(task.id), phaseId);
  const phase = (phaseId: string) => todos.raw(task.id).phases.find((p: { id: string }) => p.id === phaseId);
  const submit = (phaseId: string, actorId: string) => runtime.submit(input(phaseId, actorId, { handoffId: entry(phaseId).id, report: `Evidence for ${phaseId}` }));
  const review = (phaseId: string, actorId = owner, accept = true) => runtime.review(input(phaseId, actorId, { handoffId: entry(phaseId).id, accept, notes: "Verified evidence" }));
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
  return { root, store, client, company, todos, deps, runtime, nativeFrame, owner, a, b, c, task, pa, pb, pc, input, delegate, entry, phase, submit, review, available, send, settle, advance: (ms: number) => { now += ms; } };
}
describe("independent phase execution through actual dispatch callbacks", () => {
  it("keeps phase sender provenance for owner handoff, worker report and human return", async () => {
    const f = await fixture(); await f.delegate(f.pa, f.a);
    expect(f.entry(f.pa).delivery.sender).toEqual({ source: "agent", id: f.owner, name: "Owner" });
    expect(f.send.mock.calls.at(-1)![1].split("\n")[0]).toBe("**From agent: Owner**");
    await f.submit(f.pa, f.a); await f.settle();
    expect(f.send.mock.calls.at(-1)![1].split("\n")[0]).toBe("**From agent: A**");
    await f.runtime.review(f.input(f.pa, f.owner, { actorId: undefined, handoffId: f.entry(f.pa).id, accept: false, notes: "One missing fact" }));
    expect(f.entry(f.pa).delivery.sender).toEqual({ source: "user", name: "User" });
    expect(f.send.mock.calls.at(-1)![1].split("\n")[0]).toBe("**From: User**");
  });
  it("lets a directly assigned worker start its phase without a Head handoff or an extra model message", async () => {
    const f = await fixture();
    f.todos.change(f.input(f.pa, f.a), "start");
    expect(f.send).not.toHaveBeenCalled(); expect(f.client.call).not.toHaveBeenCalled();
    expect(f.phase(f.pa).activity).toMatchObject({ agentId: f.a, role: "self", handoffId: null });
    expect(f.todos.context(f.a)).toMatchObject({ todoId: f.task.id, runningPhaseId: f.pa, assigneeId: f.a, handlingAgentId: f.a });
    expect(f.todos.context(f.owner).todoId).toBeNull();
    await f.store.call("turn/start", { threadId: f.a, input: [] });
    const turnId = f.phase(f.pa).activity.turnId;
    expect(turnId).toMatch(/^turn-/); expect(f.entry(f.pa)).toBeUndefined();
    f.advance(700); f.nativeFrame("turn/completed", f.a, turnId);
    expect(f.phase(f.pa)).toMatchObject({ status: "paused", elapsedMs: 700 });
    expect(WORKFLOW).toContain("Direct user instructions authorize the addressed agent");
    expect(WORKFLOW).not.toContain("target is not your direct report, explain the routing gap");
  });
  it.each(["owner", "user"])("allows %s coordination of an explicitly assigned non-direct employee without manufacturing a handoff", async actor => {
    const f = await fixture(), row = f.todos.raw(f.task.id);
    f.todos.change({ id: row.id, revision: row.revision, phases: row.phases.map((p: { id: string; title: string; assigneeId: string }) => ({ id: p.id, title: p.title, assigneeId: p.id === f.pa ? f.c : p.assigneeId })) }, "edit");
    await f.runtime.run({ ...f.input(f.pa), actorId: actor === "owner" ? f.owner : undefined });
    expect(f.send).toHaveBeenCalledTimes(1); expect(f.send.mock.calls[0][0]).toBe(f.c);
    expect(f.phase(f.pa).activity).toMatchObject({ agentId: f.c, role: "self", handoffId: null });
    expect(f.todos.raw(f.task.id).delegations).toBeUndefined();
    expect(f.todos.context(f.c).todoId).toBe(f.task.id); expect(f.todos.context(f.owner).todoId).toBeNull();
    const injection = f.client.call.mock.calls.find(c => c[0] === "thread/inject_items");
    expect(JSON.stringify(injection)).toContain(f.pa);
    expect(f.todos.raw(f.task.id).events.at(-1).actor).toMatchObject(actor === "owner" ? { source: "agent", id: f.owner } : { source: "user" });
  });
  it("invalidates old activity on a paused reassignment, preserves the new identity across restart and ignores old turn callbacks", async () => {
    const f = await fixture(); await f.runtime.run(f.input(f.pa));
    const old = structuredClone(f.phase(f.pa).activity); f.advance(400);
    f.todos.change(f.input(f.pa, f.a), "pause");
    const row = f.todos.raw(f.task.id);
    f.todos.change({ id: row.id, revision: row.revision, phases: row.phases.map((p: { id: string; title: string; assigneeId: string }) => ({ id: p.id, title: p.title, assigneeId: p.id === f.pa ? f.b : p.assigneeId })) }, "edit");
    expect(f.phase(f.pa).activity).toBeUndefined(); expect(f.todos.context(f.a).todoId).toBeNull();
    f.advance(100); f.todos.change(f.input(f.pa, f.b), "start");
    await f.store.call("turn/start", { threadId: f.b, input: [] });
    const current = structuredClone(f.phase(f.pa));
    f.nativeFrame("turn/completed", f.a, old.turnId);
    f.todos.recordTurn({ agentId: f.a, taskId: f.task.id, phaseId: f.pa, activityId: old.requestId, activityRole: old.role, handoffId: null, turnId: "late-ack" });
    expect(f.phase(f.pa)).toEqual(current);
    f.advance(600); f.todos.checkpoint();
    const restored = new OfficeTodos(path.join(f.root, "office"), f.deps);
    expect(restored.context(f.b)).toMatchObject({ todoId: f.task.id, runningPhaseId: f.pa, assigneeId: f.b, handlingAgentId: f.b });
    expect(restored.context(f.a).todoId).toBeNull(); expect(restored.context(f.owner).todoId).toBeNull();
    expect(restored.raw(f.task.id).phases[0]).toMatchObject({ elapsedMs: 1000, startedAt: null, activity: { agentId: f.b, turnId: current.activity.turnId } });
  });
  it("does not let Owner coordination replace a running direct worker's phase", async () => {
    const f = await fixture(); f.todos.change(f.input(f.pa, f.a), "start");
    const before = structuredClone(f.phase(f.pa));
    await expect(f.delegate(f.pa, f.b)).rejects.toThrow(/Pause this phase/);
    await expect(f.runtime.run(f.input(f.pa))).rejects.toThrow(/busy/);
    expect(f.phase(f.pa)).toEqual(before); expect(f.send).not.toHaveBeenCalled();
  });
  it("ignores an old direct dispatch ACK after a paused reassignment and a new worker starts", async () => {
    const f = await fixture(), original = f.send.getMockImplementation()!;
    let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
    f.send.mockImplementation(async (...args) => { const result = await original(...args); if (args[0] === f.a) await gate; return result; });
    const first = f.runtime.run(f.input(f.pa));
    await vi.waitFor(() => expect(f.phase(f.pa).activity?.turnId).toBeTruthy());
    f.todos.change(f.input(f.pa, f.a), "pause"); const row = f.todos.raw(f.task.id);
    f.todos.change({ id: row.id, revision: row.revision, phases: row.phases.map((p: { id: string; title: string; assigneeId: string }) => ({ id: p.id, title: p.title, assigneeId: p.id === f.pa ? f.b : p.assigneeId })) }, "edit");
    await f.runtime.run(f.input(f.pa)); const current = structuredClone(f.phase(f.pa));
    release(); await first;
    expect(f.phase(f.pa)).toEqual(current); expect(f.phase(f.pa).activity.agentId).toBe(f.b);
    expect(f.entry(f.pa)).toBeUndefined(); expect(f.send).toHaveBeenCalledTimes(2);
  });
  it("delivers A and B concurrently to real fixture sessions, preserves B when A pauses/accepts, and never starts C", async () => {
    const f = await fixture();
    await f.delegate(f.pa, f.a); await f.delegate(f.pb, f.b);
    expect(f.send.mock.calls.map(c => c[0])).toEqual([f.a, f.b]);
    expect(f.client.call.mock.calls.map(c => c[0])).toEqual(["thread/start", "thread/inject_items", "turn/start", "thread/start", "thread/inject_items", "turn/start"]);
    expect(f.phase(f.pa).activity.turnId).toMatch(/^turn-/); expect(f.phase(f.pb).activity.turnId).toMatch(/^turn-/);
    expect(f.todos.context(f.a)).toMatchObject({ todoId: f.task.id, runningPhaseId: f.pa, handoffId: f.entry(f.pa).id });
    const b = structuredClone(f.phase(f.pb)); f.available.set(f.owner, false); f.advance(2000);
    await f.submit(f.pa, f.a); await f.settle();
    expect(f.phase(f.pb)).toEqual(b); expect(f.phase(f.pa).status).toBe("review");
    await f.review(f.pa); expect(f.phase(f.pa).status).toBe("done"); expect(f.phase(f.pb)).toEqual(b); expect(f.phase(f.pc).status).toBe("queued");
    expect(f.todos.raw(f.task.id).status).toBe("running"); expect(f.todos.list({ assigneeId: f.b }).todos).toHaveLength(1);
    expect(f.todos.raw(f.task.id).assigneeId).toBeNull();
  });
  it("keeps two busy-manager reports durable and delivers each separately after the manager becomes idle", async () => {
    const f = await fixture(); await f.delegate(f.pa, f.a); await f.delegate(f.pb, f.b); f.available.set(f.owner, false);
    await f.submit(f.pa, f.a); await f.submit(f.pb, f.b); await f.settle();
    expect([f.entry(f.pa).delivery.state, f.entry(f.pb).delivery.state]).toEqual(["pending", "pending"]);
    f.available.set(f.owner, true); await f.runtime.flush();
    const first = f.todos.phaseScope(f.owner); expect(first).toBeTruthy();
    f.todos.finishTurn(f.owner, "completed", first.phase.activity.turnId); await f.runtime.flush();
    expect([f.entry(f.pa).delivery.state, f.entry(f.pb).delivery.state]).toEqual(["sent", "sent"]);
    const reports = f.send.mock.calls.filter(c => c[0] === f.owner).map(c => c[1]); expect(reports).toHaveLength(2); expect(reports[0]).not.toBe(reports[1]);
  });
  it("uses task CAS and exact handoff IDs, while unrelated metadata edits do not stop running stages", async () => {
    const f = await fixture(); await f.delegate(f.pa, f.a); await f.delegate(f.pb, f.b);
    const stale = f.input(f.pa, f.a), b = structuredClone(f.phase(f.pb));
    f.todos.change({ id: f.task.id, revision: stale.revision, actorId: f.c, documentation: "Allowed member edit" }, "edit");
    expect(f.phase(f.pb)).toEqual(b);
    expect(() => f.todos.change(stale, "pause")).toThrow(/changed/);
    f.todos.change(f.input(f.pa, f.a), "pause"); expect(f.phase(f.pb)).toEqual(b);
    await expect(f.runtime.submit(f.input(f.pa, f.a, { handoffId: f.entry(f.pb).id, report: "Wrong scope" }))).rejects.toThrow(/exact/);
    expect(() => f.todos.change(f.input(f.pb, f.b), "complete")).toThrow(/acceptance/);
    expect(() => f.todos.change({ id: f.task.id, revision: f.todos.raw(f.task.id).revision, actorId: f.owner }, "start")).toThrow(/explicit/);
  });
  it("guards late turns and async receipts after a scoped switch, checkpoint and restart", async () => {
    const f = await fixture(); await f.delegate(f.pa, f.a); await f.delegate(f.pb, f.b);
    const old = structuredClone(f.phase(f.pa).activity); f.advance(2000); f.todos.checkpoint(); f.advance(500);
    f.todos.change(f.input(f.pa, f.a), "pause");
    f.todos.startForAgent(f.a, f.task.id, f.pa, "new-attempt"); const current = structuredClone(f.phase(f.pa));
    f.todos.finishTurn(f.a, "completed", old.turnId); expect(f.phase(f.pa)).toEqual(current);
    f.todos.recordTurn({ agentId: f.a, taskId: f.task.id, phaseId: f.pa, activityId: old.requestId, handoffId: old.handoffId, activityRole: old.role, turnId: "late" }); expect(f.phase(f.pa)).toEqual(current);
    f.todos.checkpoint(); const saved = f.todos.raw(f.task.id); const restored = new OfficeTodos(path.join(f.root, "office"), f.deps);
    expect(restored.raw(f.task.id).phases.map((p: { startedAt: number | null }) => p.startedAt)).toEqual([null, null, null]);
    expect(restored.raw(f.task.id).phases.map((p: { elapsedMs: number }) => p.elapsedMs)).toEqual(saved.phases.map((p: { elapsedMs: number }) => p.elapsedMs));
    expect(restored.context(f.b).runningPhaseId).toBe(f.pb);
  });
  it("keeps nested acceptance in its own chain and archives on legitimate final acceptance without another parent approval", async () => {
    const f = await fixture(); await f.delegate(f.pa, f.a); await f.delegate(f.pa, f.c, f.a); f.available.set(f.a, false); f.available.set(f.owner, false);
    await f.submit(f.pa, f.c); await f.review(f.pa, f.a);
    expect(f.phase(f.pa).completedAt).toBeNull(); expect(f.entry(f.pa).workerId).toBe(f.a);
    await f.submit(f.pa, f.a); await f.review(f.pa);
    await f.delegate(f.pb, f.b); await f.submit(f.pb, f.b); await f.review(f.pb);
    f.todos.change(f.input(f.pc, f.owner), "complete");
    expect(f.todos.raw(f.task.id)).toMatchObject({ status: "done", archived: true });
    expect(f.todos.raw(f.task.id).phases).toHaveLength(3);
  });
  it("uses assigned execution without forced delegation, keeps human attribution and refuses busy dispatch", async () => {
    const f = await fixture();
    await f.runtime.run({ ...f.input(f.pc), actorId: undefined });
    expect(f.phase(f.pc).activity).toMatchObject({ agentId: f.owner, role: "self", handoffId: null });
    expect(f.todos.raw(f.task.id).events.at(-1).actor.source).toBe("user"); expect(f.todos.raw(f.task.id).delegations).toBeUndefined();
    f.available.set(f.a, false); await expect(f.delegate(f.pa, f.a)).rejects.toThrow(/busy/);
    f.available.set(f.a, true);
    f.todos.change(f.input(f.pc), "pause");
    await f.runtime.run({ ...f.input(f.pa), actorId: undefined });
    expect(f.todos.raw(f.task.id).events.at(-1).actor.source).toBe("user");
    expect(f.todos.raw(f.task.id).delegations).toBeUndefined();
    expect(f.phase(f.pc).startedAt).toBeNull();
    expect(f.send.mock.calls.at(-1)?.[4]).toMatchObject({ purpose: "collaboration_mixed", trigger: "todoRun" });
  });
  it("does not migrate old active tasks or invent completed phase assignees", async () => {
    const f = await fixture();
    const old = f.todos.create({ requestId: "legacy", actorId: f.owner, assigneeId: f.a, title: "Old", phases: [{ title: "Past" }, { title: "Future" }] }).todo;
    f.todos.change({ id: old.id, revision: old.revision, phaseId: old.phases[0].id }, "complete");
    expect(() => f.todos.change({ id: old.id, revision: f.todos.raw(old.id).revision, executionMode: "phases", phases: old.phases }, "edit")).toThrow(/pause/);
    f.todos.change({ id: old.id, revision: f.todos.raw(old.id).revision }, "pause");
    const before = structuredClone(f.todos.raw(old.id).phases[0]);
    f.todos.change({ id: old.id, revision: f.todos.raw(old.id).revision, executionMode: "phases", phases: f.todos.raw(old.id).phases.map((p: object, i: number) => ({ ...p, ...(i ? { assigneeId: f.b } : {}) })) }, "edit");
    expect(f.todos.raw(old.id).phases[0]).toMatchObject(before); expect(f.todos.raw(old.id).phases[0].assigneeId).toBeUndefined();
    expect(f.todos.list({ assigneeId: null }).todos.map((row: { id: string }) => row.id)).not.toContain(old.id);
  });
});

it("allows overlapping dispatch awaits and ignores an old ACK after its worker already submitted", async () => {
  const f = await fixture(), original = f.send.getMockImplementation()!;
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  f.send.mockImplementation(async (...args) => { const result = await original(...args); if (args[0] === f.a) await gate; return result; });
  const first = f.delegate(f.pa, f.a); await vi.waitFor(() => expect(f.phase(f.pa).activity?.turnId).toBeTruthy());
  await f.delegate(f.pb, f.b); expect(f.phase(f.pb).startedAt).not.toBeNull();
  f.available.set(f.owner, false); await f.submit(f.pa, f.a); await f.settle(); const delivery = structuredClone(f.entry(f.pa).delivery);
  release(); await first; expect(f.entry(f.pa).delivery).toEqual(delivery); expect(f.entry(f.pa).state).toBe("review"); expect(f.phase(f.pb).status).toBe("running");
});
it("preserves run operation IDs across changed scope and rejects a second active phase on the same employee", async () => {
  const f = await fixture(), operation = { ...f.input(f.pa), actorId: undefined };
  const first = await f.runtime.run(operation); const calls = f.send.mock.calls.length;
  expect(await f.runtime.run(operation)).toEqual(first); expect(f.send).toHaveBeenCalledTimes(calls);
  const row = f.todos.raw(f.task.id);
  f.todos.change({ id: row.id, revision: row.revision, phases: row.phases.map((p: { id: string; title: string }) => ({ id: p.id, title: p.title, ...(p.id === f.pb ? { assigneeId: f.a } : {}) })) }, "edit");
  await expect(f.delegate(f.pb, f.a)).rejects.toThrow(/already working/); expect(f.entry(f.pb)).toBeUndefined();
  f.todos.change(f.input(f.pa, f.a), "pause");
  const old = structuredClone(f.phase(f.pa).activity);
  const row2 = f.todos.raw(f.task.id);
  f.todos.change({ id: row2.id, revision: row2.revision, phases: row2.phases.map((p: { id: string; title: string; assigneeId: string }) => ({ id: p.id, title: p.title, assigneeId: p.id === f.pa ? f.b : p.assigneeId })) }, "edit");
  await f.runtime.run(f.input(f.pa));
  const active = structuredClone(f.phase(f.pa));
  f.todos.recordTurn({ agentId: f.a, taskId: f.task.id, phaseId: f.pa, activityId: old.requestId, activityRole: old.role, handoffId: old.handoffId, turnId: "late-turn" });
  f.todos.finishTurn(f.a, "completed", old.turnId);
  expect(f.phase(f.pa)).toEqual(active); expect(f.entry(f.pa)).toBeUndefined();
  expect(f.phase(f.pa).activity.agentId).toBe(f.b);
});
it("preserves uncertain requests without automatic replay, and validates phase state on restart", async () => {
  const f = await fixture(); f.send.mockRejectedValueOnce(new Error("Timed out after possible send"));
  const operation = { ...f.input(f.pa), actorId: undefined };
  await expect(f.runtime.run(operation)).rejects.toThrow(/Timed out/); const count = f.send.mock.calls.length;
  expect(f.entry(f.pa)).toBeUndefined(); await f.runtime.flush();
  await expect(f.runtime.run(operation)).rejects.toThrow(/submitted/); expect(f.send.mock.calls.length).toBe(count);
  const malformed = structuredClone(f.todos.raw(f.task.id)); malformed.phases[0].activity.role = "invented";
  writeFileSync(path.join(f.root, "office", "todos", f.task.id + ".json"), JSON.stringify(malformed));
  expect(() => new OfficeTodos(path.join(f.root, "office"), f.deps)).toThrow(/Invalid phase activity/);
});
it("keeps exact self phase focus even when two starts share the same clock tick", async () => {
  const f = await fixture(), row = f.todos.raw(f.task.id);
  f.todos.change({ id: row.id, revision: row.revision, phases: row.phases.map((p: { id: string; title: string }) => ({ id: p.id, title: p.title, ...(p.id === f.pa ? { assigneeId: f.owner } : {}) })) }, "edit");
  f.todos.startForAgent(f.owner, f.task.id, f.pa, "first"); f.todos.change(f.input(f.pa), "pause");
  f.todos.startForAgent(f.owner, f.task.id, f.pc, "second"); expect(f.todos.context(f.owner).runningPhaseId).toBe(f.pc);
});
it("pauses the exact phase if completion arrived before its send acknowledgement", async () => {
  const f = await fixture(), original = f.client.call.getMockImplementation()!;
  f.client.call.mockImplementation(async method => {
    const result = await original(method);
    if (method === "turn/start") {
      const turnId = (result as { turn: { id: string } }).turn.id;
      f.store.handle({ method: "turn/completed", params: { threadId: f.store.get(f.a).codexThreadId, turn: { id: turnId, status: "completed" } } });
      f.todos.finishTurn(f.a, "completed", turnId);
    }
    return result;
  });
  await f.delegate(f.pa, f.a); expect(f.phase(f.pa).startedAt).toBeNull(); expect(f.phase(f.pc).status).toBe("queued");
});
it("preserves the original acceptance manager when explicitly converting a paused historical task", async () => {
  const f = await fixture();
  const old = f.todos.create({ requestId: "old-manager", actorId: f.owner, assigneeId: f.owner, title: "Legacy authority", phases: [{ title: "Follow up" }] }).todo;
  f.todos.change({ id: old.id, revision: old.revision, actorId: f.owner, assigneeId: f.a, instructions: "Work", acceptanceCriteria: "Evidence" }, "delegate");
  f.todos.change({ id: old.id, revision: f.todos.raw(old.id).revision, actorId: f.a, report: "Evidence" }, "submit");
  f.todos.change({ id: old.id, revision: f.todos.raw(old.id).revision, actorId: f.owner, accept: true, notes: "Verified" }, "review");
  f.todos.change({ id: old.id, revision: f.todos.raw(old.id).revision, ownerId: f.a, executionMode: "phases", phases: [{ id: old.phases[0].id, title: "Follow up", assigneeId: f.owner }] }, "edit");
  expect(() => f.todos.change({ id: old.id, revision: f.todos.raw(old.id).revision, actorId: f.a, phaseId: old.phases[0].id }, "complete")).toThrow(/manager/);
  f.todos.change({ id: old.id, revision: f.todos.raw(old.id).revision, actorId: f.owner, phaseId: old.phases[0].id }, "complete");
  expect(f.todos.raw(old.id).archived).toBe(true);
});

it("lets an Owner run legacy work while its report executes a phase, at both legacy switching entry points", async () => {
  const f = await fixture(); await f.delegate(f.pa, f.a); const worker = structuredClone(f.phase(f.pa));
  const legacy = (name: string, agentId = f.owner) => f.todos.create({ requestId: name, title: name, actorId: agentId, assigneeId: agentId, phases: [{ title: "Execute" }] }).todo;
  const b = legacy("Legacy B"); f.todos.startForAgent(f.owner, b.id);
  expect(f.todos.raw(b.id).status).toBe("running"); expect(f.phase(f.pa)).toEqual(worker);
  const c = legacy("Legacy C"); f.todos.change({ id: c.id, revision: c.revision, actorId: f.owner }, "start");
  expect(f.todos.raw(c.id).status).toBe("running"); expect(f.todos.raw(b.id).status).toBe("paused"); expect(f.phase(f.pa)).toEqual(worker);
  const a = legacy("Legacy A", f.a);
  expect(() => f.todos.startForAgent(f.a, a.id)).toThrow(/already working on another phase/);
  expect(() => f.todos.change({ id: a.id, revision: a.revision, actorId: f.a }, "start")).toThrow(/already working on another phase/);
  expect(f.phase(f.pa)).toEqual(worker);
});
it.each(["before ACK", "after ACK"])("ignores an old phase completion %s of a later legacy dispatch through actual store callbacks", async order => {
  const f = await fixture(); await f.runtime.run(f.input(f.pc)); const oldTurn = f.phase(f.pc).activity.turnId;
  f.todos.change(f.input(f.pc), "pause");
  const legacy = f.todos.create({ requestId: "legacy-new", title: "Legacy", actorId: f.owner, assigneeId: f.owner, phases: [{ title: "Execute" }] }).todo;
  const complete = (turnId: string) => f.nativeFrame("turn/completed", f.owner, turnId);
  f.todos.startForAgent(f.owner, legacy.id, undefined, "legacy-dispatch");
  const original = f.client.call.getMockImplementation()!;
  f.client.call.mockImplementation(async method => {
    const result = await original(method);
    if (method === "turn/start") { f.nativeFrame("turn/started", f.owner, (result as { turn: { id: string } }).turn.id, "inProgress"); if (order === "before ACK") complete(oldTurn); }
    return result;
  });
  const result = await f.store.call("turn/start", { threadId: f.owner, input: [] });
  if (order === "after ACK") complete(oldTurn);
  expect(f.todos.context(f.owner).todoId).toBe(legacy.id); expect(f.todos.raw(legacy.id).status).toBe("running");
  expect(f.todos.raw(legacy.id).activity.turnId).toBe(result.turn.id);
  complete(result.turn.id); expect(f.todos.raw(legacy.id).status).toBe("paused"); expect(f.phase(f.pc).startedAt).toBeNull();
  expect(f.todos.context(f.owner).todoId).toBe(legacy.id);
});
it("records legacy completion before ACK, then rejects its old dispatch failure after another legacy switch", async () => {
  const f = await fixture(); await f.delegate(f.pa, f.a); const worker = structuredClone(f.phase(f.pa));
  await f.runtime.run(f.input(f.pc)); const oldPhaseTurn = f.phase(f.pc).activity.turnId; f.todos.change(f.input(f.pc), "pause");
  const create = (name: string) => f.todos.create({ requestId: name, title: name, actorId: f.owner, assigneeId: f.owner, phases: [{ title: "Execute" }] }).todo;
  const legacy = create("fast-legacy"), original = f.client.call.getMockImplementation()!;
  f.todos.startForAgent(f.owner, legacy.id, undefined, "fast-request");
  f.client.call.mockImplementation(async method => {
    const result = await original(method);
    if (method === "turn/start") {
      const turnId = (result as { turn: { id: string } }).turn.id;
      f.nativeFrame("turn/started", f.owner, turnId, "inProgress"); f.nativeFrame("turn/completed", f.owner, turnId);
      f.nativeFrame("turn/completed", f.owner, oldPhaseTurn);
    }
    return result;
  });
  await f.store.call("turn/start", { threadId: f.owner, input: [] });
  expect(f.todos.raw(legacy.id).status).toBe("paused"); expect(f.phase(f.pa)).toEqual(worker);
  const newer = create("newer-legacy"); f.todos.startForAgent(f.owner, newer.id, undefined, "new-request");
  f.runtime.pauseAttempt(legacy.id, undefined, f.owner, "fast-request", "Late old dispatch failure");
  expect(f.todos.raw(newer.id).status).toBe("running"); expect(f.phase(f.pa)).toEqual(worker);
});
it("changes local legacy dispatch identity without adding another context injection", async () => {
  const f = await fixture(), task = f.todos.create({ requestId: "legacy-context", title: "Legacy", actorId: f.owner, assigneeId: f.owner, phases: [{ title: "Execute" }] }).todo;
  f.todos.startForAgent(f.owner, task.id, undefined, "first-request");
  await f.store.call("turn/start", { threadId: f.owner, input: [] });
  const first = f.todos.raw(task.id).activity.turnId;
  f.todos.finishTurn(f.owner, "completed", first);
  f.todos.startForAgent(f.owner, task.id, undefined, "second-request");
  await f.store.call("turn/start", { threadId: f.owner, input: [] });
  expect(f.todos.raw(task.id).activity).toMatchObject({ requestId: "second-request" }); expect(f.todos.raw(task.id).activity.turnId).not.toBe(first);
  expect(f.client.call.mock.calls.map(c => c[0])).toEqual(["thread/start", "thread/inject_items", "turn/start", "turn/start"]);
  expect(JSON.stringify(f.client.call.mock.calls)).not.toContain("first-request"); expect(JSON.stringify(f.client.call.mock.calls)).not.toContain("second-request");
  const secondTurn = f.todos.raw(task.id).activity.turnId;
  f.todos.change({ id: task.id, revision: f.todos.raw(task.id).revision, actorId: f.owner }, "start");
  const context = f.todos.context(f.owner); expect(context.activityId).not.toBe("second-request");
  f.todos.recordTurn({ ...context, taskId: task.id, turnId: secondTurn }); f.todos.finishTurn(f.owner, "completed", secondTurn);
  expect(f.todos.raw(task.id).status).toBe("paused");
});

it.each([
  ["phase", "legacy", false], ["legacy", "phase", false],
  ["phase", "legacy", true], ["legacy", "phase", true],
  ["phase", "phase", true], ["legacy", "legacy", true],
] as const)("restores actual %s → %s activity consistently after restart (last paused=%s)", async (firstMode, lastMode, pauseLast) => {
  const f = await fixture();
  const start = async (mode: "phase" | "legacy", name: string) => {
    const task = f.todos.create({ requestId: name, title: name, actorId: f.owner, assigneeId: f.owner, ...(mode === "phase" ? { executionMode: "phases" } : {}), phases: [{ title: name, assigneeId: f.owner }] }).todo;
    f.todos.startForAgent(f.owner, task.id, mode === "phase" ? task.phases[0].id : undefined, name + "-dispatch");
    await f.store.call("turn/start", { threadId: f.owner, input: [] });
    return { task, phaseId: mode === "phase" ? task.phases[0].id : undefined };
  };
  const first = await start(firstMode, "first");
  f.advance(10); f.todos.change({ id: first.task.id, revision: f.todos.raw(first.task.id).revision, actorId: f.owner, phaseId: first.phaseId }, "pause");
  f.advance(100); const last = await start(lastMode, "last");
  if (pauseLast) f.todos.change({ id: last.task.id, revision: f.todos.raw(last.task.id).revision, actorId: f.owner, phaseId: last.phaseId }, "pause");
  // Later ordinary edits/assignment metadata on another task cannot steal focus.
  f.advance(1000); f.todos.change({ id: first.task.id, revision: f.todos.raw(first.task.id).revision, documentation: "Later metadata edit", ownerId: f.owner }, "edit");
  const assertScope = (todos: InstanceType<typeof OfficeTodos>) => {
    expect(todos.context(f.owner).todoId).toBe(last.task.id); expect(todos.bound(f.owner)?.id).toBe(last.task.id);
    expect(todos.phaseScope(f.owner)?.phase.id).toBe(last.phaseId);
    expect(todos.context(f.owner).runningPhaseId).toBe(last.phaseId);
    expect(todos.context(f.owner).activityRole).toBe(lastMode === "phase" ? "self" : "legacy");
  };
  assertScope(f.todos); f.todos.checkpoint();
  const times = f.todos.raw(last.task.id).phases.map((p: { elapsedMs: number }) => p.elapsedMs);
  const restored = new OfficeTodos(path.join(f.root, "office"), f.deps); assertScope(restored);
  expect(restored.raw(last.task.id).phases.map((p: { elapsedMs: number }) => p.elapsedMs)).toEqual(times);
  expect(restored.raw(last.task.id).phases.every((p: { startedAt: number | null }) => p.startedAt == null)).toBe(true);
  assertScope(new OfficeTodos(path.join(f.root, "office"), f.deps));
  const activity = lastMode === "phase" ? restored.raw(last.task.id).phases[0].activity : restored.raw(last.task.id).activity;
  restored.finishTurn(f.owner, "completed", firstMode === "phase" ? f.todos.raw(first.task.id).phases[0].activity.turnId : f.todos.raw(first.task.id).activity.turnId);
  expect(restored.context(f.owner).activityId).toBe(activity.requestId);
});
it.each(["legacy", "phase"] as const)("keeps equal-time phase/%s ambiguity unknown after restart, unless an exact explicit binding exists", async mode => {
  const f = await fixture(); await f.runtime.run(f.input(f.pc)); f.todos.change(f.input(f.pc), "pause");
  const other = f.todos.create({ requestId: "same-tick", title: "Same tick", actorId: f.owner, assigneeId: f.owner, ...(mode === "phase" ? { executionMode: "phases" } : {}), phases: [{ title: "Same tick", assigneeId: f.owner }] }).todo;
  const phaseId = mode === "phase" ? other.phases[0].id : undefined;
  f.todos.startForAgent(f.owner, other.id, phaseId, "second-tick"); await f.store.call("turn/start", { threadId: f.owner, input: [] });
  f.todos.change({ id: other.id, revision: f.todos.raw(other.id).revision, phaseId }, "pause");
  expect(f.todos.context(f.owner).todoId).toBe(other.id);
  const restored = new OfficeTodos(path.join(f.root, "office"), f.deps);
  // Even a newer unstarted legacy assignment must not break the actual tie.
  f.advance(100); restored.create({ requestId: "unstarted", actorId: f.owner, assigneeId: f.owner, title: "New metadata", phases: [{ title: "Plan" }] });
  const unknown = () => { expect(restored.context(f.owner).todoId).toBeNull(); expect(restored.bound(f.owner)).toBeNull(); expect(restored.phaseScope(f.owner)).toBeNull(); };
  unknown();
  restored.bindings.set(f.owner, { taskId: f.task.id, phaseId: f.pc, activityId: "wrong" }); unknown();
  restored.bindings.set(f.owner, { taskId: f.task.id, phaseId: f.pc, activityId: f.phase(f.pc).activity.requestId });
  expect(restored.context(f.owner)).toMatchObject({ todoId: f.task.id, runningPhaseId: f.pc }); expect(restored.bound(f.owner).id).toBe(f.task.id);
});
it("preserves old legacy-only resolution without activity, and leaves historical timing ties unknown", async () => {
  const f = await fixture();
  const create = (name: string) => f.todos.create({ requestId: name, title: name, actorId: f.owner, assigneeId: f.owner, phases: [{ title: "Execute" }] }).todo;
  const a = create("old-a"); expect(f.todos.bound(f.owner).id).toBe(a.id);
  const b = create("old-b"); expect(f.todos.bound(f.owner)).toBeNull();
  f.todos.startForAgent(f.owner, a.id); f.todos.change({ id: a.id, revision: f.todos.raw(a.id).revision }, "pause");
  f.advance(100); f.todos.startForAgent(f.owner, b.id); f.todos.change({ id: b.id, revision: f.todos.raw(b.id).revision }, "pause");
  for (const task of [a, b]) { const row = f.todos.raw(task.id); delete row.activity; f.todos.save(row); }
  f.advance(1000); f.todos.change({ id: a.id, revision: f.todos.raw(a.id).revision, documentation: "Recent edit isn't work" }, "edit");
  const restored = new OfficeTodos(path.join(f.root, "office"), f.deps);
  expect(restored.context(f.owner).todoId).toBe(b.id); expect(restored.bound(f.owner).id).toBe(b.id); expect(restored.phaseScope(f.owner)).toBeNull();
  const row = restored.raw(a.id); row.lastStartedAt = restored.raw(b.id).lastStartedAt; restored.save(row);
  expect(new OfficeTodos(path.join(f.root, "office"), f.deps).bound(f.owner)).toBeNull();
});
it("does not date an older legacy activity from doc/timer metadata; missing actual dates remain ambiguous", async () => {
  const f = await fixture(), legacy = f.todos.create({ requestId: "legacy-date", title: "Legacy", actorId: f.owner, assigneeId: f.owner, phases: [{ title: "Work" }] }).todo;
  f.todos.startForAgent(f.owner, legacy.id); await f.store.call("turn/start", { threadId: f.owner, input: [] });
  const at = f.todos.raw(legacy.id).activity.startedAt;
  f.advance(100); f.todos.change({ id: legacy.id, revision: f.todos.raw(legacy.id).revision, documentation: "Edit while clock runs" }, "edit");
  expect(f.todos.raw(legacy.id).activity.startedAt).toBe(at); expect(f.todos.raw(legacy.id).lastStartedAt).toBeGreaterThan(at);
  f.todos.change({ id: legacy.id, revision: f.todos.raw(legacy.id).revision }, "pause");
  f.advance(100); await f.runtime.run(f.input(f.pc)); f.todos.change(f.input(f.pc), "pause");
  const old = f.todos.raw(legacy.id); delete old.activity.startedAt; f.todos.save(old);
  const restored = new OfficeTodos(path.join(f.root, "office"), f.deps);
  expect(restored.bound(f.owner)).toBeNull(); expect(restored.context(f.owner).todoId).toBeNull(); expect(restored.phaseScope(f.owner)).toBeNull();
});
