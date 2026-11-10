// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
const { OfficeTodos, isPhaseTask, isWatcherOnlyEdit } = createRequire(import.meta.url)("../../server/office-todos.js");
const { taskTracking } = createRequire(import.meta.url)("../../server/office-todo-progress.js");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function fixture(mode?: "phases") {
  const dir = mkdtempSync(path.join(os.tmpdir(), "task-watchers-")); dirs.push(dir);
  let now = 1000;
  const agents = ["head", "worker", "watcher", "extra"].map(id => ({ id, name: id }));
  const options = { agents: () => agents, projects: () => [], now: () => now, changed: vi.fn() };
  const todos = new OfficeTodos(dir, options);
  const task = todos.create({ actorId: "head", requestId: "fixture", title: "Work", ownerId: "head", assigneeId: "head", ...(mode ? { executionMode: mode } : {}), phases: [{ title: "Work", assigneeId: "head" }, { title: "Accept", assigneeId: "head" }] }).todo;
  const change = (action: string, extra = {}) => todos.change({ id: task.id, revision: todos.raw(task.id).revision, actorId: "head", ...extra }, action).todo;
  return { dir, agents, options, todos, task, change, advance: () => { now += 5000; } };
}
it("persists explicit watchers through create/edit/list/get and reload, preserves omission and clears []", () => {
  const f = fixture();
  const created = f.todos.create({ actorId: "head", requestId: "watched-create", title: "Watched", watcherIds: ["watcher", "watcher", "head"], phases: [{ title: "Work" }] }).todo;
  expect(created.watcherIds).toEqual(["watcher", "head"]);
  expect(f.task).not.toHaveProperty("watcherIds");
  f.change("edit", { watcherIds: ["watcher", "watcher", "extra"] });
  f.change("edit", { title: "Renamed" });
  expect(f.todos.get({ id: f.task.id }).todo.watcherIds).toEqual(["watcher", "extra"]);
  expect(f.todos.list().todos.find((t: { id: string }) => t.id === f.task.id).watcherIds).toEqual(["watcher", "extra"]);
  const restored = new OfficeTodos(f.dir, f.options);
  expect(restored.get({ id: f.task.id }).todo.watcherIds).toEqual(["watcher", "extra"]);
  f.change("edit", { ownerId: "worker" });
  expect(f.todos.raw(f.task.id)).toMatchObject({ ownerId: "worker", watcherIds: ["watcher", "extra"] });
  f.change("edit", { watcherIds: [] });
  expect(f.todos.raw(f.task.id)).toMatchObject({ ownerId: "worker", watcherIds: [] });
});
it("rejects invalid watcher IDs/types, unknown actors and CAS conflicts without partial saves", () => {
  const f = fixture(), before = structuredClone(f.todos.raw(f.task.id));
  for (const watcherIds of [null, "watcher", [null], ["missing"], [""]]) expect(() => f.change("edit", { watcherIds })).toThrow(/watchers/);
  expect(() => f.change("edit", { watcherIds: ["watcher"], actorId: "missing" })).toThrow(/existing Office agent/);
  expect(() => f.change("edit", { watcherIds: ["watcher"], revision: 0 })).toThrow(/changed/);
  expect(f.todos.raw(f.task.id)).toEqual(before);
});
it("retains unavailable existing watchers while allowing removal, without accepting new unavailable identities", () => {
  const f = fixture(); f.change("edit", { watcherIds: ["watcher"] });
  f.agents.splice(f.agents.findIndex(a => a.id === "watcher"), 1);
  f.change("edit", { watcherIds: ["watcher", "extra"] });
  expect(f.todos.raw(f.task.id).watcherIds).toEqual(["watcher", "extra"]);
  f.change("edit", { watcherIds: ["extra"] });
  expect(() => f.change("edit", { watcherIds: ["watcher"] })).toThrow(/watchers/);
});
for (const mode of [undefined, "phases"] as const) for (const state of ["running", "paused", "review", "done"]) it(`keeps ${mode || "legacy"} ${state} execution/timers/acceptance and progress unchanged`, () => {
  const f = fixture(mode), phaseId = mode ? f.task.phases[0].id : undefined;
  if (state === "done") for (const phase of f.task.phases) f.change("complete", { phaseId: phase.id });
  else {
    const entry = f.change("delegate", { phaseId, assigneeId: "worker", instructions: "Implement", acceptanceCriteria: "Verify" }).delegations.at(-1);
    if (state === "review") f.change("submit", { actorId: "worker", phaseId, handoffId: entry.id, report: "Done" });
    else {
      f.change("start", { actorId: "worker", phaseId, activityId: "test-activity" });
      if (state === "paused") f.change("pause", { actorId: "worker", phaseId, reason: "Waiting for prerequisite" });
    }
  }
  const before = structuredClone(f.todos.raw(f.task.id)), bindings = [...f.todos.bindings.entries()], tracking = taskTracking(before);
  const stop = vi.spyOn(f.todos, "stopClock"), run = vi.spyOn(f.todos, "run");
  f.advance(); f.change("edit", { actorId: "watcher", watcherIds: ["watcher"], requestId: "metadata-only" });
  const after = structuredClone(f.todos.raw(f.task.id));
  expect(stop).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  expect({ ...after, watcherIds: undefined, revision: before.revision, updatedAt: before.updatedAt, savedAt: before.savedAt, events: before.events }).toEqual({ ...before, watcherIds: undefined });
  expect([...f.todos.bindings.entries()]).toEqual(bindings);
  expect(taskTracking(after)).toEqual(tracking);
  expect(f.todos.get({ id: f.task.id }).todo).toMatchObject({ status: before.status, archived: before.archived, completedAt: before.completedAt });
  if (state === "done") expect(f.todos.list().todos).toHaveLength(0);
  else {
    expect(() => f.change("start", { actorId: "watcher", phaseId })).toThrow();
    expect(() => f.change("review", { actorId: "watcher", phaseId, handoffId: after.delegations.at(-1).id, accept: true, notes: "No" })).toThrow();
  }
});
it("keeps the existing archived-unfinished edit guard", () => {
  const f = fixture(); f.change("archive");
  expect(() => f.change("edit", { watcherIds: ["watcher"] })).toThrow(/Restore/);
});
it("actual gateway edit route skips recordTurn only for watcher metadata, keeping normal execution behavior", () => {
  const f = fixture(); f.change("start");
  const source = readFileSync(path.join(process.cwd(), "server/codex-office-gateway.js"), "utf8");
  const start = source.indexOf('...Object.fromEntries(["edit", "start"');
  const fragment = source.slice(start, source.indexOf('  "todo.run":', start));
  const recordTurn = vi.spyOn(f.todos, "recordTurn"), state = vi.fn(() => ({ activeTurnId: "current-turn" }));
  const methods = vm.runInNewContext(`({${fragment}})`, { todos: f.todos, controls: { state }, replyContext: { bindTask: vi.fn() }, isPhaseTask, isWatcherOnlyEdit });
  const raw = f.todos.raw(f.task.id), before = structuredClone(raw.activity);
  methods["todo.edit"]({ id: raw.id, revision: raw.revision, actorId: "head", watcherIds: ["extra"], requestId: "watchers" });
  expect(recordTurn).not.toHaveBeenCalled(); expect(state).not.toHaveBeenCalled();
  expect(f.todos.raw(f.task.id).activity).toEqual(before);
  expect(isWatcherOnlyEdit({ id: raw.id, revision: 1, watcherIds: [], assigneeId: "worker" })).toBe(false);
});
