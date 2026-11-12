// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, appendFile, readFile, readdir, stat, rm, rename, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsageDetail } from "@/features/ring-ship/ai-center";
const { OfficeTokenUsage, usageOf, parameters } = createRequire(import.meta.url)("../../server/office-token-usage.js");
const roots: string[] = [], collectors: { close(): Promise<void> }[] = [];
const NOW = Date.parse("2026-11-08T12:00:00Z"), DATE = "2026-11-08", TS = "2026-11-08T01:00:00Z";
const usage = { input_tokens: 100, cached_input_tokens: 60, cache_write_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 120 };
const event = (type: string, payload: unknown, timestamp = TS, ordinal = 1) => JSON.stringify({ timestamp, ordinal, type, payload }) + "\n";
const meta = (thread = "native-one", version = "0.166.0") => event("session_meta", { creator_account_id: "DO_NOT_EXPORT", id: thread, runtime_workspace_roots: ["/fixture"], cli_version: version, base_instructions: { text: "PRIVATE_INSTRUCTIONS".repeat(10000) } });
const context = (turn = "turn-one", model = "model-a") => event("turn_context", { turn_id: turn, model, effort: "high", summary: "PRIVATE_CONTEXT" });
const record = (response = "resp-one", extra: Record<string, unknown> = {}, timestamp = TS, ordinal = 2) => event("token_usage_record", { thread_id: "native-one", turn_id: "turn-one", root_turn_id: "root", response_id: response, usage, turn_token_usage: { ...usage, total_tokens: 999999 }, thread_token_usage: { total_tokens: 9999999 }, ...extra }, timestamp, ordinal);
async function fixture(options: Record<string, unknown> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "office-token-test-")); roots.push(root);
  const home = path.join(root, "codex"), folder = path.join(home, "sessions", "2026", "11", "08"); await mkdir(folder, { recursive: true });
  const file = path.join(folder, "rollout-2026-11-08T00-00-00-native-one.jsonl");
  const sessions = [{ id: "agent-one", codexThreadId: "native-one", name: "One" }, { id: "agent-two", codexThreadId: "native-two", name: "Two", archived: true }];
  const paths: Record<string, string> = { "native-one": file };
  let reads = 0;
  const config = { directory: root, home, sessions: () => sessions, resolveSource: async (nativeId: string) => { reads++; return paths[nativeId]; }, now: () => NOW, ...options };
  const create = () => { const collector = new OfficeTokenUsage(config); collectors.push(collector); return collector; };
  const collector = create();
  const collect = async (nativeId = "native-one", c = collector) => { c.hint(nativeId); await c.running; };
  const detail = (p: Record<string, unknown> = {}, c = collector): Promise<UsageDetail> => c.detail({ date: DATE, timeZone: "UTC", ...p });
  return { root, home, file, paths, sessions, collector, collect, detail, create, reads: () => reads };
}
afterEach(async () => { for (const c of collectors.splice(0)) await c.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it("keeps a full measured-only priced snapshot across sources, more than 100 rows, pagination and unknown usage", async () => {
  const f = await fixture();
  f.collector.bindTurn({ nativeThreadId: "native-one", turnId: "turn-one", taskId: "task-one", purpose: { id: "chat_work", trigger: "userMessage", basis: "businessEntry" } }); await f.collector.running;
  await writeFile(f.file, meta() + context("turn-one", "gpt-6.1-sol") + Array.from({ length: 125 }, (_, i) => record(`breakdown-${i}`)).join("") + context("turn-one", "unknown-model") + record("unknown-price"));
  await f.collect();
  // Existing dictation adapter supports partial fields. Its input must not be
  // mixed into the total-known composition denominator.
  f.collector.rows.set("partial-fixture", { source: { kind: "dictation" }, providerKind: "openaiApi", attemptId: "partial", officeAgentId: "agent-one", observedAt: TS, usage: { input: 5000, cachedInput: null, uncachedInput: null, cacheWriteInput: null, output: null, reasoningOutput: null, otherOutput: null, total: null }, configuredModel: null });
  const first = await f.detail({ schemaVersion: 2, includeRecords: false });
  const b = first.breakdown!; expect(first.rows).toEqual([]); expect(b.denominatorTokens).toBe(126 * 120); expect(b.measuredComponents.input.knownSubtotal).toBe(126 * 100);
  expect(b.measuredComponents.cacheWriteInput).toEqual({ knownSubtotal: null, reportedRows: 0, unknownRows: 126 });
  expect(first.purposeSummary.components.input.knownSubtotal).toBe(12600 + 5000); expect(b.cost).toMatchObject({ rangeResponses: 125, unpricedResponses: 2, estimatedKnownTokens: 15000, unpricedKnownTokens: 120, unknownUsageResults: 1 });
  for (const groups of Object.values(b.contributors)) { expect(groups.reduce((sum, group) => sum + (group.knownTokens || 0), 0)).toBe(b.denominatorTokens); expect(groups.reduce((sum, group) => sum + (group.cost.minUsd || 0), 0)).toBeCloseTo(b.cost.minUsd!, 10); expect(groups.reduce((sum, group) => sum + (group.cost.maxUsd || 0), 0)).toBeCloseTo(b.cost.maxUsd!, 10); }
  expect(b.activity.status).toBe("notRecorded");
  const page = await f.detail({ schemaVersion: 2, snapshot: first.snapshot, limit: 50 }); expect(page.rows).toHaveLength(50); expect(page.breakdown).toEqual(b); expect(page.rows.every(row => row.cost?.pricingVersion === b.pricing.version)).toBe(true);
  const next = await f.detail({ schemaVersion: 2, cursor: page.nextCursor, limit: 50 }); expect(next.rows).toHaveLength(50); expect(next.breakdown).toEqual(b);
  const source = await f.detail({ schemaVersion: 2, snapshot: first.snapshot, purpose: "dictation" }); expect(source.breakdown).toEqual(b); expect(source.count).toBe(1);
  const narrowed = await f.detail({ schemaVersion: 2, taskId: "task-one" }); expect(narrowed.breakdown?.cost.unknownUsageResults).toBe(0); expect(narrowed.snapshot).not.toBe(first.snapshot);
  expect((await f.detail()).breakdown).toBeUndefined();
});

describe("observed response projection", () => {
  it("counts three responses in one turn, equal usage at different IDs, and the four disjoint parts", async () => {
    const f = await fixture();
    await writeFile(f.file, meta() + context() + record() + record("resp-two") + record("resp-three", { usage: { ...usage, input_tokens: 140, cached_input_tokens: 100, total_tokens: 160 } }, TS, 4));
    await f.collect(); const result = await f.detail();
    expect(result.count).toBe(3); expect(result.rows[0].responseId).toBe("resp-three"); expect(result.totals?.total).toBe(400);
    expect(result.rows[1].usage).toEqual({ input: 100, cachedInput: 60, cacheWriteInput: 0, uncachedInput: 40, output: 20, reasoningOutput: 5, otherOutput: 15, total: 120 });
    expect(result.rows[0].sameTurnResponses).toBe(3);
    expect(result.rows[0].previousObservedInput).toMatchObject({ input: 100, change: 40 });
    expect(result.rows[0]).toMatchObject({ configuredModel: "model-a", configuredEffort: "high", modelBasis: "turnContext", actualModel: null, status: "unknown", taskId: null, attributionBasis: "unknown" });
    expect(result.coverage.readySources).toBe(1);
    const exported = JSON.stringify(result);
    expect(exported).not.toMatch(/PRIVATE_|DO_NOT_EXPORT|relativeFile|sessions\/|999999|base_instructions|summary/);
    const derived = (await readdir(path.join(f.root, "token-usage"))).filter(n => n.endsWith(".jsonl"));
    expect(await readFile(path.join(f.root, "token-usage", derived[0]), "utf8")).not.toMatch(/PRIVATE_|DO_NOT_EXPORT|999999/);
    expect((await stat(path.join(f.root, "token-usage"))).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(f.root, "token-usage", derived[0]))).mode & 0o777).toBe(0o600);
  });
  it("deduplicates crash rereads, fork inheritance and nested compaction, but exposes conflicting IDs", async () => {
    const f = await fixture();
    await writeFile(f.file, meta() + context() + record() + record() + event("compacted", { latest_token_usage_record: JSON.parse(record("nested")).payload }) + event("event_msg", { type: "token_count", info: { total_token_usage: usage, last_token_usage: usage } }));
    await f.collect();
    const folder = path.join(f.home, "archived_sessions"); await mkdir(folder);
    f.paths["native-two"] = path.join(folder, "rollout-old-native-two.jsonl");
    await writeFile(f.paths["native-two"], meta("native-two") + context() + record() + record("child-own", { thread_id: "native-two" }));
    await f.collect("native-two"); expect((await f.detail()).count).toBe(2);
    await appendFile(f.file, record("resp-one", { usage: { ...usage, input_tokens: 200, total_tokens: 220 } }));
    await f.collect(); const first = await f.detail();
    expect(first.totals?.total).toBe(240); expect(first.rows.find(r => r.responseId === "resp-one")?.conflict).toBe(true);
    await f.collector.close();
    // Simulate rows durable, offset checkpoint lost; both files reread safely.
    const statePath = path.join(f.root, "token-usage", "state.json"), state = JSON.parse(await readFile(statePath, "utf8"));
    for (const value of Object.values(state.sources) as { offset: number; anchor?: string }[]) { value.offset = 0; delete value.anchor; }
    await writeFile(statePath, JSON.stringify(state));
    const resumed = f.create(); await f.collect("native-one", resumed); await f.collect("native-two", resumed);
    const result = await f.detail({}, resumed); expect(result.count).toBe(2); expect(result.totals?.total).toBe(240); expect(result.coverage.knownGaps.conflictingResponse).toBeGreaterThan(0);
    expect(result.rows.find(r => r.responseId === "child-own")?.officeAgentId).toBe("agent-two");
  });
  it("does not fill missing or invalid usage with zeros, and gates unsupported source versions", async () => {
    const f = await fixture();
    await writeFile(f.file, meta() + record("missing", { usage: null }) + record("bad-subset", { usage: { ...usage, cached_input_tokens: 101 } }) + record("no-id", { response_id: null }) + record("foreign", { thread_id: "foreign" }) + record("good", { status: "failed", model: "guessed-model" }));
    await f.collect(); const result = await f.detail();
    expect(result.count).toBe(1); expect(result.rows[0]).toMatchObject({ configuredModel: null, status: "unknown", actualModel: null });
    expect(result.coverage.knownGaps).toMatchObject({ invalidRecord: 3, unknownOrigin: 1 });
    const folder = path.dirname(f.file); f.paths["native-two"] = path.join(folder, "rollout-old-native-two.jsonl");
    await writeFile(f.paths["native-two"], meta("native-two", "9.0.0") + record("unsupported", { thread_id: "native-two" }));
    await f.collect("native-two"); expect((await f.detail()).coverage.unsupportedSources).toBe(1);
    expect((await f.detail({ agentId: "agent-two" })).totals).toBeNull();
    expect(usageOf({ ...usage, reasoning_output_tokens: 21 })).toBeNull();
    expect(usageOf({ ...usage, total_tokens: 1 })).toBeNull();
    expect(usageOf({ ...usage, input_tokens: null })).toBeNull();
  });
  it("keeps half-line offsets, skips corrupt lines, and resumes after inode replacement and truncation", async () => {
    const f = await fixture({ chunkBytes: 128, lineBytes: 8192 }); const row = record();
    const prefix = meta() + "not json\n" + context();
    await writeFile(f.file, prefix + row.slice(0, 100)); await f.collect();
    expect(f.collector.sources["native-one"].offset).toBe(Buffer.byteLength(prefix));
    expect((await f.detail()).coverage.partialLines).toBe(1);
    await appendFile(f.file, row.slice(100)); await f.collect(); expect((await f.detail()).count).toBe(1);
    const replacement = f.file + ".replacement"; await writeFile(replacement, meta() + context() + record("resp-two")); await rename(replacement, f.file);
    await f.collect(); expect((await f.detail()).count).toBe(2);
    await writeFile(f.file, meta() + record("resp-three")); await f.collect();
    const result = await f.detail(); expect(result.count).toBe(3); expect(result.coverage.knownGaps).toMatchObject({ malformedLine: 1, sourceReplaced: 1, sourceTruncatedOrRewritten: 1 });
    const before = await readFile(f.file); await f.detail(); expect(await readFile(f.file)).toEqual(before);
  });
  it("rejects paths outside the Office realpath allowlist and maps moved archives", async () => {
    const f = await fixture(); await writeFile(f.file, meta() + record()); await f.collect();
    const archived = path.join(f.home, "archived_sessions"); await mkdir(archived); await rename(f.file, path.join(archived, path.basename(f.file)));
    await f.collect(); expect((await f.detail()).count).toBe(1); expect(f.collector.sources["native-one"].file).toMatch(/^archived_sessions\//);
    const outside = path.join(f.root, "native-app-native-two.jsonl"); await writeFile(outside, meta("native-two") + record("escape", { thread_id: "native-two" }));
    f.paths["native-two"] = path.join(archived, "rollout-escape-native-two.jsonl"); await symlink(outside, f.paths["native-two"]);
    await f.collect("native-two"); expect((await f.detail()).count).toBe(1); expect((await f.detail()).coverage.knownGaps.sourceUnavailable).toBe(1);
  });
  it("captures new explicit turn dispatch IDs but never backfills from current assignments", async () => {
    const f = await fixture();
    f.collector.bindTurn({ nativeThreadId: "native-one", turnId: "turn-two", taskId: "task-first", questionIds: ["q-first"], phaseId: "phase" });
    await f.collector.running;
    await writeFile(f.file, meta() + record("old") + record("new", { turn_id: "turn-two" })); await f.collect();
    f.collector.bindTurn({ nativeThreadId: "native-one", turnId: "turn-two", taskId: "task-later", questionIds: ["q-later"] }); await f.collector.running;
    const result = await f.detail(); expect(result.rows.find(r => r.responseId === "old")?.taskId).toBeNull();
    expect(result.rows.find(r => r.responseId === "new")).toMatchObject({ taskId: "task-first", phaseId: "phase", questionIds: ["q-first"], attributionBasis: "turnDispatch" });
    expect((await f.detail({ taskId: "unattributed" })).count).toBe(1);
    await f.collector.close(); const resumed = f.create(); expect((await f.detail({ taskId: "task-first" }, resumed)).count).toBe(1);
  });
  it("resolves readable task labels only for real bindings using current in-memory metadata", async () => {
    const tasks = new Map([
      ["task-first", { id: "task-first", code: "T98", title: "Token profiling", documentation: "PRIVATE_TASK_BODY", events: ["PRIVATE_HISTORY"] }],
      ["task-unbound", { id: "task-unbound", code: "T99", title: "Unrelated task" }],
    ]);
    let lookups = 0; const f = await fixture({ tasks: () => { lookups++; return tasks; } });
    await writeFile(f.file, meta() + record("historical") + record("bound", { turn_id: "turn-two" }) + record("deleted", { turn_id: "turn-three" }));
    f.collector.bindTurn({ nativeThreadId: "native-one", turnId: "turn-two", taskId: "task-first" });
    f.collector.bindTurn({ nativeThreadId: "native-one", turnId: "turn-three", taskId: "task-deleted" });
    await f.collector.running;
    const result = await f.detail(); expect(lookups).toBe(1);
    expect(result.rows.find(r => r.responseId === "historical")).toMatchObject({ taskId: null, task: null });
    expect(result.rows.find(r => r.responseId === "bound")).toMatchObject({ taskId: "task-first", task: { id: "task-first", code: "T98", title: "Token profiling" } });
    expect(result.rows.find(r => r.responseId === "deleted")?.task).toEqual({ id: "task-deleted", code: null, title: null });
    expect(result.filters.tasks).toEqual([{ id: "task-deleted", code: null, title: null }, { id: "task-first", code: "T98", title: "Token profiling" }]);
    expect(result.filters.taskIds).toEqual(["task-deleted", "task-first"]);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|Unrelated task|task-unbound|documentation|events/);
    const reads = f.reads(); expect((await f.detail({ taskId: "task-first" })).count).toBe(1); expect((await f.detail({ taskId: "T98" })).count).toBe(0); expect(f.reads()).toBe(reads);
  });
});

describe("detail date, capacity and stable pagination", () => {
  it("uses explicit IANA dates across Beijing midnight and DST, preserving the earliest local boundary", async () => {
    const f = await fixture();
    await writeFile(f.file, meta() + record("earliest", {}, "2026-10-25T16:30:00Z") + record("beijing", {}, "2026-11-07T16:01:00Z") + record("dst-first", {}, "2026-11-01T05:30:00Z") + record("dst-second", {}, "2026-11-01T06:30:00Z")); await f.collect();
    expect((await f.detail({ date: "2026-10-26", timeZone: "Asia/Shanghai" })).count).toBe(1);
    expect((await f.detail({ timeZone: "Asia/Shanghai" })).rows.map(r => r.responseId)).toEqual(["beijing"]);
    expect((await f.detail({ date: "2026-11-01", timeZone: "America/New_York" })).count).toBe(2);
    expect((await f.detail({ date: "2026-10-25", timeZone: "Asia/Shanghai" })).outsideRetention).toBe(true);
    expect((await f.detail({ date: "2026-10-25", timeZone: "Asia/Shanghai" })).totals).toBeNull();
  });
  it("pins pages to a stable snapshot while new higher-usage records arrive; filters bind the cursor", async () => {
    const f = await fixture(); await writeFile(f.file, meta() + context() + record("one") + record("two") + record("three")); await f.collect();
    const first = await f.detail({ limit: 1 }); expect(first.nextCursor).toBeTruthy();
    await appendFile(f.file, record("huge", { usage: { ...usage, input_tokens: 1000, total_tokens: 1020 } })); await f.collect();
    const second = await f.detail({ limit: 1, cursor: first.nextCursor }); const third = await f.detail({ limit: 1, cursor: second.nextCursor });
    expect(new Set([first.rows[0].id, second.rows[0].id, third.rows[0].id]).size).toBe(3); expect(third.nextCursor).toBeNull(); expect(third.count).toBe(3);
    expect((await f.detail()).rows[0].responseId).toBe("huge");
    await expect(f.detail({ cursor: first.nextCursor, limit: 1, sort: "input" })).rejects.toThrow(/filters changed/);
    await expect(f.detail({ cursor: first.nextCursor, limit: 1, timeZone: "Asia/Shanghai" })).rejects.toThrow(/filters changed/);
    await expect(f.detail({ cursor: "forged.cursor" })).rejects.toThrow(/Invalid usage cursor/);
    expect((await f.detail({ configuredModel: "missing" })).count).toBe(0);
    const reads = f.reads(); await f.detail(); await f.detail(); expect(f.reads()).toBe(reads);
  });
  it("bounds derived capacity, evicts complete oldest UTC days, and stops before dropping current-day rows", async () => {
    const f = await fixture({ maxBytes: 12000 });
    const rows = Array.from({ length: 40 }, (_, i) => record(`old-${i}`, {}, "2026-11-06T10:00:00Z", i + 2)).join("") + Array.from({ length: 40 }, (_, i) => record(`today-${i}`, {}, TS, i + 100)).join("");
    await writeFile(f.file, meta() + rows); await f.collect(); const result = await f.detail();
    expect(result.coverage.storageLimit).toBe(true); expect(result.count).toBeGreaterThan(0); expect(result.count).toBeLessThan(40);
    expect(result.coverage.retainedFromUtc).toBe("2026-11-07");
    const folder = path.join(f.root, "token-usage"), files = await readdir(folder), sizes = await Promise.all(files.filter(file=>!file.startsWith("actions-")).map(async file => (await stat(path.join(folder, file))).size));
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(12000); expect(files).not.toContain("2026-11-06.jsonl");
    expect(f.collector.sources["native-one"].offset).toBeLessThan((await stat(f.file)).size);
  });
  it("does not resurrect older days when sources arrive out of timestamp order at capacity", async () => {
    const f = await fixture({ maxBytes: 12000 });
    await writeFile(f.file, meta() + Array.from({ length: 10 }, (_, i) => record(`today-${i}`)).join("") + Array.from({ length: 20 }, (_, i) => record(`old-${i}`, {}, "2026-11-01T10:00:00Z")).join(""));
    await f.collect(); const first = await f.detail(); expect(first.count).toBe(10);
    expect((await f.detail({ date: "2026-11-01" })).count).toBe(0);
    await f.collector.close(); const resumed = f.create(); const restored = await f.detail({}, resumed);
    expect(restored.count).toBe(10); expect(restored.coverage.retainedFromUtc).toBe("2026-11-02");
    const evicted = await f.detail({ date: "2026-11-01" }, resumed);
    expect(evicted.outsideRetention).toBe(true); expect(evicted.coverage).toMatchObject({ retainedFrom: "2026-11-02", retainedFromPartial: false, capacityLimited: true, storageLimit: false });
  });
  it("maps a capacity floor to the local first day, marking partial days and preserving it after restart", async () => {
    const f = await fixture({ maxBytes: 12000 });
    await writeFile(f.file, meta() + Array.from({ length: 10 }, (_, i) => record(`today-${i}`)).join("") + Array.from({ length: 20 }, (_, i) => record(`old-${i}`, {}, "2026-11-01T10:00:00Z")).join("") + record("before-floor", {}, "2026-11-01T20:00:00Z") + record("after-floor", {}, "2026-11-02T00:30:00Z"));
    await f.collect();
    for (const [timeZone, firstDate, previousDate] of [["UTC", "2026-11-02", "2026-11-01"], ["Asia/Shanghai", "2026-11-02", "2026-11-01"], ["America/New_York", "2026-11-01", "2026-10-31"]]) {
      const result = await f.detail({ date: firstDate, timeZone });
      expect(result.count).toBe(1); expect(result.rows[0].responseId).toBe("after-floor"); expect(result.outsideRetention).toBe(false);
      expect(result.coverage).toMatchObject({ retainedFrom: firstDate, retainedFromUtc: "2026-11-02", retainedFromPartial: timeZone !== "UTC", capacityLimited: true });
      expect((await f.detail({ date: previousDate, timeZone })).outsideRetention).toBe(true);
    }
    await f.collector.close(); const resumed = f.create();
    const result = await f.detail({ date: "2026-11-02", timeZone: "Asia/Shanghai" }, resumed);
    expect(result.count).toBe(1); expect(result.coverage).toMatchObject({ retainedFrom: "2026-11-02", retainedFromUtc: "2026-11-02", retainedFromPartial: true, capacityLimited: true });
    expect((await f.detail({ date: "2026-11-01", timeZone: "Asia/Shanghai" }, resumed)).outsideRetention).toBe(true);
  });
  it("returns unknown totals on numeric overflow, and refuses unsupported runtime versions without source reads", async () => {
    const f = await fixture();
    await writeFile(f.file, meta() + record("one", { usage: { ...usage, input_tokens: Number.MAX_SAFE_INTEGER - 20, total_tokens: Number.MAX_SAFE_INTEGER } }) + record("two"));
    await f.collect(); const result = await f.detail(); expect(result.count).toBe(2); expect(result.totals).toBeNull(); expect(result.coverage.knownGaps.aggregateOverflow).toBe(1);
    const other = await fixture({ nativeVersion: "0.167.0" }); const unavailable = await other.detail({ refresh: true });
    expect(unavailable.coverage.unavailable).toBe(true); expect(unavailable.coverage.knownGaps.unsupportedRuntimeVersion).toBe(1); expect(other.reads()).toBe(0);
  });
  it("yields while backfilling large source bodies, and recovers partial derived writes without duplicating", async () => {
    const f = await fixture({ chunkBytes: 4096 });
    const body = event("response_item", { type: "reasoning", text: "DO_NOT_KEEP".repeat(200000) });
    await writeFile(f.file, meta() + body + record()); let yielded = false;
    f.collector.hint("native-one"); setImmediate(() => { yielded = true; }); await f.collector.running;
    expect(yielded).toBe(true); expect((await f.detail()).count).toBe(1);
    await f.collector.close(); const shard = path.join(f.root, "token-usage", DATE + ".jsonl"); await appendFile(shard, '{"partial":');
    const resumed = f.create(); const result = await f.detail({}, resumed); expect(result.count).toBe(1); expect(result.coverage.knownGaps.partialIndexRecovery).toBe(1);
    expect(await readFile(shard, "utf8")).not.toMatch(/DO_NOT_KEEP|partial/);
  });
  it.each([{ date: "2026-02-30" }, { timeZone: "../../secret" }, { timeZone: "Invalid/Zone" }, { limit: 101 }, { limit: 0 }, { sort: "prompt" }, { agentId: "../x" }, { path: "/etc/passwd" }, { cursor: 123 }])("rejects invalid query %j", async patch => {
    expect(() => parameters({ date: DATE, timeZone: "UTC", ...patch }, NOW)).toThrow();
  });
});

describe("expanded sources and anchored windows", () => {
  it("discovers a real parent-child-grandchild chain and a local helper without creating employees, globally deduplicates and recovers", async () => {
    const f = await fixture(); await writeFile(f.file, meta() + record());
    for (const native of ["child", "grandchild", "helper"]) {
      f.paths[native] = path.join(path.dirname(f.file), `rollout-${native}.jsonl`);
      await writeFile(f.paths[native], meta(native) + record(native + "-response", { thread_id: native }));
    }
    await appendFile(f.paths.child, record("resp-one", { thread_id: "child" }));
    for (const thread of [{ id: "child", parentThreadId: "native-one" }, { id: "grandchild", source: { subAgent: { thread_spawn: { parent_thread_id: "child", depth: 2 } } } }, { id: "helper", source: { subAgent: "memory_consolidation" } }]) f.collector.observeNative({ method: "thread/started", params: { thread } });
    await f.collect(); let result = await f.detail();
    expect(result.count).toBe(4); expect(result.purposeSummary.denominatorTokens).toBe(480);
    expect(result.rows.find(r => r.responseId === "grandchild-response")?.officeAgentId).toBe("agent-one");
    expect(result.rows.find(r => r.responseId === "helper-response")?.officeAgentId).toBeNull(); expect(f.sessions).toHaveLength(2);
    await f.collector.close(); result = await f.detail({}, f.create()); expect(result.count).toBe(4); expect(result.purposeSummary.denominatorTokens).toBe(480);
  });
  it("recovers subAgent metadata in bounded background pages and rejects outside-home and unknown-parent sources", async () => {
    const listSources = vi.fn(async (p: { archived: boolean }) => ({ data: p.archived ? [] : [{ id: "outside", source: { subAgent: "review" } }, { id: "orphan", parentThreadId: "external" }], nextCursor: null }));
    const f = await fixture({ listSources }); f.paths.outside = path.join(f.root, "rollout-outside.jsonl"); await writeFile(f.paths.outside, meta("outside") + record("out", { thread_id: "outside" }));
    f.collector.refresh(); await f.collector.running; const result = await f.detail();
    expect(listSources).toHaveBeenCalledWith(expect.objectContaining({ archived: true, useStateDbOnly: true, sourceKinds: expect.arrayContaining(["subAgentCompact", "subAgentThreadSpawn"]) }));
    expect(result.count).toBe(0); expect(result.coverage.knownGaps.unmappedNativeSource).toBeGreaterThan(0);
  });
  it("keeps dictation nullable units, replaces one attempt and persists aliases without merging provider namespaces", async () => {
    const f = await fixture();
    const value = { officeAgentId: "agent-one", contextNativeThreadId: "native-one", attemptId: "attempt-one", providerKind: "openaiApi", providerRequestId: null, usage: { input: null, output: null, total: null, cachedInput: null, uncachedInput: null, cacheWriteInput: null, reasoningOutput: null, otherOutput: null }, unit: "seconds", durationSeconds: 3, usageReason: "durationOnly", status: "completed" };
    f.collector.recordDictation(value); await f.collector.running;
    expect((await f.detail()).purposeSummary.denominatorTokens).toBeNull();
    const measured = { ...value, unit: "tokens", providerRequestId: "resp-one", usage: { ...value.usage, input: 40, output: 2, total: 42 } };
    f.collector.recordDictation(measured); f.collector.recordDictation(measured); await f.collector.running;
    await writeFile(f.file, meta() + record()); await f.collect();
    let result = await f.detail(); expect(result.count).toBe(2); expect(result.purposeSummary.denominatorTokens).toBe(162);
    expect(result.rows.find(r => r.sourceKind === "dictation")?.usage.reasoningOutput).toBeNull();
    f.collector.recordDictation({ ...measured, attemptId: "new-attempt", providerRequestId: "new-request" }); await f.collector.running;
    await f.collector.close(); result = await f.detail({}, f.create()); expect(result.count).toBe(3); expect(result.purposeSummary.denominatorTokens).toBe(204);
  });
  it("freezes the server-hour anchor, membership, denominator, filters and pages across a new hour", async () => {
    let now = NOW + 59 * 60000; const f = await fixture({ now: () => now });
    await writeFile(f.file, meta() + record("start", {}, "2026-11-07T12:00:00Z") + record("middle", {}, TS) + record("end", {}, "2026-11-08T12:00:00Z") + record("later", {}, "2026-11-08T12:30:00Z")); await f.collect();
    const first = await f.collector.detail({ window: "rolling24h", limit: 1 });
    expect(first.window).toEqual({ kind: "rolling24h", start: "2026-11-07T12:00:00.000Z", end: "2026-11-08T12:00:00.000Z", timeZone: "UTC" }); expect(first.count).toBe(2); expect(first.purposeSummary.denominatorTokens).toBe(240);
    now += 2 * 60000;
    const second = await f.collector.detail({ window: "rolling24h", limit: 1, cursor: first.nextCursor }); expect(second.window).toEqual(first.window); expect(second.rows[0].id).not.toBe(first.rows[0].id);
    const purpose = await f.collector.detail({ window: "rolling24h", snapshot: first.snapshot, purpose: "unknown", includeRecords: false }); expect(purpose.purposeSummary.denominatorTokens).toBe(240);
    const fresh = await f.collector.detail({ window: "rolling24h" }); expect(fresh.count).toBe(3); expect(fresh.window.end).toBe("2026-11-08T13:00:00.000Z");
    await expect(f.collector.detail({ window: "rolling24h", end: fresh.window.end, snapshot: first.snapshot })).rejects.toThrow(/expired|filters/);
  });
  it.each(["2026-03-08T07:59:00Z", "2026-11-01T06:01:00Z", "2027-01-01T00:00:00Z"])("uses exactly 24 real hours across DST/year at %s", now => {
    const p = parameters({ window: "rolling24h" }, Date.parse(now)); expect(Date.parse(p.window.end) - Date.parse(p.window.start)).toBe(86400000); expect(Date.parse(p.window.end) % 3600000).toBe(0);
    expect(() => parameters({ window: "rolling24h", date: DATE }, NOW)).toThrow();
  });
});

it("marks a capacity-cut rolling window partial and preserves the floor after restart", async () => {
  const f = await fixture(); await writeFile(f.file, meta() + record("old", {}, "2026-11-07T18:00:00Z") + record("current")); await f.collect();
  f.collector.evict("2026-11-07"); f.collector.floor = "2026-11-08"; await f.collector.prune(); await f.collector.close();
  const restored = f.create(), r = await restored.detail({ window: "rolling24h" });
  expect(r.windowPartial).toBe(true); expect(r.count).toBe(1); expect(r.purposeSummary.denominatorTokens).toBe(120); expect(r.coverage.capacityLimited).toBe(true);
});
it("queues new source and dictation hooks with bounded O(1) work and no synchronous discovery/history", async () => {
  const f = await fixture(); f.collector.running = new Promise(() => {}); f.collector.known = () => { throw new Error("hot-path scan"); };
  for (let i = 0; i < 1100; i++) { f.collector.observeNative({ method: "thread/started", params: { thread: { id: "child-" + i, parentThreadId: "native-one" } } }); f.collector.recordDictation({ attemptId: "a" + i }); }
  expect(f.collector.sourceQueue.length).toBe(1024); expect(f.collector.dictationQueue.length).toBe(1024); expect(f.reads()).toBe(0);
  expect(f.collector.gaps).toMatchObject({ sourceBackpressure: 76, dictationBackpressure: 76 });
  f.collector.sourceQueue.length = 0; f.collector.dictationQueue.length = 0; f.collector.running = null;
});

it("resolves trusted ownership once per file rather than once per response", async () => {
  const f = await fixture(), known = vi.spyOn(f.collector, "known");
  await writeFile(f.file, meta() + Array.from({ length: 200 }, (_, i) => record("response-" + i)).join(""));
  await f.collect(); expect(known.mock.calls.length).toBeLessThan(20); expect((await f.detail()).count).toBe(200);
});

it("keeps provider units explicit and rejects malformed token totals/details without relaxing native validation", () => {
  const { transcriptionUsage } = createRequire(import.meta.url)("../../server/office-usage-adapters.js");
  for (const value of [{ type: "tokens", input_tokens: 2, output_tokens: 1, total_tokens: 4 }, { type: "tokens", input_tokens: 2, output_tokens: 1, total_tokens: 3, input_token_details: { audio_tokens: 3 } }, { type: "tokens", input_tokens: -1, output_tokens: 1, total_tokens: 0 }]) expect(transcriptionUsage(value).usage.total).toBeNull();
  expect(transcriptionUsage({ type: "duration", seconds: 10 })).toMatchObject({ unit: "seconds", usage: { input: null, output: null, total: null } });
  expect(usageOf({ ...usage, cached_input_tokens: null })).toBeNull();
});

it("keeps old day clients safe from new enum labels while v2/day and rolling retain exact dictation purpose and S", async () => {
  const f = await fixture(); f.collector.recordDictation({ officeAgentId: "agent-one", attemptId: "old-client", providerKind: "openaiApi", unit: "tokens", durationSeconds: null, usage: { input: 2, output: 1, total: 3, cachedInput: null, uncachedInput: null, cacheWriteInput: null, reasoningOutput: null, otherOutput: null } }); await f.collector.running;
  const legacy = await f.detail(); expect(legacy.purposeSummary.purposes.some(p => p.id === "dictation")).toBe(false); expect(legacy.rows[0].purpose).toBe("unknown");
  const next = await f.detail({ schemaVersion: 2 }); expect(next.rows[0].purpose).toBe("dictation"); expect(next.purposeSummary.denominatorTokens).toBe(legacy.purposeSummary.denominatorTokens);
});

it("rechecks the canonical resolver after rotation while the old file still exists, deduplicates copies and rejects identity changes", async () => {
  let clock = NOW;
  const f = await fixture({ now: () => clock });
  await writeFile(f.file, meta() + record("old")); await f.collect();
  const rotated = path.join(path.dirname(f.file), "rollout-fixture-native-one_segment-2.jsonl");
  await writeFile(rotated, meta() + record("old") + record("new")); f.paths["native-one"] = rotated;
  clock += 61000; await f.collect(); expect((await f.detail()).count).toBe(2); expect(f.collector.sources['native-one'].file).toContain('segment-2');
  await writeFile(rotated, meta('other-native') + record('forged')); clock += 61000; await f.collect(); expect(f.collector.sources['native-one'].status).toBe('unavailable'); expect((await f.detail()).count).toBe(2);
});

it("keeps sender/request/start-steer entries idempotent, frozen per snapshot and durable without multiplying shared responses", async () => {
  const f = await fixture(); await writeFile(f.file, meta() + context() + record('one') + record('two')); await f.collect();
  const dispatch = (senderId: string, requestId: string, mode='steer') => f.collector.bindTurn({agentId:'agent-one',nativeThreadId:'native-one',turnId:'turn-one',mode,usage:{purpose:'chat_work',trigger:'agentMessage',senderId,entryId:requestId}});
  f.collector.observeNative({method:'item/completed',params:{threadId:'native-one',turnId:'turn-one',item:{id:'user-item',clientId:'request-a',type:'userMessage',content:'DO_NOT_RETAIN'}}}); await f.collector.running;
  dispatch('sender-a','request-a','start'); await f.collector.running;
  const frozen = await f.detail({schemaVersion:2});
  dispatch('sender-b','request-b'); dispatch('sender-b','request-b'); await f.collector.running;
  f.collector.observeNative({method:'item/completed',params:{threadId:'native-one',turnId:'turn-one',item:{id:'tool-one',type:'commandExecution',stdout:'DO_NOT_RETAIN'}}}); await f.collector.running;
  const latest = await f.detail({schemaVersion:2}); expect(latest.messageChains!.turns).toHaveLength(1);const chain=latest.messageChains!.turns[0];
  expect(chain.entries.map(e=>[e.senderId,e.mode])).toEqual([['sender-a','start'],['sender-b','steer']]);expect(chain.observedResponses).toBe(2);expect(chain.components.total.knownSubtotal).toBe(240);expect(chain.entries[0].itemId).toBe('user-item');expect(chain.activities).toEqual([{itemId:'tool-one',type:'commandExecution'}]);
  expect((await f.detail({schemaVersion:2,snapshot:frozen.snapshot})).messageChains!.turns[0].entries).toHaveLength(1);
  const filtered=await f.detail({schemaVersion:2,snapshot:latest.snapshot,turnId:'turn-one',nativeThreadId:'native-one'});expect(filtered.rows).toHaveLength(2);
  await f.collector.close();const restored=f.create();expect((await f.detail({schemaVersion:2},restored)).messageChains!.turns[0].entries).toHaveLength(2);
  expect(JSON.stringify(latest.messageChains)).not.toContain('DO_NOT_RETAIN');
});

it('backs off unresolved official paths without advertising stale EOF as ready or resolving per response', async()=>{
 let clock=NOW,unavailable=false,file='';const resolve=vi.fn(async()=>{if(unavailable)throw Error('offline');return file;});const f=await fixture({now:()=>clock,resolveSource:resolve});file=f.file;await writeFile(file,meta()+record('one'));await f.collect();
 clock+=61000;unavailable=true;await f.collect();expect(f.collector.sources['native-one'].status).toBe('unavailable');const calls=resolve.mock.calls.length;
 for(let i=0;i<5;i++)await f.collect();expect(resolve).toHaveBeenCalledTimes(calls);expect((await f.detail()).coverage.readySources).toBe(0);
 clock+=61000;unavailable=false;await f.collect();expect(f.collector.sources['native-one'].status).toBe('ready');expect((await f.detail()).count).toBe(1);
});

it("keeps the full measured denominator while selecting one actual Purpose on a frozen snapshot", async () => {
 const f=await fixture();await writeFile(f.file,meta()+record('action-one')+record('action-two',{},TS,3));await f.collect();
 const base={nativeThreadId:'native-one',turnId:'turn-one',observedAt:TS,linked:true,outputs:[{id:'o',type:'function_call',callId:'c',tool:'todo_get',namespace:'office_tasks',status:'completed'}],actions:[],source:null};
 f.collector.actions.set({...base,responseId:'action-one'});
 const first=await f.detail({schemaVersion:2,includeRecords:false});expect(first.actionSummary!.coverage.measuredResponses).toBe(2);
 const filtered=await f.detail({schemaVersion:2,actionPurpose:'workflow',snapshot:first.snapshot});expect(filtered.rows).toHaveLength(1);expect(filtered.purposeSummary.denominatorTokens).toBe(first.purposeSummary.denominatorTokens);expect(filtered.actionSummary!.groups.reduce((sum,g)=>sum+(g.components.total.knownSubtotal||0),0)).toBe(first.purposeSummary.denominatorTokens);
 f.collector.actions.set({...base,responseId:'action-one',linked:false});const frozen=await f.detail({schemaVersion:2,actionPurpose:'workflow',snapshot:first.snapshot});expect(frozen.rows).toHaveLength(1);
});

it('switches inferred/strict Purpose within the same frozen measured snapshot and isolates cursors',async()=>{
 const f=await fixture();await writeFile(f.file,meta()+record('inferred')+record('known',{},TS,3));await f.collect();
 f.collector.actions.set({nativeThreadId:'native-one',turnId:'turn-one',responseId:'inferred',observedAt:TS,linked:true,outputs:[{id:'o',type:'function_call',callId:'c',tool:'exec_command',namespace:'functions',status:'failed'}],actions:[{itemId:'c',tool:'exec_command',namespace:'functions',status:'failed',category:'execution',basis:'directCallId',purposeBasis:'static-inferred',operations:['git']}],source:null});
 const estimated=await f.detail({schemaVersion:2,purposeView:'estimated',limit:1});expect(estimated.actionSummary!.coverage.inferredResponses).toBe(1);
 const strict=await f.detail({schemaVersion:2,purposeView:'strict',snapshot:estimated.snapshot});expect(strict.actionSummary!.coverage.classifiedResponses).toBe(0);expect(strict.actionSummary!.coverage.components.measured).toEqual(estimated.actionSummary!.coverage.components.measured);expect(strict.breakdown).toEqual(estimated.breakdown);
 const strictFiltered=await f.detail({schemaVersion:2,purposeView:'strict',actionPurpose:'execution',snapshot:estimated.snapshot});expect(strictFiltered.count).toBe(0);
 expect((await f.detail({schemaVersion:2,purposeView:'estimated',actionPurpose:'execution',snapshot:estimated.snapshot})).count).toBe(1);
 await expect(f.detail({schemaVersion:2,purposeView:'strict',limit:1,cursor:estimated.nextCursor})).rejects.toThrow(/expired|filters/);
 expect(()=>parameters({date:DATE,timeZone:'UTC',purposeView:'pretend-observed'},NOW)).toThrow();
});
it('excludes low-confidence continuation without changing the frozen priced denominator',async()=>{
 const f=await fixture();await writeFile(f.file,meta()+record('low-confidence'));await f.collect();
 f.collector.actions.set({nativeThreadId:'native-one',turnId:'turn-one',responseId:'low-confidence',observedAt:TS,linked:true,primaryEnabled:true,outputs:[],actions:[],priorPurpose:{purpose:'execution',responseId:'earlier'},source:null});
 const estimated=await f.detail({schemaVersion:2});expect(estimated.rows[0].action!.confidence).toBe('low');expect(estimated.actionSummary!.confidence!.find(g=>g.id==='low')!.components.total.knownSubtotal).toBe(120);
 const supported=await f.detail({schemaVersion:2,purposeView:'supported',snapshot:estimated.snapshot});expect(supported.rows[0].action!.purpose).toBe('unknown');expect(supported.actionSummary!.coverage.classifiedResponses).toBe(0);expect(supported.breakdown).toEqual(estimated.breakdown);expect(supported.purposeSummary).toEqual(estimated.purposeSummary);
 const back=await f.detail({schemaVersion:2,purposeView:'estimated',snapshot:estimated.snapshot});expect(back.rows[0].action!.confidence).toBe('low');expect(back.actionSummary).toEqual(estimated.actionSummary);
});
it('invalidates at real steer while preserving an automatic same-turn retry',async()=>{
 const f=await fixture(),invalidate=vi.spyOn(f.collector.actions,'invalidate');
 f.collector.bindTurn({nativeThreadId:'native-one',turnId:'turn-one',mode:'steer',usage:{entryId:'new-input',trigger:'userMessage'}});expect(invalidate).toHaveBeenCalledWith('native-one');invalidate.mockClear();
 f.collector.bindTurn({nativeThreadId:'native-one',turnId:'turn-one',usage:{trigger:'automaticRetry'}});expect(invalidate).not.toHaveBeenCalled();
});
