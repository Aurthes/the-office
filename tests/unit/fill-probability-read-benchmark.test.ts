// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ stat: vi.fn(), readFile: vi.fn(), execFile: vi.fn(), registry: vi.fn() }));
vi.mock("node:fs/promises", () => ({ default: { stat: mocks.stat, readFile: mocks.readFile } }));
vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("@/lib/clawdbot/paths", () => ({ resolveStateDir: () => "/tmp/offline-benchmark" }));
vi.mock("../../server/server-registry", () => ({ loadServerRegistry: mocks.registry, sshTransportOptions: async () => ["-o", "BatchMode=yes"] }));
import { parseTaskBenchmarkRow, readTaskPathBenchmark } from "@/lib/fill-probability/read-benchmark";
const sha = "a".repeat(40);
const fields = ["hit_ema", "exposure_ema_seconds", "base_model_hazard_ema", "model_hazard_ema", "actual_probability_1s", "theoretical_probability_1s"];
const row = () => ({ version: 1, source: "disk", rowCount: 1, scope: { strategy: "MMRPI", instance: "5", symbol: "bybit.perp.wlfi_usdt", side: "ask", requestedAccount: "bybit.Wealth_Trading09", meaning: "shared EMA" }, currentRuntimeIdentity: { sourceSha: sha, pid: 123, processStartedAt: 1000 }, sampleIdentity: { run: null, historicalSourceEvidence: null }, sourceTimeMs: 1500, readAtMs: 40000, sourceAgeMs: 38500, quality: { ready: true, savedAt: 39000 }, fields: fields.map((name, i) => ({ name, value: i / 100 })), sourceReadBytes: 1357, sourceReadBytesKind: "FileKV body", sourceReadMs: .2 });
let enabled = true, mode = 0o100600, active = true, expires = 0, reply: ReturnType<typeof row>;
let runId = "initial_run";
beforeEach(() => {
  vi.clearAllMocks(); enabled = true; mode = 0o100600; active = true; expires = Date.now() + 300000; reply = row();
  mocks.stat.mockImplementation(async () => ({ size: 100, mode }));
  mocks.registry.mockImplementation(async () => ({ hosts: [{ alias: "preprod01", active, group: "online" }] }));
  mocks.readFile.mockImplementation(async (p: string) => p.endsWith("fill-probability-read-benchmark.json") ? JSON.stringify({ version: 1, enabled, taskId: "47f8742d-7560-48b5-a209-d23c752d452c", runId, expiresAt: expires, sourceId: "preprod" }) : p.endsWith("fill-probability.json") ? JSON.stringify({ version: 1, sources: [{ id: "preprod", host: "preprod01", strategies: [{ name: "MMRPI", setting: "/srv/MMRPI/atom_setting.json", sourceSha: sha, feedbackVersion: 8 }] }] }) : "# offline script");
  mocks.execFile.mockImplementation((_bin: string, _args: string[], _options: unknown, callback: (error: Error | null, reply: { stdout: string; stderr: string }) => void) => callback(null, { stdout: JSON.stringify(reply), stderr: "" }));
});
it("preserves stale readiness/time and zero facts while projecting away private fields", () => {
  const input = { ...row(), privateConfig: "password", quality: { ...row().quality, secret: "password" } };
  const result = parseTaskBenchmarkRow(input, "disk", sha);
  expect(result.sourceAgeMs).toBe(38500); expect(result.quality.ready).toBe(true); expect(result.fields[0].value).toBe(0);
  expect(JSON.stringify(result)).not.toContain("password");
  expect(() => parseTaskBenchmarkRow({ ...row(), quality: { ready: { secret: "password" } } }, "disk", sha)).toThrow();
  for (const bad of [{ ...row(), rowCount: 0 }, { ...row(), currentRuntimeIdentity: { sourceSha: "b".repeat(40), pid: 123 } }, { ...row(), fields: row().fields.map((x, i) => i ? x : { ...x, value: null }) }]) expect(() => parseTaskBenchmarkRow(bad, "disk", sha)).toThrow();
});
it("requires private enable, mode and expiry before launching any source read", async () => {
  runId = "private_gate"; enabled = false; await expect(readTaskPathBenchmark("disk", runId)).rejects.toThrow();
  enabled = true; mode = 0o100644; await expect(readTaskPathBenchmark("disk", runId)).rejects.toThrow();
  mode = 0o100600; expires = Date.now() - 1; await expect(readTaskPathBenchmark("disk", runId)).rejects.toThrow();
  expect(mocks.execFile).not.toHaveBeenCalled();
});
it("rejects arbitrary sources, unregistered hosts and source drift without source substitution", async () => {
  runId = "scope_guard"; await expect(readTaskPathBenchmark("redis;anything", runId)).rejects.toThrow();
  active = false; await expect(readTaskPathBenchmark("disk", runId)).rejects.toThrow(); expect(mocks.execFile).not.toHaveBeenCalled();
  active = true; reply.currentRuntimeIdentity.sourceSha = "b".repeat(40); await expect(readTaskPathBenchmark("disk", runId)).rejects.toThrow("source unavailable");
});
it("bounds a private run to three real reads per source and uses registered SSH with original timeouts", async () => {
  runId = "bounded_run"; for (let i = 0; i < 3; i++) expect((await readTaskPathBenchmark("disk", runId)).rows).toHaveLength(1);
  await expect(readTaskPathBenchmark("disk", runId)).rejects.toThrow("budget"); expect(mocks.execFile).toHaveBeenCalledTimes(3);
  const [bin, args, options] = mocks.execFile.mock.calls[0]; expect(bin).toBe("ssh"); expect(args).toContain("preprod01"); expect(args.at(-1)).toContain("timeout 10s"); expect(options).toMatchObject({ timeout: 12000, maxBuffer: 131072 });
});
