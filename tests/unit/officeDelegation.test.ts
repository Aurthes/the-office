// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { CodexOfficeStore } = require("../../server/codex-office-store");
const { OfficeTodos, activeDelegation } = require("../../server/office-todos");
const { OfficeCompany } = require("../../server/office-company");
const { OfficeDelegation } = require("../../server/office-delegation");
const { ceo: CEO } = require("../../src/lib/office/identities.json");
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
async function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "office-handoff-")); directories.push(root);
  const workspace = path.join(root, "workspace"); mkdirSync(workspace);
  const client = { ready: true, call: vi.fn(async (method: string) => method === "thread/start" ? { thread: { id: "native-existing" } } : { turn: { id: "turn" } }) };
  const store = new CodexOfficeStore(path.join(root, "office"), client); store.ensureCeo();
  const make = async (name: string) => (await store.createSession({ name, workspace, requestId: name })).threadId;
  const manager = await make("Manager"), worker = await make("Worker"), peer = await make("Peer");
  const graph = { [CEO]: { title: "CEO", reportsTo: [] }, [manager]: { title: "Head", reportsTo: [CEO] }, [worker]: { title: "Worker", reportsTo: [manager] }, [peer]: { title: "Worker", reportsTo: [CEO] } };
  const settingsFile = path.join(root, "settings.json"), saveGraph = () => writeFileSync(settingsFile, JSON.stringify({ office: { "ws://localhost:18790": { organization: graph } }, gateway: { token: "not-model-context" } })); saveGraph();
  const company = new OfficeCompany(store, { settingsFile, gatewayUrl: "ws://127.0.0.1:18790" });
  const deps = { projects: () => store.projects(), agents: () => store.list() };
  const todos = new OfficeTodos(path.join(root, "office"), deps);
  const available = new Map<string, boolean>();
  const canSend = vi.fn(async (id: string) => available.get(id) !== false), send = vi.fn<(id: string, message: string, requestId: string) => Promise<{ status: string }>>(async () => ({ status: "started" }));
  const runtime = new OfficeDelegation({ store, todos, company, canSend, send });
  const create = (assigneeId = manager) => todos.create({ requestId: crypto.randomUUID(), actorId: assigneeId, title: "One user goal", assigneeId, phases: [{ title: "Execute" }, { title: "Final acceptance" }] }).todo;
  const input = (id: string, actorId: string, extra = {}) => ({ id, actorId, revision: todos.raw(id).revision, requestId: crypto.randomUUID(), ...extra });
  const delegate = (id: string, actorId = manager, assigneeId = worker) => runtime.delegate(input(id, actorId, { assigneeId, instructions: "Implement the requested change. Do not deploy.", acceptanceCriteria: "Tests pass and the original request is met." }));
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
  return { root, store, client, company, manager, worker, peer, graph, saveGraph, settingsFile, todos, deps, runtime, available, canSend, send, create, input, delegate, settle };
}
describe("real-session Office delegation", () => {
  it("reads the same live graph as the scene, applies defaults and exposes no credentials", async () => {
    const f = await fixture();
    expect(f.company.context(CEO)).toMatchObject({ delegationMode: "prefer" });
    expect(f.company.context(f.manager)).toMatchObject({ delegationMode: "auto", directReports: [{ id: f.worker }] });
    expect(f.company.context(f.worker)).toMatchObject({ delegationMode: "self", managers: [{ id: f.manager }] });
    expect(JSON.stringify(f.company.context(f.manager))).not.toContain("not-model-context");
    Object.assign(f.graph[f.manager], { delegationMode: "self" }); f.saveGraph();
    expect(f.company.context(f.manager).delegationMode).toBe("self");
    f.store.get(f.manager).archived = true;
    expect(f.company.context(f.worker).managers.map((row: { id: string }) => row.id)).toEqual([CEO]);
    expect(() => f.company.assertDelegate(f.manager, f.worker)).toThrow("archived");
  });
  it("fails closed on invalid settings instead of using a stale reporting graph", async () => {
    const f = await fixture(); f.company.context(f.manager); writeFileSync(f.settingsFile, "invalid JSON");
    expect(() => f.company.context(f.manager)).toThrow();
    expect(f.company.forTurn(f.manager)).toMatchObject({ unavailable: true, delegationMode: "self", directReports: [] });
    f.store.companyContext = (id: string) => f.company.forTurn(id);
    await expect(f.store.call("turn/start", { threadId: f.manager, input: [] })).resolves.toMatchObject({ turn: { id: "turn" } });
    await expect(f.delegate(f.create().id)).rejects.toThrow(); expect(f.send).not.toHaveBeenCalled();
  });
  it("injects current organization into an existing thread only when context changes", async () => {
    const f = await fixture(); f.store.companyContext = (id: string) => f.company.context(id);
    const row = f.store.get(f.manager); row.codexThreadId = "native-existing";
    await f.store.call("turn/start", { threadId: f.manager, input: [] });
    await f.store.call("turn/start", { threadId: f.manager, input: [] });
    expect(f.client.call.mock.calls.filter(([method]: [string]) => method === "thread/inject_items")).toHaveLength(1);
    expect(f.client.call.mock.calls.some(([method]: [string]) => method === "thread/start")).toBe(false);
    f.graph[f.worker].reportsTo = [CEO]; f.saveGraph();
    await f.store.call("turn/start", { threadId: f.manager, input: [] });
    const injections = f.client.call.mock.calls.filter(([method]: [string]) => method === "thread/inject_items");
    expect(injections).toHaveLength(2); expect(JSON.stringify(injections[1])).toContain('directReports\\":[]');
  });
  it("sends once to the existing employee, retains one task and requires manager acceptance", async () => {
    const f = await fixture(), task = f.create(), beforeIds = f.store.list().map((row: { id: string }) => row.id);
    const request = f.input(task.id, f.manager, { assigneeId: f.worker, instructions: "Do not deploy", acceptanceCriteria: "Tests pass" });
    await f.runtime.delegate(request); await f.runtime.delegate(request);
    expect(f.send).toHaveBeenCalledTimes(1); expect(f.send.mock.calls[0][0]).toBe(f.worker);
    expect(f.store.list().map((row: { id: string }) => row.id)).toEqual(beforeIds); expect(f.todos.rows.size).toBe(1);
    for (const [action, extra] of [["complete", { phaseId: task.phases[1].id }], ["archive", {}], ["edit", { assigneeId: f.peer }]] as const) {
      if (action === "complete") f.todos.change(f.input(task.id, f.worker, { phaseId: task.phases[0].id }), "complete");
      expect(() => f.todos.change(f.input(task.id, f.worker, extra), action)).toThrow(/acceptance|delegation/);
    }
    await f.runtime.submit(f.input(task.id, f.worker, { report: "Tests passed; artifact /tmp/result. No deployment." })); await f.settle();
    expect(f.todos.raw(task.id)).toMatchObject({ assigneeId: f.manager, archived: false, completedAt: null });
    expect(activeDelegation(f.todos.raw(task.id)).state).toBe("review");
    await expect(f.runtime.review(f.input(task.id, f.worker, { accept: true, notes: "I accept myself" }))).rejects.toThrow("delegating manager");
    await f.runtime.review(f.input(task.id, f.manager, { accept: true, notes: "Read artifact and independently confirmed the expected result." }));
    expect(f.todos.raw(task.id).status).not.toBe("done");
    expect(() => f.todos.change(f.input(task.id, f.worker, { phaseId: task.phases[1].id }), "complete")).toThrow("responsible manager");
    f.todos.change(f.input(task.id, f.manager, { phaseId: task.phases[1].id }), "complete");
    expect(f.todos.raw(task.id)).toMatchObject({ status: "done", archived: true });
    expect(f.send.mock.calls.map(([id]: [string]) => id)).toEqual([f.worker, f.manager]); // The Head's CEO is outside this task's handoff chain.
  });
  it("returns specific feedback, resubmits and keeps the same phases and task identity", async () => {
    const f = await fixture(), task = f.create(); await f.delegate(task.id);
    await f.runtime.submit(f.input(task.id, f.worker, { report: "First result" })); await f.settle();
    await f.runtime.review(f.input(task.id, f.manager, { accept: false, notes: "Fix the missing edge case" }));
    expect(f.todos.raw(task.id)).toMatchObject({ id: task.id, assigneeId: f.worker });
    expect(activeDelegation(f.todos.raw(task.id))).toMatchObject({ state: "working", review: { notes: "Fix the missing edge case" } });
    await f.runtime.submit(f.input(task.id, f.worker, { report: "Edge case fixed, verified with test." })); await f.settle();
    expect(f.todos.raw(task.id).phases.map((phase: { id: string }) => phase.id)).toEqual(task.phases.map((phase: { id: string }) => phase.id));
    expect(f.todos.rows.size).toBe(1); expect(f.todos.raw(task.id).events.some((event: { message: string }) => event.message.includes("First result"))).toBe(true);
  });
  it("requires acceptance at each level of a nested reporting chain", async () => {
    const f = await fixture(), task = f.create(CEO); await f.delegate(task.id, CEO, f.manager); await f.delegate(task.id);
    await f.runtime.submit(f.input(task.id, f.worker, { report: "Worker evidence" })); await f.settle();
    await expect(f.runtime.review(f.input(task.id, CEO, { accept: true, notes: "Skip manager" }))).rejects.toThrow("delegating manager");
    await f.runtime.review(f.input(task.id, f.manager, { accept: true, notes: "Verified worker evidence" }));
    expect(activeDelegation(f.todos.raw(task.id))).toMatchObject({ managerId: CEO, workerId: f.manager, state: "working" });
    await f.runtime.submit(f.input(task.id, f.manager, { report: "Integrated and verified outcome" })); await f.settle();
    await f.runtime.review(f.input(task.id, CEO, { accept: true, notes: "Verified integrated outcome" }));
    expect(activeDelegation(f.todos.raw(task.id))).toBeUndefined(); expect(f.todos.raw(task.id).assigneeId).toBe(CEO);
    expect(f.send.mock.calls.map(([id]: [string]) => id)).toEqual([f.manager, f.worker, f.manager, CEO]);
  });
  it("refuses unrelated, busy or newly moved reports before changing ownership", async () => {
    const f = await fixture(), task = f.create();
    await expect(f.delegate(task.id, f.manager, f.peer)).rejects.toThrow("direct report");
    f.available.set(f.worker, false); await expect(f.delegate(task.id)).rejects.toThrow("busy");
    f.canSend.mockImplementationOnce(async () => { f.graph[f.worker].reportsTo = [CEO]; f.saveGraph(); return true; });
    await expect(f.delegate(task.id)).rejects.toThrow("direct report");
    expect(f.todos.raw(task.id).assigneeId).toBe(f.manager); expect(f.send).not.toHaveBeenCalled();
  });
  it("keeps a busy manager's report pending and delivers it once when available", async () => {
    const f = await fixture(), task = f.create(); await f.delegate(task.id); f.available.set(f.manager, false);
    await f.runtime.submit(f.input(task.id, f.worker, { report: "Result with evidence" })); await f.settle();
    expect(activeDelegation(f.todos.raw(task.id)).delivery.state).toBe("pending"); expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.todos.delegated(f.manager)).toMatchObject([{ id: task.id, state: "review" }]);
    f.available.set(f.manager, true); await f.runtime.flush(); await f.runtime.flush();
    expect(f.send).toHaveBeenCalledTimes(2); expect(f.send.mock.calls[1][0]).toBe(f.manager);
  });
  it("lets a definitive busy refusal retry the same request without duplicate work", async () => {
    const f = await fixture(), task = f.create();
    const request = f.input(task.id, f.manager, { assigneeId: f.worker, instructions: "Bounded work", acceptanceCriteria: "Verified result" });
    f.available.set(f.worker, false); await expect(f.runtime.delegate(request)).rejects.toThrow("busy");
    f.available.set(f.worker, true); await f.runtime.delegate(request); await f.runtime.delegate(request);
    expect(f.send).toHaveBeenCalledTimes(1); expect(f.todos.raw(task.id).delegations).toHaveLength(1);
  });
  it("prevents concurrent handoffs from assigning two tasks to the same receiving employee", async () => {
    const f = await fixture(), first = f.create(), second = f.create();
    const outcomes = await Promise.allSettled([f.delegate(first.id), f.delegate(second.id)]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect([f.todos.raw(first.id), f.todos.raw(second.id)].filter(row => row.assigneeId === f.worker)).toHaveLength(1);
  });
  it("recovers definitely unsent reports after restart, but never replays an uncertain send", async () => {
    const f = await fixture(), task = f.create(); await f.delegate(task.id); f.available.set(f.manager, false);
    await f.runtime.submit(f.input(task.id, f.worker, { report: "Persistent evidence" })); await f.settle();
    const restored = new OfficeTodos(path.join(f.root, "office"), f.deps); f.available.set(f.manager, true);
    f.send.mockRejectedValueOnce(new Error("Timeout after submission"));
    const resumed = new OfficeDelegation({ store: f.store, todos: restored, company: f.company, canSend: f.canSend, send: f.send });
    await resumed.flush(); await resumed.flush();
    expect(f.send).toHaveBeenCalledTimes(2); expect(activeDelegation(restored.raw(task.id))).toMatchObject({ state: "review", report: "Persistent evidence", delivery: { state: "uncertain" } });
    const disk = JSON.parse(readFileSync(path.join(f.root, "office/todos", task.id + ".json"), "utf8"));
    expect(disk.delegations[0].report).toBe("Persistent evidence");
  });
  it("recalls failed work without claiming acceptance and leaves unrelated tasks untouched", async () => {
    const f = await fixture(), task = f.create(), other = f.create(f.peer); await f.delegate(task.id);
    for (const id of [f.manager, f.worker]) expect(() => f.todos.assertCanArchiveAgent(id)).toThrow("Review or recall");
    expect(() => f.todos.assertCanArchiveAgent(f.peer)).not.toThrow();
    f.store.get(f.worker).status = "running";
    await expect(f.runtime.recall(f.input(task.id, f.manager, { reason: "Worker unavailable" }))).rejects.toThrow("Stop");
    f.store.get(f.worker).status = "idle";
    await f.runtime.recall(f.input(task.id, f.manager, { reason: "Confirmed worker stopped; taking it back" }));
    expect(activeDelegation(f.todos.raw(task.id))).toBeUndefined(); expect(f.todos.raw(task.id)).toMatchObject({ assigneeId: f.manager, status: "paused" });
    expect(f.todos.raw(task.id).delegations[0].state).toBe("recalled"); expect(f.todos.raw(other.id)).toEqual(expect.objectContaining({ assigneeId: f.peer, status: "queued" }));
    for (const id of [f.manager, f.worker]) expect(() => f.todos.assertCanArchiveAgent(id)).not.toThrow();
  });
  it("does not replay a dispatch that was in flight at restart", async () => {
    const f = await fixture(), task = f.create(); await f.delegate(task.id); f.available.set(f.manager, false);
    await f.runtime.submit(f.input(task.id, f.worker, { report: "Durable evidence before process loss" })); await f.settle();
    const entry = activeDelegation(f.todos.raw(task.id)); f.todos.delivery(task.id, entry.delivery.requestId, "sending");
    const restored = new OfficeTodos(path.join(f.root, "office"), f.deps); f.available.set(f.manager, true);
    await new OfficeDelegation({ store: f.store, todos: restored, company: f.company, canSend: f.canSend, send: f.send }).flush();
    expect(f.send).toHaveBeenCalledTimes(1); expect(activeDelegation(restored.raw(task.id)).report).toContain("Durable evidence");
  });
});
