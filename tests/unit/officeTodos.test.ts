// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
describe("independent follow-up owners", () => {
  it("defaults agent creations to the actor, preserves explicit null and filters owner separately from execution", () => {
    const f = fixture();
    const row = f.create({ actorId: "alice", assigneeId: "bob" });
    expect(row).toMatchObject({ ownerId: "alice", ownerName: "Alice", assigneeId: "bob" });
    const cleared = f.create({ actorId: "alice", ownerId: null });
    expect(cleared.ownerId).toBeNull();
    expect(f.todos.list({ ownerId: "alice", assigneeId: "bob" }).todos.map((r: { id: string }) => r.id)).toEqual([row.id]);
    expect(f.todos.list({ ownerId: "bob" }).total).toBe(0);
    expect(f.todos.list({ ownerId: null }).todos.map((r: { id: string }) => r.id)).toEqual([cleared.id]);
    expect(() => f.create({ ownerId: "missing" })).toThrow(/owner/);
    expect(f.change(row.id, "edit", { ownerId: "bob" })).toMatchObject({ ownerId: "bob", assigneeId: "bob" });
    expect(f.change(row.id, "edit", { ownerId: null }).ownerId).toBeNull();
  });
  it("keeps ownership through nested handoffs, recall, reassignment, completion and follow-up without granting workflow authority", () => {
    const f = fixture(); f.agents.push({ id: "carol", name: "Carol", projectId: "alpha" });
    const row = f.create({ actorId: "alice" });
    const scope = { instructions: "Implement only", acceptanceCriteria: "Pass checks" };
    const check = () => expect(f.todos.get({ id: row.id }).todo.ownerId).toBe("alice");
    f.change(row.id, "delegate", { actorId: "alice", assigneeId: "bob", ...scope }); check();
    expect(() => f.change(row.id, "edit", { actorId: "alice", documentation: "Owner is not the active worker" })).toThrow(/current responsible/);
    f.change(row.id, "delegate", { actorId: "bob", assigneeId: "carol", ...scope }); check();
    f.change(row.id, "submit", { actorId: "carol", report: "Ready" }); check();
    expect(() => f.change(row.id, "review", { actorId: "alice", accept: true, notes: "Not the direct reviewer" })).toThrow(/delegating manager/);
    f.change(row.id, "review", { actorId: "bob", accept: true, notes: "Verified" }); check();
    f.change(row.id, "submit", { actorId: "bob", report: "Verified nested result" }); check();
    f.change(row.id, "review", { actorId: "alice", accept: true, notes: "Verified" }); check();
    f.change(row.id, "edit", { assigneeId: "bob" }); check();
    f.change(row.id, "delegate", { actorId: "bob", assigneeId: "carol", ...scope }); check();
    f.change(row.id, "recall", { actorId: "bob", reason: "Take back" }); check();
    for (const phase of row.phases) f.change(row.id, "complete", { phaseId: phase.id });
    check();
    f.change(row.id, "edit", { phases: [...f.todos.raw(row.id).phases, { title: "Follow-up" }] }); check();
    f.change(row.id, "edit", { ownerId: null });
    expect(f.change(row.id, "delegate", { actorId: "bob", assigneeId: "carol", ...scope }).ownerId).toBeNull();
  });
  it("derives only evidenced legacy owners without read writes and materializes before reassignment loses acceptance evidence", () => {
    const f = fixture();
    const known = f.create(), unknown = f.create(), explicit = f.create({ ownerId: null }), nested = f.create(), conflict = f.create();
    const paths = new Map<string, string>();
    for (const row of [known, unknown, explicit, nested, conflict]) {
      const file = path.join(f.directory, "todos", row.id + ".json"), raw = JSON.parse(readFileSync(file, "utf8"));
      if (row.id !== explicit.id) { delete raw.ownerId; delete raw.ownerName; }
      if (row.id !== unknown.id) raw.acceptanceManagerId = "alice";
      if (row.id === nested.id) { raw.acceptanceManagerId = "bob"; raw.delegations = [{ managerId: "alice", workerId: "bob", state: "working" }, { managerId: "bob", workerId: "other", state: "working" }]; }
      if (row.id === conflict.id) { raw.acceptanceManagerId = "other"; raw.delegations = [{ managerId: "alice", workerId: "bob", state: "accepted" }]; }
      writeFileSync(file, JSON.stringify(raw)); paths.set(row.id, readFileSync(file, "utf8"));
    }
    const restored = new OfficeTodos(f.directory, f.deps);
    expect(restored.get({ id: known.id }).todo.ownerId).toBe("alice");
    expect(restored.get({ id: nested.id }).todo.ownerId).toBe("alice");
    expect(restored.get({ id: unknown.id }).todo).not.toHaveProperty("ownerId");
    expect(restored.get({ id: conflict.id }).todo).not.toHaveProperty("ownerId");
    expect(restored.get({ id: explicit.id }).todo.ownerId).toBeNull();
    for (const [id, content] of paths) expect(readFileSync(path.join(f.directory, "todos", id + ".json"), "utf8")).toBe(content);
    const updated = restored.change({ id: known.id, revision: known.revision, assigneeId: "bob" }, "edit").todo;
    expect(updated).toMatchObject({ ownerId: "alice", assigneeId: "bob", acceptanceManagerId: null });
    expect(updated.phases).toEqual(known.phases); expect(updated.completedAt).toBeNull();
    const persisted = JSON.parse(readFileSync(path.join(f.directory, "todos", known.id + ".json"), "utf8"));
    expect(persisted.ownerId).toBe("alice");
    restored.change({ id: unknown.id, revision: unknown.revision, documentation: "Normal mutation" }, "edit");
    expect(JSON.parse(readFileSync(path.join(f.directory, "todos", unknown.id + ".json"), "utf8")).ownerId).toBeNull();
    restored.change({ id: conflict.id, revision: conflict.revision, assigneeId: "bob" }, "edit");
    const restarted = new OfficeTodos(f.directory, f.deps);
    expect(restarted.get({ id: conflict.id }).todo.ownerId).toBeNull();
    expect(restarted.get({ id: unknown.id }).todo.ownerId).toBeNull();
  });
});
describe("central Office task records", () => {
  it("builds the roster once per list while preserving live and historical display names", () => {
    const f = fixture(); for (let i = 0; i < 25; i++) f.create({ title: `Task ${i}` });
    const agents = vi.spyOn(f.todos, "agents"), projects = vi.spyOn(f.todos, "projects");
    const result = f.todos.list({});
    expect(result.todos).toHaveLength(25); expect(agents).toHaveBeenCalledTimes(1); expect(projects).toHaveBeenCalledTimes(1);
    expect(result.todos.every((row: { assigneeName: string; departmentName: string; assigneeAvailable: boolean }) => row.assigneeName === "Alice" && row.departmentName === "Alpha" && row.assigneeAvailable)).toBe(true);
    f.agents.splice(0, 1); f.projects[0].name = "Renamed";
    const later = f.todos.list({});
    expect(later.todos.every((row: { assigneeName: string; departmentName: string; assigneeAvailable: boolean }) => row.assigneeName === "Alice" && row.departmentName === "Renamed" && !row.assigneeAvailable)).toBe(true);
    expect(agents).toHaveBeenCalledTimes(2);
  });
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
  it("pauses after an agent turn without mistaking the reply for task completion", () => {
    const f = fixture(), row = f.create(); f.todos.startForAgent("alice", row.id); f.advance(5000);
    f.todos.finishTurn("alice", "completed");
    expect(f.todos.raw(row.id).status).toBe("paused"); expect(f.todos.raw(row.id).phases[0].completedAt).toBeNull();
    expect(f.todos.get({ id: row.id }).todo.elapsedMs).toBe(5000);
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

it("archives a completed goal and records its completion time separately from elapsed time", () => {
  const f = fixture(), row = f.create({ phases: [{ title: "Deliver" }] }); f.change(row.id, "start"); f.advance(4200);
  const finished = f.change(row.id, "complete", { phaseId: row.phases[0].id });
  expect(finished).toMatchObject({ status: "done", archived: true, completedAt: 5200, elapsedMs: 4200 });
  expect(f.todos.list().total).toBe(0); expect(f.todos.list().departments.find((p: { id: string }) => p.id === "alpha").total).toBe(0);
  expect(f.todos.list({ status: "done" }).todos[0].id).toBe(row.id);
  expect(f.todos.list({ status: "archived" }).todos[0].completedAt).toBe(5200);
});
it("keeps completion time stable when completed documentation is edited later", () => {
  const f = fixture(), row = f.create({ phases: [{ title: "Deliver" }] }); f.change(row.id, "start"); f.advance(1200);
  const finished = f.change(row.id, "complete", { phaseId: row.phases[0].id }); f.advance(90000);
  const updated = f.change(row.id, "edit", { documentation: "More evidence" });
  expect(updated.completedAt).toBe(finished.completedAt); expect(updated.archived).toBe(true); expect(updated.phases).toEqual(finished.phases);
  expect(() => f.change(row.id, "restore")).toThrow(/Add a phase or reopen/);
});
it("adds follow-up work to an archived goal without resetting completed phases", () => {
  const f = fixture(), row = f.create({ phases: [{ title: "Deliver" }] }); f.change(row.id, "start"); f.advance(1200);
  const finished = f.change(row.id, "complete", { phaseId: row.phases[0].id }); f.advance(5000);
  const followup = f.change(row.id, "edit", { phases: [{ id: row.phases[0].id, title: "Deliver" }, { title: "Follow up" }] });
  expect(followup).toMatchObject({ status: "queued", archived: false, completedAt: null }); expect(followup.phases[0]).toEqual(finished.phases[0]);
  expect(f.todos.list().total).toBe(1); f.change(row.id, "start"); f.advance(800);
  const completed = f.change(row.id, "complete", { phaseId: followup.phases[1].id });
  expect(completed).toMatchObject({ status: "done", archived: true, completedAt: 8000, elapsedMs: 2000 }); expect(completed.phases[0]).toEqual(finished.phases[0]);
});
it("allows undoing a phase completion from the archive and returns it to follow-up work", () => {
  const f = fixture(), row = f.create({ phases: [{ title: "Deliver" }] }); f.change(row.id, "start"); f.advance(700);
  f.change(row.id, "complete", { phaseId: row.phases[0].id }); f.advance(6000);
  const reopened = f.change(row.id, "reopen", { phaseId: row.phases[0].id });
  expect(reopened).toMatchObject({ status: "running", archived: false, completedAt: null, elapsedMs: 700 }); expect(f.todos.list().total).toBe(1);
});
it("migrates legacy completed work using phase timestamps, never its edit or archive date", () => {
  const f = fixture(), row = f.create(); f.change(row.id, "start");
  for (const phase of row.phases) { f.advance(2000); f.change(row.id, "complete", { phaseId: phase.id }); }
  const file = path.join(f.directory, "todos", row.id + ".json"), legacy = JSON.parse(readFileSync(file, "utf8"));
  delete legacy.completedAt; legacy.archived = false; legacy.updatedAt = 999000; writeFileSync(file, JSON.stringify(legacy)); f.advance(1000000);
  const restored = new OfficeTodos(f.directory, f.deps), historical = restored.get({ id: row.id }).todo;
  expect(historical).toMatchObject({ archived: true, completedAt: 7000, updatedAt: 999000 }); expect(historical.phases).toEqual(legacy.phases); expect(restored.list().total).toBe(0);
  const again = new OfficeTodos(f.directory, f.deps); expect(again.get({ id: row.id }).todo.revision).toBe(historical.revision);
});
it("does not invent a historical completion date when the original timestamp was not recorded", () => {
  const f = fixture(), row = f.create(), file = path.join(f.directory, "todos", row.id + ".json");
  const legacy = JSON.parse(readFileSync(file, "utf8")); legacy.status = "done"; delete legacy.completedAt; legacy.updatedAt = 123456; writeFileSync(file, JSON.stringify(legacy));
  const restored = new OfficeTodos(f.directory, f.deps); expect(restored.get({ id: row.id }).todo).toMatchObject({ archived: true, completedAt: null });
});
