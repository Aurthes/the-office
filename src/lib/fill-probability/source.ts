import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { gunzip } from "node:zlib";
import { resolveStateDir } from "@/lib/clawdbot/paths";
import { loadServerRegistry, sshTransportOptions } from "../../../server/server-registry";
import { FILL_REFRESH_MS, type FillRow, type FillSnapshot, type FillQuote, type fillTableFields } from "./model";

const exec = promisify(execFile), decompress = promisify(gunzip);
export type FillProjection = ReturnType<typeof fillTableFields>;
export class FillSourceDataError extends Error { constructor() { super("Invalid fill source data"); } }
const sourceProjection = (projection: FillProjection) => ({
  row: [...new Set(["id", "producer", "strategy", "instance", "account", "exchange", "market", "symbol", "side", ...projection.row])].sort(),
  quote: [...projection.quote].sort(),
});
export type FillSource = { id: string; host?: string; python?: string; strategies: {
  name: string; setting: string; sourceSha: string; feedbackVersion: 8 | 9;
}[] };
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export function parseFillSources(raw: unknown): FillSource[] {
  const config = raw as { version?: number; sources?: FillSource[] };
  if (config?.version !== 1 || !Array.isArray(config.sources) || config.sources.length > 4) throw new Error("Invalid fill configuration");
  const absolute = (s: unknown): s is string => typeof s === "string" && path.posix.isAbsolute(s) && s.length <= 1024 && !/[\x00-\x1f\x7f]/.test(s);
  const names = new Set<string>();
  for (const s of config.sources) {
    if (!s || typeof s.id !== "string" || !/^[a-zA-Z0-9_.-]{1,64}$/.test(s.id) || names.has(s.id) ||
        s.host !== undefined && (typeof s.host !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(s.host)) ||
        s.python !== undefined && s.python !== "python3" && !absolute(s.python) ||
        !Array.isArray(s.strategies) || !s.strategies.length || s.strategies.length > 16) throw new Error("Invalid fill source");
    names.add(s.id);
    const strategies = new Set<string>();
    for (const p of s.strategies) {
      if (!p || typeof p.name !== "string" || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(p.name) || strategies.has(p.name) ||
          !absolute(p.setting) || typeof p.sourceSha !== "string" || !/^[0-9a-f]{40}$/.test(p.sourceSha) ||
          ![8, 9].includes(p.feedbackVersion)) throw new Error("Invalid fill strategy");
      strategies.add(p.name);
    }
  }
  return config.sources;
}

// Explicit scalar projection: remote configuration/credentials never reach the API.
export function parseFillQuote(raw: unknown): FillQuote | null {
  if (raw === null) return null;
  const q = raw as Record<string, unknown>;
  const numbers = ["at", "exportedAt", "baseTarget", "beforeNormalize", "afterNormalize", "pmax", "normalizationScale", "logAfterNormalize", "ca", "logCa", "referencePrice", "currentCaProbability", "baseAtReferenceProbability", "p1BeforePrice", "p1AfterPrice", "postOnlyAfterPrice", "p2AfterPrice", "finalPrice", "p1BeforeProbability", "p1AfterProbability", "postOnlyAfterProbability", "p2AfterProbability", "finalProbability", "disabledMask"];
  const bools = ["normalizationEnabled", "underflow", "quoted"];
  const states = ["p1State", "postOnlyState", "p2State"];
  if (!q || typeof q !== "object" || typeof q.available !== "boolean" ||
      numbers.some(k => q[k] !== null && (typeof q[k] !== "number" || !Number.isFinite(q[k]))) ||
      bools.some(k => q[k] !== null && typeof q[k] !== "boolean") ||
      states.some(k => !["changed", "unchanged", "not-run", "rejected", "unknown"].includes(String(q[k]))) ||
      q.guardReason !== null && (typeof q.guardReason !== "string" || q.guardReason.length > 128) ||
      q.quoted === false && q.finalProbability !== null) throw new Error("Invalid quote observation");
  for (const key of ["baseTarget", "beforeNormalize", "afterNormalize", "pmax", "currentCaProbability", "baseAtReferenceProbability", "p1BeforeProbability", "p1AfterProbability", "postOnlyAfterProbability", "p2AfterProbability", "finalProbability"])
    if (q[key] !== null && ((q[key] as number) < 0 || (q[key] as number) > 1)) throw new Error("Invalid quote probability");
  return Object.fromEntries([...numbers, ...bools, ...states, "available", "guardReason"].map(k => [k, q[k]])) as FillQuote;
}

export function parseFillReply(raw: unknown, source: FillSource, projection?: FillProjection): FillRow[] {
  if (projection) {
    const data = raw as { version?: number; projection?: unknown; rows?: Record<string, unknown>[] }, fields = sourceProjection(projection);
    if (data?.version !== 1 || JSON.stringify(data.projection) !== JSON.stringify(fields) || !Array.isArray(data.rows) || data.rows.length > 8192) throw new FillSourceDataError();
    const rowKeys = ["pid", "heartbeatAt", "savedAt", "observedAt", "schema", "halfLife", "adjustmentInterval", "adjustmentProgress", "weightedHits", "weightedExposureSeconds", "baseTheoreticalEma", "theoreticalEma", "actualEma", "ca", "logCa", "target"];
    const quoteKeys = ["at", "exportedAt", "baseTarget", "beforeNormalize", "afterNormalize", "pmax", "normalizationScale", "logAfterNormalize", "ca", "logCa", "referencePrice", "currentCaProbability", "baseAtReferenceProbability", "p1BeforePrice", "p1AfterPrice", "postOnlyAfterPrice", "p2AfterPrice", "finalPrice", "p1BeforeProbability", "p1AfterProbability", "postOnlyAfterProbability", "p2AfterProbability", "finalProbability", "disabledMask", "normalizationEnabled", "underflow", "quoted", "guardReason"];
    const rows = data.rows.map(row => {
      if (!row || fields.row.some(k => !Object.hasOwn(row, k)) || !Object.hasOwn(row, "quote")) throw new FillSourceDataError();
      const q = row.quote as Record<string, unknown> | null;
      if (q !== null && (!q || fields.quote.some(k => !Object.hasOwn(q, k)))) throw new FillSourceDataError();
      return { ...Object.fromEntries(rowKeys.map(k => [k, null])), ...Object.fromEntries(fields.row.map(k => [k, row[k]])),
        quote: q === null ? null : { ...Object.fromEntries(quoteKeys.map(k => [k, null])), p1State: "unknown", postOnlyState: "unknown", p2State: "unknown", ...Object.fromEntries(fields.quote.map(k => [k, q[k]])) } };
    });
    return parseFillReply({ version: 1, rows }, source);
  }
  const data = raw as { version?: number; rows?: Record<string, unknown>[] };
  if (data?.version !== 1 || !Array.isArray(data.rows) || data.rows.length > 8192) throw new Error("Invalid fill reply");
  const strings = ["id", "producer", "strategy", "instance", "account", "exchange", "market", "symbol"] as const;
  const numbers = ["pid", "heartbeatAt", "savedAt", "observedAt", "schema", "halfLife", "adjustmentInterval", "adjustmentProgress", "weightedHits", "weightedExposureSeconds", "baseTheoreticalEma", "theoreticalEma", "actualEma", "ca", "logCa", "target"] as const;
  const ids = new Set<string>();
  return data.rows.map(r => {
    const spec = source.strategies.find(s => s.name === r?.strategy);
    if (!r || typeof r !== "object" || strings.some(k => typeof r[k] !== "string" || (r[k] as string).length > 1024) ||
        !spec || r.producer !== `${source.id}:${r.strategy}` ||
        r.schema !== null && (r.schema !== spec.feedbackVersion || r.sourceSha !== spec.sourceSha || r.clock !== (r.schema === 8 ? "exposure_seconds" : "trials")) ||
        !["bid", "ask"].includes(String(r.side)) || !["exposure_seconds", "trials", "unknown"].includes(String(r.clock)) ||
        numbers.some(k => r[k] !== null && (typeof r[k] !== "number" || !Number.isFinite(r[k]))) ||
        r.sourceSha !== null && (typeof r.sourceSha !== "string" || !/^[0-9a-f]{40}$/.test(r.sourceSha)) ||
        r.enabled !== null && typeof r.enabled !== "boolean" || typeof r.error !== "boolean" ||
        r.ready !== null && typeof r.ready !== "boolean" ||
        r.skipReason !== null && !["", "disabled", "insufficient_exposure", "invalid_config", "invalid_episode"].includes(String(r.skipReason)) ||
        r.reason !== null && !["no-exposure", "cache-not-exported", "invalid-cache", "live-identity-unverified"].includes(String(r.reason)) || ids.has(String(r.id))) throw new Error("Invalid fill row");
    ids.add(String(r.id));
    return { ...Object.fromEntries([...strings, ...numbers, "sourceSha", "side", "clock", "enabled", "error", "reason", "ready", "skipReason"].map(k => [k, r[k]])), quote: parseFillQuote(r.quote) } as FillRow;
  });
}

// Bounded request diagnostics, separate from business facts and observation clocks.
export type FillSourceTiming = {
  totalMs: number; prepareMs?: number; execMs?: number; decodeMs?: number; stdoutBytes?: number; wireBytes?: number; decodedBytes?: number;
};
export type FillSnapshotTiming = {
  cache: "hit" | "pending" | "new"; batchId: string; ageMs: number | null; sources: FillSourceTiming[];
};
export async function readFillSource(source: FillSource, observe?: (timing: FillSourceTiming) => void, projection?: FillProjection): Promise<FillRow[]> {
  const started = performance.now(), timing: FillSourceTiming = { totalMs: 0 };
  try {
    const script = await fs.readFile(path.join(process.cwd(), "server/fill-probability-probe.py"), "utf8");
    const request = JSON.stringify({ id: source.id, strategies: source.strategies, ...(projection ? { projection: sourceProjection(projection), wire_gzip: true } : {}) });
    const options = { cwd: os.homedir(), timeout: 12_000, maxBuffer: projection ? 2*1024*1024 : 4*1024*1024, ...(projection ? { encoding: "buffer" as const } : {}) };
    let stdout: string | Buffer;
    if (source.host) {
      const { hosts } = await loadServerRegistry();
      if (!hosts.some(h => h.alias === source.host && h.active && h.group === "online")) throw new Error("Fill source unavailable");
      const command = `timeout 10s ${quote(source.python || "python3")} -c ${quote(script)} ${quote(request)}`;
      const args = [...await sshTransportOptions(source.host), "-o", "ConnectTimeout=3", source.host, command];
      timing.prepareMs = performance.now() - started;
      const executing = performance.now();
      try { ({ stdout } = await exec("ssh", args, options)); }
      finally { timing.execMs = performance.now() - executing; }
    } else {
      timing.prepareMs = performance.now() - started;
      const executing = performance.now();
      try { ({ stdout } = await exec(source.python || "python3", ["-c", script, request], options)); }
      finally { timing.execMs = performance.now() - executing; }
    }
    timing.wireBytes = Buffer.byteLength(stdout);
    const decoding = performance.now();
    try {
      if (projection && (!Buffer.isBuffer(stdout) || stdout.byteLength > 2*1024*1024)) throw new FillSourceDataError();
      const decoded = projection ? await decompress(stdout, { maxOutputLength: 4*1024*1024 }) : Buffer.from(stdout);
      if (decoded.byteLength > 4*1024*1024) throw new FillSourceDataError();
      // stdoutBytes retains its original decoded-JSON meaning; wireBytes is transport bytes.
      timing.stdoutBytes = timing.decodedBytes = decoded.byteLength;
      const rows = parseFillReply(JSON.parse(decoded.toString("utf8")), source, projection);
      timing.decodeMs = performance.now() - decoding;
      return rows;
    } catch { throw new FillSourceDataError(); }
  } finally { timing.totalMs = performance.now() - started; observe?.(timing); }
}

export function createFillReader(read = readFillSource, now = Date.now) {
  const fresh = () => ({ sampledAt: null as number | null, values: new Map<string, FillRow[]>(), failures: new Set<string>(), pending: null as Promise<void> | null,
    batch: { id: randomUUID(), sources: [] as FillSourceTiming[] } });
  let signature = "", state = fresh();
  return async (sources: FillSource[], observe?: (timing: FillSnapshotTiming) => void, projection?: FillProjection): Promise<FillSnapshot> => {
    const next = JSON.stringify([sources, projection ? sourceProjection(projection) : null]);
    if (next !== signature) { signature = next; state = fresh(); }
    const current = state;
    const cache = current.pending ? "pending" : current.sampledAt === null || current.failures.size > 0 || now() - current.sampledAt >= FILL_REFRESH_MS ? "new" : "hit";
    if (cache === "new") {
      current.batch = { id: randomUUID(), sources: [] };
      let invalid = false;
      current.pending = Promise.all(sources.map(async (source, index) => {
        const started = performance.now();
        try { current.values.set(source.id, await read(source, timing => { current.batch.sources[index] = timing; }, projection)); current.failures.delete(source.id); }
        catch (error) { invalid ||= error instanceof FillSourceDataError; current.failures.add(source.id); current.values.set(source.id, (current.values.get(source.id) || []).map(r => ({ ...r, error: true }))); }
        finally { current.batch.sources[index] ??= { totalMs: performance.now() - started }; }
      })).then(() => { if (invalid) throw new FillSourceDataError(); if (!current.failures.size) current.sampledAt = now(); }).finally(() => { current.pending = null; });
    }
    const batch = current.batch;
    if (current.pending) await current.pending;
    const rows = [...current.values.values()].flat(), serverTime = now();
    observe?.({ cache, batchId: batch.id, ageMs: current.sampledAt === null ? null : Math.max(0, serverTime - current.sampledAt), sources: cache === "hit" ? [] : batch.sources });
    return { configured: sources.length > 0, serverTime, sampledAt: current.sampledAt,
      sourceErrors: current.failures.size, rows };
  };
}
const read = createFillReader(), readTable = createFillReader();
export async function getFillSnapshot(observe?: (timing: FillSnapshotTiming) => void, projection?: FillProjection): Promise<FillSnapshot> {
  const file = path.join(resolveStateDir(), "claw3d/fill-probability.json"), reader = projection ? readTable : read;
  try {
    if ((await fs.stat(file)).size > 64*1024) throw new Error("Invalid fill configuration");
    return reader(parseFillSources(JSON.parse(await fs.readFile(file, "utf8"))), observe, projection);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return reader([], observe, projection);
    throw error;
  }
}
