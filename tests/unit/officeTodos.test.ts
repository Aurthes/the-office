// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const { OfficeTodos } = createRequire(import.meta.url)("../../server/office-todos.js");
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "office-todos-")); directories.push(directory);
  let now = 1000;
  const projects = [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }], agents = [{ id: "alice", name: "Alice", projectId: "alpha" }, { id: "bob", name: "Bob", projectId: "beta" }];
  const deps = { projects: () => projects, agents: () => agents, now: () => now, changed: vi.fn() };
  const todos = new OfficeTodos(directory, deps);
  const create = (extra = {}) => todos.create({ requestId: crypto.randomUUID(), title: "Ship a task", departmentId: "alpha", assigneeId: "alice", phases: [{ title: "Plan" }, { title: "Build" }, { title: "Verify" }], ...extra }).todo;
  const change = (id: string, action: string, extra = {}) => todos.change({ id, revision: todos.raw(id).revision, ...extra }, action).todo;
  return { directory, todos, deps, create, change, projects, agents, advance: (ms: number) => { now += ms; } };
}
describe("central Office task records", () => {
  it("times phases, advances automatically, pauses and reopens without losing elapsed work", () => {
    const f = fixture(), row = f.create();
    expect(f.todos.get({ id: row.id }).todo.elapsedMs).toBe(0);
    f.change(row.id, "start"); f.advance(12500);
    let current = f.change(row.id, "complete", { phaseId: row.phases[0].id });
    expect(current.phases[0].elapsedMs).toBe(12500); expect(current.phases[1].startedAt).toBe(13500); expect(current.progress).toBe(1);
    f.advance(500); current = f.change(row.id, "pause"); f.advance(999000);
    expect(f.todos.get({ id: row.id }).todo.elapsedMs).toBe(13000);
    f.change(row.id, "start"); f.advance(1500); f.change(row.id, "complete", { phaseId: row.phases[1].id });
    f.advance(2000); current = f.change(row.id, "complete", { phaseId: row.phases[2].id });
    expect(current.status).toBe("done"); expect(current.elapsedMs).toBe(16500); expect(current.progress).toBe(3);
    current = f.change(row.id, "reopen", { phaseId: row.phases[0].id }); expect(current.status).toBe("running");
    f.advance(1000); current = f.change(row.id, "complete", { phaseId: row.phases[0].id }); expect(current.elapsedMs).toBe(17500); expect(current.status).toBe("done");
  });
  it("rejects stale edits, while repeated phase completion cannot advance twice", () => {
    const f = fixture(), row = f.create();
    f.change(row.id, "start");
    expect(() => f.todos.change({ id: row.id, revision: row.revision, title: "Overwrite" }, "edit")).toThrow(/changed/);
    const current = f.change(row.id, "complete", { phaseId: row.phases[0].id });
    expect(f.todos.change({ id: row.id, revision: row.revision, phaseId: row.phases[0].id }, "complete").todo.revision).toBe(current.revision);
  });
  it("keeps phase identity and time when editing and reordering the plan", () => {
    const f = fixture(), row = f.create(); f.change(row.id, "start"); f.advance(1200);
    const current = f.change(row.id, "edit", { documentation: "Evidence", phases: [{ id: row.phases[0].id, title: "Research" }, { title: "New step" }, { id: row.phases[2].id, title: "Validate" }] });
    expect(current.phases[0].elapsedMs).toBe(1200); expect(current.phases[1].id).not.toBe(row.phases[1].id); expect(current.events.at(-2).message).toContain("Removed phase: Build");
    expect(current.documentation).toBe("Evidence"); expect(current.status).toBe("running");
  });
  it("deduplicates creations and rejects accidental request ID reuse with other data", () => {
    const f = fixture(), row = f.create({ requestId: "same" });
    expect(f.create({ requestId: "same" }).id).toBe(row.id);
    expect(() => f.create({ requestId: "same", title: "Other work" })).toThrow(/conflict/);
    expect(f.todos.list().total).toBe(1);
  });
  it("checkpoints timer progress and excludes time Office was offline", () => {
    const f = fixture(), row = f.create(); f.change(row.id, "start"); f.advance(15000); f.todos.checkpoint(); f.advance(3600000);
    const restored = new OfficeTodos(f.directory, f.deps), current = restored.get({ id: row.id }).todo;
    expect(current.status).toBe("paused"); expect(current.elapsedMs).toBe(15000); expect(current.revision).toBe(3);
    expect(JSON.parse(readFileSync(path.join(f.directory, "todos", row.id + ".json"), "utf8")).status).toBe("paused");
  });
  it("resumes the last active assignment after restart instead of a newer queued task", () => {
    const f = fixture(), active = f.create(); f.change(active.id, "start"); f.advance(5000); f.todos.checkpoint();
    f.advance(1000); f.create();
    const restored = new OfficeTodos(f.directory, f.deps);
    expect(restored.bound("alice").id).toBe(active.id);
    expect(restored.bound("alice").status).toBe("paused");
  });
  it("freezes timing at graceful shutdown and preserves archive history", () => {
    const f = fixture(), row = f.create(); f.change(row.id, "start"); f.advance(2500); f.todos.close();
    f.change(row.id, "archive"); expect(f.todos.list().total).toBe(0); expect(f.todos.list({ status: "archived" }).total).toBe(1);
    const current = f.change(row.id, "restore"); expect(current.elapsedMs).toBe(2500); expect(current.status).toBe("paused"); expect(current.events.length).toBeGreaterThan(3);
  });
  it("filters departments and unassigned records while keeping global totals", () => {
    const f = fixture(); f.create({ assigneeId: null }); f.create({ departmentId: "beta", assigneeId: "bob" }); f.create({ departmentId: null, assigneeId: null });
    const listed = f.todos.list({ departmentId: "alpha", assigneeId: null });
    expect(listed.total).toBe(1); expect(listed.departments.find((p: { id: string }) => p.id === "beta").total).toBe(1);
    expect(listed.todos[0].documentation).toBeUndefined(); expect(f.todos.list({ query: "no match" }).total).toBe(0);
  });
  it("tracks chat intake once, keeps follow-ups together and pauses at turn end without declaring success", () => {
    const f = fixture(), row = f.todos.intake("alice", "Build the feature\nMore detail", "send1"); f.todos.startForAgent("alice", row.id); f.advance(5000);
    f.todos.finishTurn("alice", "completed");
    expect(f.todos.raw(row.id).status).toBe("paused"); expect(f.todos.raw(row.id).phases[0].completedAt).toBeNull();
    expect(f.todos.intake("alice", "Continue", "send2").id).toBe(row.id);
    f.change(row.id, "complete", { phaseId: row.phases[0].id });
    expect(f.todos.intake("alice", "Build the feature\nMore detail", "send1").id).toBe(row.id);
    expect(f.todos.intake("alice", "New work", "send3").id).not.toBe(row.id);
  });
  it("runs one phase per owner and leaves unrelated agents untouched", () => {
    const f = fixture(), first = f.create(), second = f.create(), other = f.create({ assigneeId: "bob" });
    f.change(first.id, "start"); f.change(other.id, "start"); f.advance(1000); f.change(second.id, "start");
    expect(f.todos.raw(first.id).status).toBe("paused"); expect(f.todos.raw(other.id).status).toBe("running");
    expect(f.todos.bound("alice").id).toBe(second.id);
    expect(() => f.todos.startForAgent("bob", second.id)).toThrow(/assigned/);
  });
  it("retains historical names when an owner or department disappears and supports reassignment", () => {
    const f = fixture(), row = f.create(); f.agents.shift(); f.projects.shift();
    const historical = f.todos.get({ id: row.id }).todo; expect(historical.departmentName).toBe("Alpha"); expect(historical.assigneeName).toBe("Alice"); expect(historical.assigneeAvailable).toBe(false);
    const current = f.change(row.id, "edit", { title: "Follow up", assigneeId: "bob", departmentId: "beta" }); expect(current.assigneeName).toBe("Bob");
  });
  it("validates the complete plan before saving and does not expose partial writes", () => {
    const f = fixture(), row = f.create();
    expect(() => f.change(row.id, "edit", { title: "Wrong", phases: [] })).toThrow(/1–20/);
    expect(f.todos.get({ id: row.id }).todo.title).toBe("Ship a task");
    expect(() => f.create({ actorId: "missing" })).toThrow(/existing Office agent/);
    expect(() => f.create({ departmentId: "missing" })).toThrow(/department/);
  });
});
