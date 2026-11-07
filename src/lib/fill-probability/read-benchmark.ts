import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveStateDir } from "@/lib/clawdbot/paths";
import { loadServerRegistry, sshTransportOptions } from "../../../server/server-registry";
import { parseFillSources } from "./source";
const exec = promisify(execFile);
const stores = ["disk", "redis", "influx"] as const;
type Store = typeof stores[number];
const TASK = "47f8742d-7560-48b5-a209-d23c752d452c";
const usage = new Map<string, { busy: boolean; counts: Record<Store, number> }>();
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
const names: Record<Store, string[]> = {
  disk: ["hit_ema", "exposure_ema_seconds", "base_model_hazard_ema", "model_hazard_ema", "actual_probability_1s", "theoretical_probability_1s"],
  redis: ["baseTarget", "beforeNormalize", "afterNormalize", "pmax", "normalizationScale", "currentCaProbability"],
  influx: ["count", "sample_schema", "sample_count", "sample_00", "bps_sum", "notional_sum"],
};
export function parseTaskBenchmarkRow(raw: unknown, mode: Store, sourceSha: string) {
  const row = raw as Record<string, unknown> & { fields?: { name: unknown; value: unknown }[]; currentRuntimeIdentity?: { sourceSha: unknown; pid: number; processStartedAt: unknown }; scope?: Record<string, unknown>; sampleIdentity?: Record<string, unknown>; quality?: Record<string, unknown> };
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (!row || row.version !== 1 || row.source !== mode || row.rowCount !== 1 ||
      !Array.isArray(row.fields) || row.fields.length !== 6 || row.fields.some((v: { name: unknown; value: unknown }, i: number) =>
        !v || v.name !== names[mode][i] || !finite(v.value)) ||
      row.currentRuntimeIdentity?.sourceSha !== sourceSha || !Number.isSafeInteger(row.currentRuntimeIdentity?.pid) || row.currentRuntimeIdentity.pid <= 0 ||
      !finite(row.currentRuntimeIdentity.processStartedAt) || row.scope?.strategy !== "MMRPI" || row.scope?.instance !== "5" ||
      row.scope?.symbol !== "bybit.perp.wlfi_usdt" || row.scope?.side !== "ask" || row.scope?.requestedAccount !== "bybit.Wealth_Trading09" ||
      !finite(row.readAtMs) || !finite(row.sourceTimeMs) || row.sourceTimeMs < 0 || row.sourceTimeMs > row.readAtMs + 5000 ||
      !(row.sourceAgeMs === null || finite(row.sourceAgeMs)) || !finite(row.sourceReadBytes) || row.sourceReadBytes < 0 ||
      !finite(row.sourceReadMs) || row.sourceReadMs < 0 ||
      (mode === "influx" ? row.sampleIdentity?.run !== "1794061842331754692" : row.sampleIdentity?.run !== null)) throw Error("Task benchmark source unavailable");
  const qualityKeys = ["ready", "enabled", "savedAt", "observationSchema", "available", "exportedAt", "quoted", "historicalFrozenPoint", "horizon", "tif", "accountAttribution"];
  if (!row.quality || qualityKeys.some(k => {
    const v = row.quality![k];
    return v != null && (typeof v === "number" ? !Number.isFinite(v) : typeof v === "string" ? v.length > 128 : typeof v !== "boolean");
  })) throw Error("Task benchmark source unavailable");
  const select = (value: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map(k => [k, value?.[k]]));
  return {
    version: 1, source: mode, rowCount: 1,
    scope: select(row.scope!, ["strategy", "instance", "symbol", "requestedAccount", "side", "meaning"]),
    currentRuntimeIdentity: select(row.currentRuntimeIdentity!, ["pid", "sourceSha", "processStartedAt"]),
    sampleIdentity: select(row.sampleIdentity!, ["run", "historicalSourceEvidence"]),
    sourceTimeMs: row.sourceTimeMs, readAtMs: row.readAtMs, sourceAgeMs: row.sourceAgeMs,
    quality: select(row.quality!, qualityKeys),
    fields: row.fields!.map(v => ({ name: v.name as string, value: v.value as number })),
    sourceReadBytes: row.sourceReadBytes, sourceReadBytesKind: String(row.sourceReadBytesKind).slice(0, 80),
    sourceReadMs: row.sourceReadMs, strictlyComparableContent: false,
  };
}
export async function readTaskPathBenchmark(mode: string, runId: string) {
  if (!stores.includes(mode as Store) || !/^[a-zA-Z0-9_-]{8,64}$/.test(runId)) throw Error("Task benchmark unavailable");
  const root = path.join(resolveStateDir(), "claw3d");
  const gateFile = path.join(root, "fill-probability-read-benchmark.json");
  const stat = await fs.stat(gateFile);
  if (stat.size > 4096 || (stat.mode & 0o077) !== 0) throw Error("Task benchmark unavailable");
  const gate = JSON.parse(await fs.readFile(gateFile, "utf8"));
  if (gate.version !== 1 || gate.enabled !== true || gate.taskId !== TASK || gate.runId !== runId ||
      !Number.isSafeInteger(gate.expiresAt) || gate.expiresAt <= Date.now() || gate.expiresAt > Date.now() + 15 * 60_000 ||
      gate.sourceId !== "preprod") throw Error("Task benchmark unavailable");
  const raw = await fs.readFile(path.join(root, "fill-probability.json"), "utf8");
  if (raw.length > 64 * 1024) throw Error("Task benchmark unavailable");
  const source = parseFillSources(JSON.parse(raw)).find(s => s.id === gate.sourceId);
  const spec = source?.strategies.find(s => s.name === "MMRPI");
  if (!source?.host || !spec) throw Error("Task benchmark unavailable");
  const { hosts } = await loadServerRegistry();
  if (!hosts.some(h => h.alias === source.host && h.active && h.group === "online")) throw Error("Task benchmark unavailable");
  const use = usage.get(runId) || { busy: false, counts: { disk: 0, redis: 0, influx: 0 } };
  if (use.busy || use.counts[mode as Store] >= 3) throw Error("Task benchmark budget exhausted");
  // Task-only in-process counters. No production cache clearing or persistence.
  usage.set(runId, use); use.busy = true; use.counts[mode as Store]++;
  const started = performance.now();
  try {
    const script = await fs.readFile(path.join(process.cwd(), "server/fill-probability-read-benchmark.py"), "utf8");
    const originalFillProbe = await fs.readFile(path.join(process.cwd(), "server/fill-probability-probe.py"), "utf8");
    const request = JSON.stringify({ mode, spec, originalFillProbe });
    const command = `timeout 10s ${quote(source.python || "python3")} -c ${quote(script)} ${quote(request)}`;
    const { stdout } = await exec("ssh", [...await sshTransportOptions(source.host), "-o", "ConnectTimeout=3", source.host, command], { cwd: os.homedir(), timeout: 12_000, maxBuffer: 128 * 1024 });
    const row = parseTaskBenchmarkRow(JSON.parse(stdout), mode as Store, spec.sourceSha);
    return { contract: "t85-html-read-v1", taskId: TASK, runId, source: mode, rows: [row], serverTime: Date.now(),
      cache: { policy: "task-reader-no-result-cache", hit: false, ageMs: null, databaseAndOSCache: "uncontrolled" },
      reader: { transport: "Office-registeredSSH-PreProd-realSource", totalMs: performance.now() - started },
      comparison: { numericFieldsPerRow: 6, sameStrategySymbolSide: true, sameContent: false, strictStorageRankingAllowed: false } };
  } catch { throw Error("Task benchmark source unavailable"); }
  finally { use.busy = false; }
}
