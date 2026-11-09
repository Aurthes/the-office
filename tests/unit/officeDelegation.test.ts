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
const { OfficeDelegation, taskNotification } = require("../../server/office-delegation");
const { DEPARTMENT_HEAD_GUIDELINE } = require("../../server/office-head-guideline");
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
  it("tags delivery, manager review and returned execution once, without an accepted-review model call", async () => {
    const f = await fixture(), task = f.create(); await f.delegate(task.id);
    const usage = () => (f.send.mock.calls as unknown[][]).at(-1)?.[4];
    expect(usage()).toMatchObject({ purpose: "collaboration_mixed", trigger: "delegate", originId: activeDelegation(f.todos.raw(task.id)).id });
    await f.runtime.submit(f.input(task.id, f.worker, { report: "Ready" })); await f.settle(); expect(usage()).toMatchObject({ trigger: "managerReview" });
    await f.runtime.review(f.input(task.id, f.manager, { accept: false, notes: "Fix it" })); expect(usage()).toMatchObject({ trigger: "returned" });
    await f.runtime.submit(f.input(task.id, f.worker, { report: "Fixed" })); await f.settle(); const count = f.send.mock.calls.length;
    await f.runtime.review(f.input(task.id, f.manager, { accept: true, notes: "Verified" })); expect(f.send.mock.calls.length).toBe(count);
  });
  it("delivers only the new handoff input or report with a usable revision", async () => {
    const f = await fixture(), task = f.create();
    f.todos.change(f.input(task.id, f.manager, { documentation: "Current scope; frozen inputs. Artifact: result.json" }), "edit");
    await f.delegate(task.id);
    const update = (message: string) => JSON.parse(message.split("Task update: ")[1].split("\n")[0]);
    const working = update(f.send.mock.calls[0][1]);
    expect(working).toEqual({ revision: f.todos.raw(task.id).revision, instructions: "Implement the requested change. Do not deploy.", acceptanceCriteria: "Tests pass and the original request is met." });
    expect(f.send.mock.calls[0][1]).not.toContain("Current scope; frozen inputs");
    // A new recipient can still load the full plan when it is missing.
    expect(f.todos.get({ id: task.id }).todo.phases.map(({ id }: { id: string }) => id)).toEqual(task.phases.map(({ id }: { id: string }) => id));
    // Only transport metadata changed after dispatch; the announced revision works.
    f.todos.change({ id: task.id, revision: working.revision, actorId: f.worker, documentation: "Verified result.json" }, "edit");
    await f.runtime.submit(f.input(task.id, f.worker, { report: "Complete exact report. Read result.json to verify." })); await f.settle();
    const review = update(f.send.mock.calls.at(-1)![1]);
    expect(review).toEqual({ revision: f.todos.raw(task.id).revision, report: "Complete exact report. Read result.json to verify." });
    await f.runtime.review({ id: task.id, revision: review.revision, actorId: f.manager, accept: true, notes: "Independently verified result.json", requestId: "review-from-update" });
    expect(activeDelegation(f.todos.raw(task.id))).toBeUndefined();
    const final = update(taskNotification(f.todos.raw(task.id)));
    expect(final).toEqual({ revision: f.todos.raw(task.id).revision });
    expect(taskNotification(f.todos.raw(task.id))).not.toContain(review.report);
  });
  it("keeps real task edits conflicting while delivery receipts still persist and notify", async () => {
    const f = await fixture(), task = f.create(); await f.delegate(task.id);
    const row = f.todos.raw(task.id), revision = row.revision, delivery = activeDelegation(row).delivery;
    const changed = vi.spyOn(f.todos, "changed");
    f.todos.delivery(task.id, delivery.requestId, "uncertain", "Receipt lost");
    expect(f.todos.raw(task.id).revision).toBe(revision);
    expect(activeDelegation(f.todos.raw(task.id)).delivery).toMatchObject({ state: "uncertain", error: "Receipt lost" });
    expect(changed).toHaveBeenCalledWith(task.id);
    f.todos.change({ id: task.id, revision, actorId: CEO, documentation: "New actual user restriction" }, "edit");
    expect(() => f.todos.change({ id: task.id, revision, actorId: f.worker, documentation: "Overwrite" }, "edit")).toThrow(/changed/);
  });
  it("does not grow when unrelated task documentation, phases and history grow", async () => {
    const f = await fixture(), task = f.create(); await f.delegate(task.id);
    const row = f.todos.raw(task.id), original = JSON.stringify(row);
    const message = taskNotification(row);
    const huge = { ...row, documentation: "边界".repeat(12000), phases: row.phases.map((phase: object) => ({ ...phase, notes: "historical notes".repeat(2000) })), delegations: [{ state: "accepted", report: "old report".repeat(2000) }, ...row.delegations] };
    expect(taskNotification(huge)).toBe(message);
    expect(message).toContain("only for missing information or a revision conflict");
    expect(message).not.toContain("Task snapshot:");
    expect(JSON.stringify(row)).toBe(original);
  });
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
  it("reports unavailable organization data without blocking an explicitly chosen employee", async () => {
    const f = await fixture(); f.company.context(f.manager); writeFileSync(f.settingsFile, "invalid JSON");
    expect(() => f.company.context(f.manager)).toThrow();
    expect(f.company.forTurn(f.manager)).toMatchObject({ unavailable: true, delegationMode: "self", directReports: [] });
    f.store.companyContext = (id: string) => f.company.forTurn(id);
    await expect(f.store.call("turn/start", { threadId: f.manager, input: [] })).resolves.toMatchObject({ turn: { id: "turn" } });
    await f.delegate(f.create().id); expect(f.send).toHaveBeenCalledTimes(1);
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
  it("applies the guideline to current, newly appointed and promoted Heads through live role context", async () => {
    const f = await fixture(); f.store.companyContext = vi.fn((id: string) => f.company.forTurn(id));
    const injections = () => f.client.call.mock.calls.filter(([method]: [string]) => method === "thread/inject_items");
    const start = (id: string) => f.store.call("turn/start", { threadId: id, input: [] });
    await start(f.manager); expect(JSON.stringify(injections().at(-1))).toContain(DEPARTMENT_HEAD_GUIDELINE);
    await start(f.worker); expect(JSON.stringify(injections().at(-1))).not.toContain(DEPARTMENT_HEAD_GUIDELINE);
    f.graph[f.worker].title = "Head"; f.saveGraph();
    await start(f.worker); expect(JSON.stringify(injections().at(-1))).toContain(DEPARTMENT_HEAD_GUIDELINE);
    const newHead = (await f.store.createSession({ name: "New head", workspace: path.join(f.root, "workspace"), requestId: "new-head" })).threadId;
    Object.assign(f.graph, { [newHead]: { title: "Head", reportsTo: [CEO] } }); f.saveGraph();
    await start(newHead); expect(JSON.stringify(injections().at(-1))).toContain(DEPARTMENT_HEAD_GUIDELINE);
    f.graph[f.manager].title = "Worker"; f.saveGraph();
    expect(f.company.forTurn(f.manager)).toMatchObject({ title: "Worker", canRecruit: true, directReports: [{ id: f.worker }] });
    await start(f.manager); expect(JSON.stringify(injections().at(-1))).not.toContain(DEPARTMENT_HEAD_GUIDELINE);
    writeFileSync(f.settingsFile, "invalid JSON");
    await start(f.worker); expect(JSON.stringify(injections().at(-1))).toContain("unavailable");
    expect(JSON.stringify(injections().at(-1))).not.toContain(DEPARTMENT_HEAD_GUIDELINE);
    expect(f.store.companyContext).toHaveBeenCalledTimes(6);
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
    expect(f.todos.raw(task.id)).toMatchObject({ assigneeId: f.worker, archived: false, completedAt: null });
    expect(activeDelegation(f.todos.raw(task.id)).state).toBe("review");
    await expect(f.runtime.review(f.input(task.id, f.worker, { accept: true, notes: "I accept myself" }))).rejects.toThrow("delegating manager");
    await f.runtime.review(f.input(task.id, f.manager, { accept: true, notes: "Read artifact and independently confirmed the expected result." }));
    expect(f.todos.raw(task.id).status).not.toBe("done");
    expect(() => f.todos.change(f.input(task.id, f.worker, { phaseId: task.phases[1].id }), "complete")).toThrow("responsible manager");
    f.todos.change(f.input(task.id, f.manager, { phaseId: task.phases[1].id }), "complete");
    expect(f.todos.raw(task.id)).toMatchObject({ status: "done", archived: true });
    expect(f.send.mock.calls.map(([id]) => id)).toEqual([f.worker, f.manager]); // The Head's CEO is outside this task's handoff chain.
  });
  it("returns specific feedback, resubmits and keeps the same phases and task identity", async () => {
    const f = await fixture(), task = f.create(); await f.delegate(task.id);
    await f.runtime.submit(f.input(task.id, f.worker, { report: "First result" })); await f.settle();
    await f.runtime.review(f.input(task.id, f.manager, { accept: false, notes: "Fix the missing edge case" }));
    const update = (message: string) => JSON.parse(message.split("Task update: ")[1].split("\n")[0]);
    const returned = f.send.mock.calls.at(-1)![1];
    expect(update(returned)).toEqual({ revision: f.todos.raw(task.id).revision, feedback: "Fix the missing edge case" });
    expect(returned).not.toContain("First result"); expect(returned).not.toContain("Implement the requested change");
    expect(f.todos.raw(task.id)).toMatchObject({ id: task.id, assigneeId: f.worker });
    expect(activeDelegation(f.todos.raw(task.id))).toMatchObject({ state: "working", review: { notes: "Fix the missing edge case" } });
    await f.runtime.submit(f.input(task.id, f.worker, { report: "Edge case fixed, verified with test." })); await f.settle();
    const resubmitted = f.send.mock.calls.at(-1)![1];
    expect(update(resubmitted)).toEqual({ revision: f.todos.raw(task.id).revision, report: "Edge case fixed, verified with test." });
    expect(resubmitted).not.toContain("Fix the missing edge case"); expect(resubmitted).not.toContain("First result");
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
    expect(activeDelegation(f.todos.raw(task.id))).toBeUndefined(); expect(f.todos.raw(task.id).assigneeId).toBe(f.worker);
    expect(f.send.mock.calls.map(([id]) => id)).toEqual([f.manager, f.worker, f.manager, CEO]);
  });
  it("allows explicit non-direct recipients and reporting changes, while refusing busy or archived conversations", async () => {
    const f = await fixture(), task = f.create();
    f.available.set(f.worker, false); await expect(f.delegate(task.id)).rejects.toThrow("busy");
    expect(f.todos.raw(task.id).assigneeId).toBe(f.manager); expect(f.send).not.toHaveBeenCalled();
    await f.delegate(task.id, f.manager, f.peer); expect(f.send.mock.calls.at(-1)?.[0]).toBe(f.peer);
    f.available.set(f.worker, true);
    f.canSend.mockImplementationOnce(async () => { f.graph[f.worker].reportsTo = [CEO]; f.saveGraph(); return true; });
    const moved = f.create(); await f.delegate(moved.id); expect(f.send.mock.calls.at(-1)?.[0]).toBe(f.worker);
    const archived = f.create(); f.canSend.mockImplementationOnce(async () => { f.store.get(f.worker).archived = true; return true; });
    await expect(f.delegate(archived.id)).rejects.toThrow("archived");
    expect(f.todos.raw(archived.id).assigneeId).toBe(f.manager); expect(f.send).toHaveBeenCalledTimes(2);
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

it("separates execution, notification and binding throughout nested acceptance", async () => {
  const f = await fixture(), task = f.create(CEO);
  await f.delegate(task.id, CEO, f.manager);
  expect(f.todos.get({ id: task.id }).todo).toMatchObject({ assigneeId: f.manager, handlingAgentId: f.manager, acceptanceManagerId: CEO, reviewerId: null });
  await f.delegate(task.id);
  expect(f.todos.raw(task.id).assigneeId).toBe(f.worker);
  await f.runtime.submit(f.input(task.id, f.worker, { report: "Actual worker artifact" })); await f.settle();
  expect(f.todos.get({ id: task.id }).todo).toMatchObject({ assigneeId: f.worker, handlingAgentId: f.manager, reviewerId: f.manager });
  expect(f.todos.bound(f.worker)).toBeNull(); expect(f.todos.bound(f.manager).id).toBe(task.id);
  expect(f.todos.list({ assigneeId: f.worker }).total).toBe(1); expect(f.todos.list({ assigneeId: CEO }).total).toBe(0);
  expect(f.todos.delegated(f.manager)).toMatchObject([{ assigneeId: f.worker, reviewerId: f.manager }]);
  expect(() => f.todos.startForAgent(f.worker, task.id)).toThrow(/assigned/);
  expect(() => f.todos.change(f.input(task.id, f.worker, { phaseId: task.phases[0].id }), "complete")).toThrow(/responsible/);
  // A reviewer finishing cannot pause unrelated execution by the same worker.
  const other = f.create(f.worker); f.todos.startForAgent(f.worker, other.id);
  f.todos.finishTurn(f.worker, "completed");
  expect(f.todos.raw(task.id).status).toBe("running");
  await f.runtime.review(f.input(task.id, f.manager, { accept: true, notes: "Inspected worker artifact" }));
  await f.runtime.submit(f.input(task.id, f.manager, { report: "Forward verified worker result" })); await f.settle();
  expect(f.todos.get({ id: task.id }).todo).toMatchObject({ assigneeId: f.worker, handlingAgentId: CEO, reviewerId: CEO });
  expect(f.todos.bound(CEO).id).toBe(task.id);
  expect(f.send.mock.calls.at(-1)?.[0]).toBe(CEO);
  await f.runtime.review(f.input(task.id, CEO, { accept: true, notes: "Verified final artifact" }));
  for (const phase of task.phases) f.todos.change(f.input(task.id, CEO, { phaseId: phase.id }), "complete");
  expect(f.todos.get({ id: task.id }).todo).toMatchObject({ status: "done", assigneeId: f.worker, handlingAgentId: CEO, reviewerId: null });
});
it("changes execution only when a Head actually takes accepted work back on", async () => {
  const f = await fixture(), task = f.create(CEO); await f.delegate(task.id, CEO, f.manager); await f.delegate(task.id);
  await f.runtime.submit(f.input(task.id, f.worker, { report: "Worker artifact" })); await f.settle();
  await f.runtime.review(f.input(task.id, f.manager, { accept: true, notes: "Read artifact" }));
  expect(f.todos.raw(task.id).assigneeId).toBe(f.worker);
  f.todos.change(f.input(task.id, f.manager), "start");
  expect(f.todos.raw(task.id).assigneeId).toBe(f.manager);
  await f.runtime.submit(f.input(task.id, f.manager, { report: "Head made and checked integration changes" })); await f.settle();
  expect(f.todos.raw(task.id).assigneeId).toBe(f.manager);
});
it("keeps attribution on return until the recipient actually resumes execution", async () => {
  const f = await fixture(), task = f.create(CEO); await f.delegate(task.id, CEO, f.manager); await f.delegate(task.id);
  await f.runtime.submit(f.input(task.id, f.worker, { report: "Artifact" })); await f.settle();
  await f.runtime.review(f.input(task.id, f.manager, { accept: true, notes: "Verified" }));
  await f.runtime.submit(f.input(task.id, f.manager, { report: "Forwarded evidence" })); await f.settle();
  f.available.set(f.manager, false);
  await f.runtime.review(f.input(task.id, CEO, { accept: false, notes: "Head must fix integration" }));
  expect(f.todos.get({ id: task.id }).todo).toMatchObject({ assigneeId: f.worker, handlingAgentId: f.manager, reviewerId: null });
  f.available.set(f.manager, true); await f.runtime.flush();
  expect(f.todos.raw(task.id).assigneeId).toBe(f.manager);
});
it("resets acceptance ownership on explicit reassignment after a resolved handoff", async () => {
  const f = await fixture(), task = f.create(); await f.delegate(task.id);
  await f.runtime.submit(f.input(task.id, f.worker, { report: "Artifact" })); await f.settle();
  await f.runtime.review(f.input(task.id, f.manager, { accept: true, notes: "Verified" }));
  f.todos.change(f.input(task.id, f.manager, { assigneeId: f.peer }), "edit");
  expect(f.todos.get({ id: task.id }).todo).toMatchObject({ assigneeId: f.peer, handlingAgentId: f.peer, acceptanceManagerId: null });
  for (const phase of task.phases) f.todos.change(f.input(task.id, f.peer, { phaseId: phase.id }), "complete");
  expect(f.todos.raw(task.id).status).toBe("done");
});
it("recovers only provable legacy pending-review attribution and persists it once", async () => {
  const f = await fixture(), task = f.create(CEO); await f.delegate(task.id, CEO, f.manager); await f.delegate(task.id);
  f.available.set(f.manager, false);
  await f.runtime.submit(f.input(task.id, f.worker, { report: "Persistent artifact" })); await f.settle();
  const file = path.join(f.root, "office/todos", task.id + ".json"), old = JSON.parse(readFileSync(file, "utf8"));
  // This pre-activity legacy format had neither field.
  delete old.activity; delete old.acceptanceManagerId; old.assigneeId = f.manager; old.assigneeName = "Manager"; writeFileSync(file, JSON.stringify(old));
  const restored = new OfficeTodos(path.join(f.root, "office"), f.deps);
  const current = restored.get({ id: task.id }).todo;
  expect(current).toMatchObject({ assigneeId: f.worker, handlingAgentId: f.manager, reviewerId: f.manager, acceptanceManagerId: CEO });
  const again = new OfficeTodos(path.join(f.root, "office"), f.deps);
  expect(again.get({ id: task.id }).todo.revision).toBe(current.revision);
  expect(again.bound(f.manager).id).toBe(task.id); expect(again.bound(f.worker)).toBeNull();
  expect(again.raw(task.id).delegations).toEqual(old.delegations);
});
it("leaves completed legacy assignment history unchanged", async () => {
  const f = await fixture(), task = f.create(); await f.delegate(task.id);
  await f.runtime.submit(f.input(task.id, f.worker, { report: "Artifact" })); await f.settle();
  await f.runtime.review(f.input(task.id, f.manager, { accept: true, notes: "Verified" }));
  for (const phase of task.phases) f.todos.change(f.input(task.id, f.manager, { phaseId: phase.id }), "complete");
  const file = path.join(f.root, "office/todos", task.id + ".json"), old = JSON.parse(readFileSync(file, "utf8"));
  // This pre-activity legacy format had neither field.
  delete old.activity; delete old.acceptanceManagerId; old.assigneeId = f.manager; old.assigneeName = "Manager"; writeFileSync(file, JSON.stringify(old));
  new OfficeTodos(path.join(f.root, "office"), f.deps);
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(old);
});

it("does not count offline time when migrating a legacy running review", async () => {
  const f = await fixture(), task = f.create(); await f.delegate(task.id);
  f.available.set(f.manager, false); await f.runtime.submit(f.input(task.id, f.worker, { report: "Evidence" })); await f.settle();
  const file = path.join(f.root, "office/todos", task.id + ".json"), old = JSON.parse(readFileSync(file, "utf8"));
  delete old.acceptanceManagerId; old.assigneeId = f.manager; old.status = "running"; old.savedAt = 2000;
  old.phases[0].startedAt = 1000; old.phases[0].elapsedMs = 500; writeFileSync(file, JSON.stringify(old));
  const restored = new OfficeTodos(path.join(f.root, "office"), { ...f.deps, now: () => 999000 });
  expect(restored.get({ id: task.id }).todo).toMatchObject({ status: "paused", elapsedMs: 1500, assigneeId: f.worker });
});

it("persists legacy attribution and timer recovery atomically across process loss", async () => {
  const f = await fixture(), task = f.create(); await f.delegate(task.id);
  f.available.set(f.manager, false); await f.runtime.submit(f.input(task.id, f.worker, { report: "Evidence" })); await f.settle();
  const file = path.join(f.root, "office/todos", task.id + ".json"), old = JSON.parse(readFileSync(file, "utf8"));
  delete old.acceptanceManagerId; old.assigneeId = f.manager; old.status = "running"; old.savedAt = 2000;
  old.phases[0].startedAt = 1000; old.phases[0].elapsedMs = 500; writeFileSync(file, JSON.stringify(old));
  const save = OfficeTodos.prototype.save;
  const crash = vi.spyOn(OfficeTodos.prototype, "save").mockImplementationOnce(function (this: object, row: unknown) { save.call(this, row); throw new Error("Process lost after durable save"); });
  expect(() => new OfficeTodos(path.join(f.root, "office"), { ...f.deps, now: () => 999000 })).toThrow(/Process lost/);
  crash.mockRestore();
  const restored = new OfficeTodos(path.join(f.root, "office"), { ...f.deps, now: () => 1999000 });
  expect(restored.get({ id: task.id }).todo).toMatchObject({ status: "paused", elapsedMs: 1500, assigneeId: f.worker });
});
