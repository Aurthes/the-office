// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import type { UsageDetail } from "@/features/ring-ship/ai-center";
const { OfficeTokenUsage, usageOf, userUsage } = createRequire(import.meta.url)("../../server/office-token-usage.js");
const roots: string[] = [], instances: { close(): Promise<void> }[] = [];
const NOW = Date.parse("2026-11-08T12:00:00Z"), day = "2026-11-08";
const line = (type: string, payload: unknown) => JSON.stringify({ timestamp: "2026-11-08T01:00:00Z", ordinal: 1, type, payload }) + "\n";
const record = (response: string, turn = response, input = 80, output = 20) => line("token_usage_record", { thread_id: "native", turn_id: turn, response_id: response, usage: { input_tokens: input, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output } });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "office-purpose-test-")); roots.push(root);
  const home = path.join(root, "codex"); await mkdir(path.join(home, "sessions"), { recursive: true });
  const file = path.join(home, "sessions", "rollout-test-native.jsonl");
  await writeFile(file, line("session_meta", { id: "native", cli_version: "0.166.0" }));
  const config = { directory: root, home, sessions: () => [{ id: "agent", codexThreadId: "native", name: "Worker" }], resolveSource: async () => file, now: () => NOW };
  const create = () => { const c = new OfficeTokenUsage(config); instances.push(c); return c; }; const c = create();
  const read = (p: Record<string, unknown> = {}, index = c): Promise<UsageDetail> => index.detail({ date: day, timeZone: "UTC", ...p });
  const tag = (turn: string, purpose: string, extra = {}) => c.bindTurn({ nativeThreadId: "native", turnId: turn, mode: "start", usage: { purpose, trigger: "userMessage", ...extra } });
  const sample = (responseId: string, extra = {}) => c.recordSample({ officeAgentId: "agent", contextNativeThreadId: "native", sourceTurnId: "chat", responseId, inputTokens: 8, cachedInputTokens: 4, outputTokens: 2, ...extra });
  const collect = async () => { c.hint("native"); await c.running; };
  return { root, file, c, create, read, tag, sample, collect };
}
afterEach(async () => { for (const c of instances.splice(0)) await c.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it("aggregates the complete snapshot by exclusive purpose, keeps S across drilldown/pages and treats origin as embedded", async () => {
  const f = await fixture(); await appendFile(f.file, record("chat") + record("collab", "collab", 40, 10) + record("mix", "mix", 15, 5) + record("old", "old", 15, 5));
  f.tag("chat", "chat_work"); f.tag("collab", "collaboration_mixed"); f.tag("mix", "automation");
  f.c.bindTurn({ nativeThreadId: "native", turnId: "mix", mode: "steer", usage: { purpose: "chat_work", trigger: "userMessage" } }); f.sample("sample"); await f.collect();
  const first = await f.read({ includeRecords: false }); expect(first.rows).toHaveLength(0); expect(first.count).toBe(5);
  expect(first.purposeSummary.denominatorTokens).toBe(200);
  expect(first.purposeSummary.purposes.filter(p => p.knownTokens !== null).map(p => [p.id, p.knownTokens, p.share])).toEqual([["chat_work", 100, .5], ["suggestion", 10, .05], ["collaboration_mixed", 50, .25], ["mixed", 20, .1], ["unknown", 20, .1]]);
  expect(first.purposeSummary.unmeasured.find(p => p.id === "origin")).toEqual({ id: "origin", status: "embedded", tokens: null, share: null, measuredResponses: null });
  expect(first.purposeSummary.unmeasured.every(p => p.tokens === null && p.share === null && p.measuredResponses === null)).toBe(true);
  expect(first.purposeSummary.unmeasured.find(p => p.id === "company_planning")?.status).toBe("backendUnsupported");
  await appendFile(f.file, record("late")); await f.collect();
  const selected = await f.read({ purpose: "chat_work", snapshot: first.snapshot, limit: 1 }); expect(selected.count).toBe(1); expect(selected.purposeSummary.denominatorTokens).toBe(200);
  expect((await f.read({ snapshot: first.snapshot, sort: "input", purpose: "unknown" })).purposeSummary).toEqual(first.purposeSummary);
  expect((await f.read()).purposeSummary.denominatorTokens).toBe(300);
  await expect(f.read({ snapshot: first.snapshot, agentId: "different" })).rejects.toThrow(/filters changed/);
  await expect(f.read({ purpose: "origin" })).rejects.toThrow(/Invalid usage purpose/);
});
it("freezes unknown/late bindings and pagination while new classification or records arrive", async () => {
  const f = await fixture(); await appendFile(f.file, record("a") + record("b")); await f.collect();
  const old = await f.read({ limit: 1 }); f.tag("a", "chat_work"); await f.c.running;
  expect((await f.read({ snapshot: old.snapshot })).rows.every(row => row.purpose === "unknown")).toBe(true);
  expect((await f.read()).rows.find(r => r.responseId === "a")?.purpose).toBe("chat_work");
  expect((await f.read({ limit: 1, cursor: old.nextCursor })).purposeSummary.denominatorTokens).toBe(200);
  await expect(f.read({ limit: 1, cursor: old.nextCursor, purpose: "unknown" })).rejects.toThrow(/filters changed/);
});
it("inherits continuation/retry purposes, preserves unknown history and conservatively mixes cross-purpose steer", async () => {
  const f = await fixture(); await appendFile(f.file, ["scheduled", "continued", "retry", "unknown", "fire"].map(t => record(t)).join(""));
  f.tag("scheduled", "automation", { trigger: "schedule", originId: "run" });
  f.tag("continued", "unknown", { inheritTurnId: "scheduled", trigger: "continue" });
  f.tag("retry", "unknown", { inheritTurnId: "continued", trigger: "automaticRetry" });
  f.tag("unknown", "unknown", { inheritTurnId: "unrecorded", trigger: "continue" });
  f.tag("fire", "operational_task", { trigger: "firefighter" });
  f.c.bindTurn({ nativeThreadId: "native", turnId: "continued", mode: "steer", usage: { purpose: "chat_work", trigger: "userMessage" } }); await f.collect();
  const rows = (await f.read()).rows;
  expect(Object.fromEntries(rows.map(r => [r.responseId, r.purpose]))).toEqual({ continued: "mixed", fire: "operational_task", retry: "automation", scheduled: "automation", unknown: "unknown" });
  expect(rows.find(r => r.responseId === "retry")?.purposeBasis).toBe("inherited");
  await f.c.close(); const restored = await f.read({}, f.create()); expect(restored.purposeSummary.purposesRecordedFrom).toBe(new Date(NOW).toISOString()); expect(restored.purposeSummary).toEqual((await f.read()).purposeSummary);
  expect(userUsage(undefined)).toEqual({ purpose: "chat_work", trigger: "userMessage" }); expect(userUsage("firefighter").purpose).toBe("operational_task"); expect(() => userUsage("automation")).toThrow();
});
it("meters sampler nullable fields without inventing child IDs, four-part coverage or parent-turn counts", async () => {
  const f = await fixture(); await appendFile(f.file, record("main", "chat")); await f.collect();
  f.sample("s", { inputTokens: 100, cachedInputTokens: 60, outputTokens: 10 }); f.sample("partial", { inputTokens: 100, cachedInputTokens: null, outputTokens: 10 }); f.sample("unmeasured", { inputTokens: null }); await f.c.running;
  const result = await f.read(); const sample = result.rows.find(r => r.responseId === "s")!;
  expect(sample).toMatchObject({ nativeThreadId: null, turnId: null, sourceTurnId: "chat", contextNativeThreadId: "native", purpose: "suggestion", totalBasis: "derivedInputOutput", sameTurnResponses: null, taskId: null, previousObservedInput: null });
  expect(sample.usage).toEqual({ input: 100, cachedInput: 60, uncachedInput: 40, output: 10, total: 110, cacheWriteInput: null, reasoningOutput: null, otherOutput: null });
  expect(result.rows.find(r => r.responseId === "main")?.sameTurnResponses).toBe(1);
  expect(result.rows.find(r => r.responseId === "unmeasured")?.usage.total).toBeNull();
  const bucket = result.purposeSummary.purposes.find(p => p.id === "suggestion")!; expect(bucket.knownTokens).toBe(220); expect(bucket.measuredResponses).toBe(2); expect(bucket.unknownUsageResults).toBe(1); expect(bucket.components.reasoningOutput).toEqual({ knownSubtotal: null, reportedRows: 0, unknownRows: 3 });
  f.c.sampleUnavailable(); await f.c.running; expect((await f.read()).purposeSummary.denominatorTokens).toBe(320); expect((await f.read()).coverage.knownGaps.sampleUsageUnavailable).toBe(1);
  await f.c.close(); const restored = await f.read({}, f.create()); expect(restored.rows.find(r => r.responseId === "s")?.usage).toEqual(sample.usage);
  expect(usageOf({ input_tokens: 100, cached_input_tokens: 60, output_tokens: 10, total_tokens: 110 })).toBeNull();
});
it.each([true, false])("reconciles exact sample/rollout response IDs in either order (%s), and persists dedupe", async sampleFirst => {
  const f = await fixture();
  if (sampleFirst) { f.sample("same", { inputTokens: 80, cachedInputTokens: 0, outputTokens: 20 }); await f.c.running; }
  await appendFile(f.file, record("same")); await f.collect();
  if (!sampleFirst) { f.sample("same", { inputTokens: 80, cachedInputTokens: 0, outputTokens: 20 }); await f.c.running; }
  const result = await f.read(); expect(result.count).toBe(1); expect(result.purposeSummary.denominatorTokens).toBe(100); expect(result.rows[0].purpose).toBe("suggestion"); expect(result.rows[0].sourceKinds.sort()).toEqual(["nativeRollout", "threadSample"]);
  await f.c.close(); const restored = await f.read({}, f.create()); expect(restored.count).toBe(1); expect(restored.rows[0].usage).toEqual(result.rows[0].usage);
});
it("keeps first values on conflicting cross-source usage, and rejects invalid/misidentified samples", async () => {
  const f = await fixture(); f.sample("same"); await f.c.running; await appendFile(f.file, record("same")); await f.collect();
  f.sample("invalid", { cachedInputTokens: 999 }); f.sample("foreign", { contextNativeThreadId: "not-office" }); await f.c.running;
  const result = await f.read(); expect(result.count).toBe(1); expect(result.purposeSummary.denominatorTokens).toBe(10); expect(result.rows[0].conflict).toBe(true); expect(result.coverage.knownGaps).toMatchObject({ conflictingResponse: 1, invalidSampleUsage: 2 });
  const shard = path.join(f.root, "token-usage", day + ".jsonl"); expect(await readFile(shard, "utf8")).not.toMatch(/"(?:prompt|text|cookie)"/);
});
it("keeps dispatch hooks O(1) and bounded without consulting source/history or awaiting initialization", async () => {
  const f = await fixture(); f.c.running = new Promise(() => {}); f.c.known = () => { throw new Error("hot-path scan"); };
  for (let i = 0; i < 8300; i++) f.c.bindTurn({ nativeThreadId: "native", turnId: "t" + i, usage: { purpose: "automation" } });
  expect(f.c.bindingQueue.length).toBe(8192); expect(f.c.gaps.bindingBackpressure).toBe(108);
  for (let i = 0; i < 1100; i++) f.sample("s" + i);
  expect(f.c.sampleQueue.length).toBe(1024); expect(f.c.gaps.sampleBackpressure).toBe(76); f.c.bindingQueue.length = 0; f.c.sampleQueue.length = 0; f.c.running = null;
});
it("flushes already-returned sampler usage on a graceful stop without needing original rollout data", async () => {
  const f = await fixture(); f.sample("last"); await f.c.close();
  const result = await f.read({}, f.create()); expect(result.rows.map(row => row.responseId)).toEqual(["last"]); expect(result.purposeSummary.denominatorTokens).toBe(10);
});
