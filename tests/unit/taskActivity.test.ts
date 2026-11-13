// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
const { OfficeTodos } = createRequire(import.meta.url)("../../server/office-todos.js");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
function fixture(phased = false) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "task-activity-")); dirs.push(dir); let now = 1000;
  const turns = new Map<string, string>();
  const deps = { now: () => now, activeTurn: (id: string) => turns.get(id) || null, projects: () => [], agents: () => [{ id: "a", name: "A" }, { id: "b", name: "B" }] };
  const todos = new OfficeTodos(dir, deps);
  const task = todos.create({ requestId: "r", title: "Task", ownerId: "a", assigneeId: "a", ...(phased ? { executionMode: "phases" } : {}), phases: [{ title: "Build", assigneeId: "a" }, { title: "Review", assigneeId: "b" }] }).todo;
  const phaseId = phased ? task.phases[0].id : undefined;
  const change = (action: string, extra = {}) => todos.change({ id: task.id, revision: todos.raw(task.id).revision, actorId: "a", ...(phaseId ? { phaseId } : {}), ...extra }, action).todo;
  const dispatch = (agentId = "a", pid = phaseId, turnId = "turn-a") => {
    const context = todos.context(agentId); turns.set(agentId, turnId);
    todos.recordTurn({ ...context, taskId: task.id, phaseId: pid, agentId, turnId, previousTurnId: context.activityTurnId, activityRole: context.activityRole, mode: "start", dispatchedAt: now });
  };
  return { dir, deps, todos, task, phaseId, turns, change, dispatch, tick: (ms = 1000) => now += ms };
}
it.each([false, true])("separates follow-up from exact live execution and keeps Active after Stop/turn completion/restart (phased=%s)", phased => {
  const f = fixture(phased); const scope = (t: typeof f.task) => phased ? t.phases[0] : t;
  f.change("start"); expect(scope(f.todos.get({ id: f.task.id }).todo).execution).toBeNull(); // manual timer is not a native turn
  f.dispatch(); expect(scope(f.todos.get({ id: f.task.id }).todo).execution).toMatchObject({ agentId: "a", turnId: "turn-a" });
  const elapsed = f.todos.get({ id: f.task.id }).todo.elapsedMs;
  f.tick(); f.turns.delete("a"); f.todos.finishTurn("a", "interrupted", "turn-a");
  let row = f.todos.get({ id: f.task.id }).todo;
  expect(scope(row)).toMatchObject({ status: "running", execution: null });
  expect(row.phases.every((p: { startedAt: number | null }) => p.startedAt == null)).toBe(true); expect(row.elapsedMs).toBeGreaterThanOrEqual(elapsed);
  f.tick(); f.dispatch("a", f.phaseId, "turn-play"); expect(scope(f.todos.get({ id: f.task.id }).todo).execution).toMatchObject({ turnId: "turn-play" });
  f.turns.delete("a"); f.todos.finishTurn("a", "completed", "turn-play");
  expect(scope(f.todos.get({ id: f.task.id }).todo)).toMatchObject({ status: "running", execution: null });
  f.tick(); f.change("pause", { reason: "Explicitly shelved" });
  row = f.todos.list({ includeProgress: true }).todos[0]; expect(scope(row).status).toBe("paused"); expect(row.tracking.lastUpdateAt).toBe(4000);
  const restored = new OfficeTodos(f.dir, f.deps); expect(scope(restored.get({ id: row.id }).todo)).toMatchObject({ status: "paused", execution: null });
});
it("never borrows a busy agent, stale dispatch, other phase or newer task's execution", () => {
  const f = fixture(true); f.change("start");
  f.turns.set("a", "unrelated"); expect(f.todos.get({ id: f.task.id }).todo.phases[0].execution).toBeNull();
  f.dispatch(); f.turns.set("a", "new-unbound"); expect(f.todos.get({ id: f.task.id }).todo.phases[0].execution).toBeNull();
  f.turns.set("a", "turn-a");
  f.todos.startForAgent("b", f.task.id, f.task.phases[1].id, "dispatch-b"); f.dispatch("b", f.task.phases[1].id, "turn-b");
  const row = f.todos.get({ id: f.task.id }).todo; expect(row.phases.map((p: { execution: { agentId: string } | null }) => p.execution?.agentId)).toEqual(["a", "b"]);
  f.todos.finishTurn("a", "completed", "old-turn"); expect(f.todos.get({ id: f.task.id }).todo.phases[0].execution).not.toBeNull();
  f.turns.delete("a"); f.todos.finishTurn("a", "completed", "turn-a");
  const next = f.todos.create({ requestId: "next", title: "Next", assigneeId: "a", phases: [{ title: "Next" }] }).todo;
  f.todos.startForAgent("a", next.id, undefined, "next"); f.turns.set("a", "turn-a");
  expect(f.todos.get({ id: f.task.id }).todo.phases[0].execution).toBeNull();
});
it("keeps the effective update clock through read/checkpoint/turn-stop flood/restart, while ordinary edits and real states refresh it", () => {
  const f = fixture(); f.change("start"); f.dispatch(); f.tick(); f.change("edit", { documentation: "Real note" });
  const tracked = () => f.todos.list({ includeProgress: true }).todos[0].tracking;
  expect(tracked().lastUpdateAt).toBe(2000); const before = readFileSync(path.join(f.dir, "todos", f.task.id + ".json"));
  f.tick(); f.todos.get({ id: f.task.id }); tracked(); expect(readFileSync(path.join(f.dir, "todos", f.task.id + ".json"))).toEqual(before);
  f.todos.checkpoint(); expect(tracked().lastUpdateAt).toBe(2000);
  f.turns.clear(); f.todos.finishTurn("a", "completed", "turn-a"); expect(tracked().lastUpdateAt).toBe(2000);
  // Existing bounded history can lose older events; its separate numeric update survives.
  for (let i = 0; i < 110; i++) { f.tick(); const row = f.todos.raw(f.task.id); f.todos.event(row, "Agent turn completed; activity timer stopped", { source: "system" }); f.todos.save(row); }
  expect(tracked().lastUpdateAt).toBe(2000);
  f.turns.clear(); const restored = new OfficeTodos(f.dir, f.deps); expect(restored.list({ includeProgress: true }).todos[0].tracking.lastUpdateAt).toBe(2000);
  f.tick(); f.change("pause", { reason: "No longer following" }); expect(tracked().recent[0].action).not.toBe("Started"); expect(tracked().lastUpdateAt).toBe(114000);
});
it("rejects stale CAS/unknown actors and does not persist a read-time live execution or alter historical times", () => {
  const f = fixture(true); f.change("start"); f.dispatch(); const raw = JSON.stringify(f.todos.raw(f.task.id));
  f.todos.get({ id: f.task.id }); f.todos.list({ includeProgress: true }); expect(JSON.stringify(f.todos.raw(f.task.id))).toBe(raw);
  expect(() => f.todos.change({ id: f.task.id, phaseId: f.phaseId, revision: -1 }, "pause")).toThrow(/changed/);
  expect(() => f.change("pause", { actorId: "missing" })).toThrow(/existing/);
});

it("can observe a still-linked turn independently of an explicit follow-up pause, without restarting its clock", () => {
  const f = fixture(true); f.change("start"); f.dispatch(); f.tick(); f.change("pause");
  let row = f.todos.get({ id: f.task.id }).todo; expect(row.phases[0]).toMatchObject({ status: "paused", startedAt: null, execution: { turnId: "turn-a" } });
  f.turns.clear(); f.todos.finishTurn("a", "completed", "turn-a"); row = f.todos.get({ id: f.task.id }).todo; expect(row.phases[0]).toMatchObject({ status: "paused", startedAt: null, execution: null });
});
