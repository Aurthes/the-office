// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, appendFile, readFile, readdir, stat, rm, rename, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
    const folder = path.join(f.root, "token-usage"), files = await readdir(folder), sizes = await Promise.all(files.map(async file => (await stat(path.join(folder, file))).size));
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
