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
describe("stable company task codes", () => {
  it("keeps codes across duplicate requests, renames, completion, follow-up and restart without recycling", () => {
    const f = fixture();
    const request = { requestId: "stable-request", title: "Same name" };
    const a = f.create(request), b = f.create({ title: "Same name" });
    expect([a.code, b.code]).toEqual(["T1", "T2"]);
    expect(f.create(request)).toMatchObject({ id: a.id, code: a.code });
    f.change(a.code, "edit", { title: "Renamed" });
    for (const phase of a.phases) f.change(a.code, "complete", { phaseId: phase.id });
    expect(f.todos.get({ id: a.code }).todo).toMatchObject({ id: a.id, code: "T1", archived: true });
    expect(f.create().code).toBe("T3");
    f.change(a.code, "edit", { phases: [...f.todos.raw(a.code).phases, { title: "Follow-up" }] });
    const restored = new OfficeTodos(f.directory, f.deps);
    expect(restored.get({ id: " t1 " }).todo).toMatchObject({ id: a.id, title: "Renamed", code: "T1", archived: false });
    expect(restored.create({ requestId: "after-restart", title: "Next", phases: [{ title: "Verify" }] }).todo.code).toBe("T4");
  });
  it("backfills legacy tasks deterministically above all saved codes without changing their business state", () => {
    const f = fixture(), a = f.create(), b = f.create(), c = f.create();
    const originals = new Map<string, Record<string, unknown>>();
    for (const [index, task] of [a, b, c].entries()) {
      const file = path.join(f.directory, "todos", task.id + ".json"), row = JSON.parse(readFileSync(file, "utf8"));
      if (task.id === b.id) row.code = "T37"; else delete row.code;
      row.createdAt = 100 + index; writeFileSync(file, JSON.stringify(row)); originals.set(task.id, row);
    }
    const restored = new OfficeTodos(f.directory, f.deps);
    expect([a, b, c].map(task => restored.raw(task.id).code)).toEqual(["T38", "T37", "T39"]);
    for (const task of [a, b, c]) {
      const saved = JSON.parse(readFileSync(path.join(f.directory, "todos", task.id + ".json"), "utf8"));
      expect(saved).toEqual({ ...originals.get(task.id), code: restored.raw(task.id).code });
    }
    const bytes = [a, b, c].map(task => readFileSync(path.join(f.directory, "todos", task.id + ".json"), "utf8"));
    const again = new OfficeTodos(f.directory, f.deps);
    expect([a, b, c].map(task => readFileSync(path.join(f.directory, "todos", task.id + ".json"), "utf8"))).toEqual(bytes);
    expect(again.create({ requestId: "new", title: "Next", phases: [{ title: "Plan" }] }).todo.code).toBe("T40");
  });
  it("resolves code lookups through existing mutations and actor checks, retaining canonical bindings", () => {
    const f = fixture(), task = f.create();
    f.todos.startForAgent("alice", task.code);
    const revision = f.todos.raw(task.id).revision;
    f.todos.startForAgent("alice", task.code);
    expect(f.todos.bindings.get("alice")).toBe(task.id);
    expect(f.todos.raw(task.code).revision).toBe(revision);
    f.change(task.code, "delegate", { actorId: "alice", assigneeId: "bob", instructions: "Implement", acceptanceCriteria: "Verify" });
    expect(f.change(task.code, "edit", { actorId: "alice", title: "Updated by manager" }).title).toBe("Updated by manager");
    expect(f.change(task.code, "edit", { actorId: "bob", title: "Updated by worker" })).toMatchObject({ id: task.id, code: task.code });
    expect(() => f.todos.raw("Updated by worker")).toThrow(/missing/);
    expect(f.todos.list({ query: task.code }).todos[0].id).toBe(task.id);
  });
  it("refuses duplicate persisted codes rather than rebinding an existing reference", () => {
    const f = fixture(), a = f.create(), b = f.create();
    const file = path.join(f.directory, "todos", b.id + ".json"), row = JSON.parse(readFileSync(file, "utf8"));
    row.code = a.code; writeFileSync(file, JSON.stringify(row));
    expect(() => new OfficeTodos(f.directory, f.deps)).toThrow(/duplicate task code/);
    expect(JSON.parse(readFileSync(file, "utf8")).code).toBe(a.code);
  });
});
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
    expect(f.change(row.id, "edit", { actorId: "alice", documentation: "Owner can update shared research" }).documentation).toBe("Owner can update shared research");
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
    const current = f.change(row.id, "edit", { documentation: "Evidence", removedPhaseIds: [row.phases[1].id], phases: [{ id: row.phases[0].id, title: "Research" }, { title: "New step" }, { id: row.phases[2].id, title: "Validate" }] });
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
    expect(current.status).toBe("running"); expect(current.phases[0].startedAt).toBeNull(); expect(current.elapsedMs).toBe(15000); expect(current.revision).toBe(3);
    expect(JSON.parse(readFileSync(path.join(f.directory, "todos", row.id + ".json"), "utf8")).status).toBe("running");
  });
  it("resumes the last active assignment after restart instead of a newer queued task", () => {
    const f = fixture(), active = f.create(); f.change(active.id, "start"); f.advance(5000); f.todos.checkpoint();
    f.advance(1000); f.create();
    const restored = new OfficeTodos(f.directory, f.deps);
    expect(restored.bound("alice").id).toBe(active.id);
    expect(restored.bound("alice").status).toBe("running");
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
    expect(f.todos.raw(row.id).status).toBe("running"); expect(f.todos.raw(row.id).phases[0].startedAt).toBeNull(); expect(f.todos.raw(row.id).phases[0].completedAt).toBeNull();
    expect(f.todos.get({ id: row.id }).todo.elapsedMs).toBe(5000);
  });
  it("runs one phase per owner and leaves unrelated agents untouched", () => {
    const f = fixture(), first = f.create(), second = f.create(), other = f.create({ assigneeId: "bob" });
    f.change(first.id, "start"); f.change(other.id, "start"); f.advance(1000); f.change(second.id, "start");
    expect(f.todos.raw(first.id).status).toBe("running"); expect(f.todos.raw(first.id).phases[0].startedAt).toBeNull(); expect(f.todos.raw(other.id).status).toBe("running");
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

describe("collaborative metadata edits preserve workflow authority", () => {
  const setup = (state: "working" | "review" | "accepted" | "done") => {
    const f = fixture(); f.agents.push({ id: "carol", name: "Owner", projectId: "alpha" }, { id: "dave", name: "Other member", projectId: "beta" });
    const task = f.create({ actorId: "alice", ownerId: "carol" });
    f.change(task.id, "delegate", { actorId: "alice", assigneeId: "bob", instructions: "Implement", acceptanceCriteria: "Verify" });
    f.change(task.id, "start", { actorId: "bob" }); f.advance(250);
    if (state !== "working") f.change(task.id, "submit", { actorId: "bob", report: "Evidence" });
    if (["accepted", "done"].includes(state)) f.change(task.id, "review", { actorId: "alice", accept: true, notes: "Verified" });
    if (state === "done") for (const phase of task.phases) f.change(task.id, "complete", { actorId: "alice", phaseId: phase.id });
    return { ...f, task };
  };
  for (const state of ["working", "review", "accepted", "done"] as const) {
    it.each(["alice", "bob", "carol", "dave", undefined])(`allows ordinary edits in ${state} by %s without changing execution, acceptance or completion`, actorId => {
      const f = setup(state), before = f.todos.get({ id: f.task.id }).todo;
      const next = f.change(f.task.id, "edit", { actorId, title: "Shared title", documentation: "Shared evidence", ownerId: "dave",
        phases: before.phases.map((phase: { id: string; title: string }) => ({ id: phase.id, title: phase.title, notes: "Updated notes" })) });
      expect(next).toMatchObject({ title: "Shared title", documentation: "Shared evidence", ownerId: "dave", assigneeId: before.assigneeId,
        acceptanceManagerId: before.acceptanceManagerId, handlingAgentId: before.handlingAgentId, reviewerId: before.reviewerId,
        archived: before.archived, status: before.status, completedAt: before.completedAt, elapsedMs: before.elapsedMs, delegations: before.delegations });
      expect(next.phases.map((phase: { id: string; completedAt: number | null }) => [phase.id, phase.completedAt])).toEqual(before.phases.map((phase: { id: string; completedAt: number | null }) => [phase.id, phase.completedAt]));
      expect(next.events.at(-1).actor).toMatchObject(actorId ? { source: "agent", id: actorId } : { source: "user" });
    });
  }
  it("rejects unknown actors, stale revisions and invalid phase plans without writing anything", () => {
    const f = setup("working"), before = structuredClone(f.todos.raw(f.task.id));
    expect(() => f.change(f.task.id, "edit", { actorId: "not-a-member", title: "No" })).toThrow(/existing Office agent/);
    expect(() => f.todos.change({ id: f.task.id, revision: before.revision - 1, actorId: "carol", title: "Stale" }, "edit")).toThrow(/changed/);
    expect(() => f.change(f.task.id, "edit", { actorId: "dave", phases: [] })).toThrow(/1–20/);
    expect(() => f.change(f.task.id, "edit", { actorId: "dave", phases: [{ id: "unknown-phase", title: "No" }] })).toThrow(/Phase is missing/);
    expect(() => f.change(f.task.id, "edit", { actorId: "dave", phases: [before.phases[0], before.phases[0]] })).toThrow(/unique/);
    expect(f.todos.raw(f.task.id)).toEqual(before);
  });
  it.each(["bob", "carol", "dave"])("prevents %s clearing final acceptance by reassigning after an accepted handoff", actorId => {
    const f = setup("accepted"), before = structuredClone(f.todos.raw(f.task.id));
    expect(() => f.change(f.task.id, "edit", { actorId, assigneeId: "dave", ownerId: actorId })).toThrow(/current responsible/);
    expect(f.todos.raw(f.task.id)).toEqual(before);
    expect(f.change(f.task.id, "edit", { actorId: "alice", assigneeId: "dave" })).toMatchObject({ assigneeId: "dave", acceptanceManagerId: null });
  });
  it.each(["bob", "carol", "dave"])("prevents %s closing an unaccepted goal by removing its unfinished phases", actorId => {
    const f = setup("accepted"); f.change(f.task.id, "complete", { actorId: "alice", phaseId: f.task.phases[0].id });
    const before = structuredClone(f.todos.raw(f.task.id));
    expect(() => f.change(f.task.id, "edit", { actorId, phases: [before.phases[0]], removedPhaseIds: before.phases.slice(1).map((p: { id: string }) => p.id) })).toThrow(/manager can close/);
    expect(() => f.change(f.task.id, "edit", { actorId, assigneeId: "dave", phases: [before.phases[0]], removedPhaseIds: before.phases.slice(1).map((p: { id: string }) => p.id) })).toThrow(/manager can close/);
    expect(f.todos.raw(f.task.id)).toEqual(before);
    expect(f.change(f.task.id, "edit", { actorId: "alice", phases: [before.phases[0]], removedPhaseIds: before.phases.slice(1).map((p: { id: string }) => p.id) }).status).toBe("done");
  });
  it.each(["alice", "bob", "carol", "dave", undefined])("keeps active handoff final acceptance and reassignment protection for %s", actorId => {
    const f = setup("working"); f.change(f.task.id, "complete", { actorId: "bob", phaseId: f.task.phases[0].id });
    const before = structuredClone(f.todos.raw(f.task.id));
    expect(() => f.change(f.task.id, "edit", { actorId, phases: [before.phases[0]], removedPhaseIds: before.phases.slice(1).map((p: { id: string }) => p.id) })).toThrow(/manager acceptance/);
    expect(() => f.change(f.task.id, "edit", { actorId, assigneeId: "dave" })).toThrow(/active delegation/);
    expect(f.todos.raw(f.task.id)).toEqual(before);
  });
  for (const state of ["working", "review", "accepted"] as const) it.each(["start", "pause", "complete", "reopen", "archive", "restore", "delegate", "submit", "review"])(`does not give a metadata editor execution or review authority in ${state}: %s`, action => {
    const f = setup(state), before = structuredClone(f.todos.raw(f.task.id));
    f.change(f.task.id, "edit", { actorId: "carol", documentation: "Owner added evidence" });
    const edited = structuredClone(f.todos.raw(f.task.id));
    expect(() => f.change(f.task.id, action, { actorId: "carol", phaseId: before.phases[0].id, assigneeId: "dave", report: "No", accept: true, notes: "No", instructions: "No", acceptanceCriteria: "No" })).toThrow();
    expect(f.todos.raw(f.task.id)).toEqual(edited);
  });
  it("preserves the archived unfinished lifecycle rule", () => {
    const f = fixture(), task = f.create(); f.change(task.id, "archive");
    expect(() => f.change(task.id, "edit", { actorId: "bob", ownerId: "bob" })).toThrow(/Restore this archived/);
  });
});
