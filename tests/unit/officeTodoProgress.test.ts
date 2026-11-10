// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
const { taskTracking } = createRequire(import.meta.url)("../../server/office-todo-progress.js");
const { OfficeTodos } = createRequire(import.meta.url)("../../server/office-todos.js");
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
const actor = { id: "worker", name: "Worker", source: "agent" };
it("keeps real progress and current pause age unchanged by document-only edits or updatedAt", () => {
  const row = { executionMode: "phases", phases: [{ id: "p", title: "Build", status: "paused", lastStartedAt: 1000, activity: { agentId: "worker", startedAt: 1000 } }], events: [
    { at: 1000, message: "Started phase: Build", actor }, { at: 2000, message: "Paused phase: Build", actor }, { at: 9000, message: "Plan, phase assignments or documentation updated", actor },
  ], updatedAt: 9000 };
  const tracking = taskTracking(row);
  expect(tracking.recent).toHaveLength(1); expect(tracking.recent[0]).toMatchObject({ action: "Started", at: 1000, actorId: "worker", phaseId: "p" });
  expect(tracking.current[0]).toMatchObject({ since: 2000, status: "paused", reason: null });
});
it("uses structured handoff submission/review identity, time and feedback once without duplicating display events", () => {
  const row = { executionMode: "phases", phases: [{ id: "p", title: "Build", status: "review" }], delegations: [{ phaseId: "p", managerId: "head", workerId: "worker", state: "review", createdAt: 100, submittedAt: 2000, report: "Implemented and verified" }], events: [{ at: 2000, message: "Submitted phase for manager acceptance: Build", actor }] };
  const tracking = taskTracking(row);
  expect(tracking.recent.filter((e: { action: string }) => e.action === "Submitted")).toHaveLength(1);
  expect(tracking.recent[0]).toMatchObject({ actorId: "worker", at: 2000, detail: "Implemented and verified" });
  expect(tracking.current[0]).toMatchObject({ status: "review", since: 2000, waitingForId: "head", reasonCode: "Submitted for manager acceptance" });
  const returned = taskTracking({ ...row, phases: [{ id: "p", title: "Build", status: "queued" }], delegations: [{ ...row.delegations[0], state: "working", review: { at: 3000, managerId: "head", accepted: false, notes: "Missing mobile check" } }] });
  expect(returned.recent[0]).toMatchObject({ action: "Returned", actorId: "head", at: 3000 });
  expect(returned.current[0]).toMatchObject({ since: 3000, reason: "Missing mobile check", waitingForId: "worker" });
});
it("pairs parallel phase pause/start records without attributing an ambiguous system pause to either person", () => {
  const phases = [{ id: "a", title: "A", status: "paused", lastStartedAt: 1000 }, { id: "b", title: "B", status: "running", lastStartedAt: 1100 }];
  const t = taskTracking({ executionMode: "phases", phases, events: [{ at: 1000, message: "Started phase: A", actor }, { at: 1100, message: "Started phase: B", actor: { id: "bob" } }, { at: 1200, message: "Paused phase: A", actor }] });
  expect(t.current).toMatchObject([{ phaseId: "a", since: 1200 }, { phaseId: "b", since: 1100 }]);
  const ambiguous = taskTracking({ executionMode: "phases", phases: phases.map(p => ({ ...p, status: "paused" })), events: [{ at: 1200, message: "Agent turn completed; phase timer paused", actor: { source: "system" } }] });
  expect(ambiguous.current.every((p: { since: number | null }) => p.since === null)).toBe(true);
});
it("keeps legacy task-level progress and real stop reasons without using edited lastStartedAt or guessing its first phase", () => {
  const row = { status: "paused", lastStartedAt: 9000, phases: [{ id: "p", title: "Build", completedAt: 1000 }, { id: "q", title: "Next" }], events: [
    { at: 1000, message: "Completed phase: Build", actor }, { at: 2000, message: "Agent turn ended; waiting for follow-up or a phase update", actor: { source: "system" } }, { at: 9000, message: "Plan, assignment or documentation updated", actor },
  ] };
  const tracking = taskTracking(row);
  expect(tracking.recent[0]).toMatchObject({ action: "Completed", at: 1000, phaseId: "p" });
  expect(tracking.current[0]).toMatchObject({ phaseId: null, since: 2000, reason: "Agent turn ended; waiting for follow-up or a phase update" });
  expect(taskTracking({ ...row, status: "running", events: [] }).current[0].since).toBeNull();
  const metadataOnly = taskTracking({ ...row, status: "running", activity: { agentId: "worker", startedAt: 9000 }, events: [{ at: 9000, message: "Plan, assignment or documentation updated", actor }] });
  expect(metadataOnly.recent).toEqual([]); expect(metadataOnly.current[0].since).toBeNull();
});
it("retains unscoped custom pause wording as a note without pretending it proves phase identity or state start", () => {
  const row = { executionMode: "phases", phases: [{ id: "a", title: "A", status: "paused" }, { id: "b", title: "B", status: "paused" }], events: [{ at: 4000, message: "Waiting for the user to provide access", actor }] };
  expect(taskTracking(row)).toMatchObject({ recent: [], unscopedNote: { at: 4000, text: "Waiting for the user to provide access" }, current: [{ since: null, reason: null }, { since: null, reason: null }] });
});
it("bounds history and report payload and does not expose instructions or change records", () => {
  const row = { phases: [], status: "queued", delegations: Array.from({ length: 120 }, (_, i) => ({ state: "accepted", createdAt: i, managerId: "head", workerId: "worker", submittedAt: i + 1000, report: "x".repeat(6000), instructions: "PRIVATE", acceptanceCriteria: "PRIVATE" })), events: Array.from({ length: 150 }, (_, i) => ({ at: i, message: "Work started", actor })) };
  const before = JSON.stringify(row), tracking = taskTracking(row);
  expect(tracking.recent).toHaveLength(3); expect(tracking.historyLimited).toBe(true);
  expect(tracking.recent.every((e: { detail: string }) => e.detail.length <= 180)).toBe(true);
  expect(JSON.stringify(tracking)).not.toContain("PRIVATE"); expect(JSON.stringify(row)).toBe(before);
});
it("projects the ordinary list from real store operations without extra storage or mutation, preserving the default contract", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "head-progress-")); directories.push(root); let now = 1000;
  const store = new OfficeTodos(root, { now: () => now, agents: () => [{ id: "worker", name: "Worker" }], projects: () => [], changed: () => {} });
  const created = store.create({ requestId: "r", title: "Task", ownerId: "worker", assigneeId: "worker", phases: [{ title: "Build" }] }).todo;
  const change = (action: string, extra = {}) => store.change({ id: created.id, revision: store.raw(created.id).revision, actorId: "worker", ...extra }, action);
  change("start"); now = 2000; change("pause", { reason: "Agent switched to another to-do" }); now = 9000; change("edit", { documentation: "Routine progress note" });
  const file = path.join(root, "todos", created.id + ".json"), bytes = readFileSync(file);
  expect(store.list({}).todos[0].tracking).toBeUndefined();
  const tracking = store.list({ includeProgress: true }).todos[0].tracking;
  expect(tracking.recent[0]).toMatchObject({ action: "Started", at: 1000 });
  expect(tracking.current).toMatchObject([{ since: 2000, reason: "Agent switched to another to-do" }]);
  expect(readFileSync(file)).toEqual(bytes);
});
