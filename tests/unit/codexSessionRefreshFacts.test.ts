// @vitest-environment node
import { createRequire } from "node:module";
import { expect, it } from "vitest";
const { refreshFacts } = createRequire(import.meta.url)("../../server/codex-session-refresh-facts.js");
function fixture() {
  const deps = {
    store: { get: () => ({ refreshCheckpoint: null as unknown }) }, controls: {}, userSends: { unavailable: false, blocked: (() => false) as (id: string) => boolean },
    delivery: { data: { messages: {} as Record<string, unknown>, batches: {} as Record<string, unknown> }, sources: (): Record<string, unknown>[] => [], inflight: new Map(), urgentInflight: new Map(), refreshPreparing: new Map() },
    delegation: { inflight: new Map() }, schedules: { data: { tasks: [] as Record<string, unknown>[] } }, voice: { active: null as unknown }, workspace: { starts: new Map(), snapshot: (): Record<string, unknown> | null => null },
    todos: { rows: new Map() }, reservation: { held: false }, stopping: () => false,
  };
  return { deps, reasons: (trigger?: unknown, mode = "automatic") => refreshFacts(deps, "worker", trigger, mode) };
}
it("keeps unrelated employees' tasks, deliveries, voice and terminals running", () => {
  const f = fixture(); f.deps.delivery.inflight.set("other", true); f.deps.voice.active = { threadId: "other" }; f.deps.workspace.starts.set("other", true);
  f.deps.todos.rows.set("unrelated", { id: "unrelated", executionMode: "phases", ownerId: "other", phases: [{ assigneeId: "other", status: "running" }] });
  expect(f.reasons()).toEqual([]);
});
it.each(["journal", "unavailable", "inbox", "urgent", "delivery", "batch", "voice", "terminal", "schedule", "future schedule", "reservation"])("blocks the actual %s target boundary", kind => {
  const f = fixture();
  if (kind === "journal") f.deps.userSends.blocked = id => id === "worker";
  if (kind === "unavailable") f.deps.userSends.unavailable = true;
  if (kind === "inbox") f.deps.delivery.data.messages.message = { recipient: "worker", state: "pending" };
  if (kind === "urgent") f.deps.delivery.urgentInflight.set("worker", true);
  if (kind === "delivery") f.deps.delegation.inflight.set("worker", true);
  if (kind === "batch") f.deps.delivery.data.batches.batch = { recipient: "worker", state: "uncertain" };
  if (kind === "voice") f.deps.voice.active = { threadId: "worker" };
  if (kind === "terminal") f.deps.workspace.starts.set("worker", true);
  if (kind === "schedule") f.deps.schedules.data.tasks.push({ threadId: "worker", runs: [{ status: "unknown" }] });
  if (kind === "future schedule") f.deps.schedules.data.tasks.push({ threadId: "worker", enabled: true, nextRunAt: 100 });
  if (kind === "reservation") f.deps.reservation.held = true;
  expect(f.reasons().length).toBeGreaterThan(0);
  expect(f.reasons(undefined, "manual").length).toBeGreaterThan(0);
});
it("checks all unfinished assignments and manager follow-ups rather than a truncated context page", () => {
  const f = fixture();
  for (let n = 0; n < 30; n++) f.deps.todos.rows.set(String(n), { id: String(n), status: "done", phases: [] });
  f.deps.todos.rows.set("last", { id: "last", ownerId: "worker", executionMode: "phases", phases: [{ status: "review", assigneeId: "subordinate" }], delegations: [{ managerId: "worker", workerId: "subordinate", state: "review" }] });
  expect(f.reasons()).toEqual(expect.arrayContaining([expect.stringContaining("Follow-up"), expect.stringContaining("acceptance")]));
});
it("exempts only one exact unchanged trigger and its queued zero-time phase", () => {
  const f = fixture(), source = { id: "source", hash: "hash", taskId: "new-task", phaseId: "new-phase", recipient: "worker", state: "pending" };
  f.deps.delivery.sources = () => [source]; f.deps.delivery.inflight.set("worker", true); f.deps.delivery.refreshPreparing.set("worker", source.id);
  f.deps.todos.rows.set("new-task", { id: "new-task", ownerId: "head", executionMode: "phases", phases: [{ id: "new-phase", status: "queued", assigneeId: "worker", elapsedMs: 0 }], delegations: [{ phaseId: "new-phase", managerId: "head", workerId: "worker", state: "working", delivery: { requestId: source.id } }] });
  const intent = { requestId: source.id, sourceHash: source.hash, nextScope: { taskId: source.taskId, phaseId: source.phaseId } };
  expect(f.reasons(intent)).toEqual([]);
  expect(f.reasons({ ...intent, sourceHash: "changed" }).length).toBeGreaterThan(0);
  f.deps.delivery.data.messages.another = { id: "other", recipient: "worker", state: "pending" };
  expect(f.reasons(intent)).toContain("An inbox message or task report is pending or unconfirmed");
});
it("does not call a later phase of the same goal an independent topic", () => {
  const f = fixture(), source = { id: "source", hash: "hash", taskId: "task", phaseId: "new", recipient: "worker", state: "pending" };
  f.deps.store.get = () => ({ refreshCheckpoint: { closedScope: { kind: "task", taskId: "task", phaseId: "old" } } });
  f.deps.delivery.sources = () => [source]; f.deps.todos.rows.set("task", { id: "task", executionMode: "phases", ownerId: "head", phases: [{ id: "old", status: "done" }, { id: "new", status: "queued", assigneeId: "worker" }] });
  expect(f.reasons({ requestId: source.id, sourceHash: source.hash, nextScope: { taskId: "task", phaseId: "new" } })).toContain("The next phase of the same task is not a separate independent topic");
});

it.each(["queued", "running", "review"])("blocks an independent acceptance manager before any handoff exists (%s)", status => {
  const f = fixture(), phase = { id: "phase", assigneeId: "executor", acceptanceManagerId: "worker", status, completedAt: null as number | null };
  f.deps.todos.rows.set("task", { id: "task", ownerId: "owner", executionMode: "phases", phases: [phase], delegations: [] });
  expect(f.reasons()).toContain("Independent acceptance responsibility remains open in task");
  phase.status = "done"; phase.completedAt = 1; expect(f.reasons()).toEqual([]);
});

it.each(["queued", "paused", "running", "review"])("manual preserves unfinished %s task/owner/review/report responsibility while automatic blocks", status => {
  const f = fixture();
  const task = { id: "task", code: "T251", executionMode: "phases", ownerId: "worker", phases: [{ id: "phase", status, assigneeId: "worker", acceptanceManagerId: "worker" }], delegations: [{ phaseId: "phase", managerId: "worker", workerId: "subordinate", state: "review" }] };
  f.deps.todos.rows.set("task", task); const before = structuredClone(task);
  expect(f.reasons(undefined, "manual")).toEqual([]);
  expect(f.reasons()).toEqual(expect.arrayContaining([expect.stringContaining("Unfinished assigned"), expect.stringContaining("Independent acceptance"), expect.stringContaining("Follow-up"), expect.stringContaining("worker report")]));
  expect(task).toEqual(before);
  f.deps.delivery.data.messages.report = { recipient: "worker", state: "pending" };
  expect(f.reasons(undefined, "manual")).toContain("An inbox message or task report is pending or unconfirmed");
});
