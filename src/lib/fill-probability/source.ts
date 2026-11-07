import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveStateDir } from "@/lib/clawdbot/paths";
import { loadServerRegistry, sshTransportOptions } from "../../../server/server-registry";
import { FILL_REFRESH_MS, type FillRow, type FillSnapshot } from "./model";

const exec = promisify(execFile);
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
export function parseFillReply(raw: unknown, source: FillSource): FillRow[] {
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
        r.reason !== null && !["no-exposure", "cache-not-exported", "invalid-cache", "live-identity-unverified"].includes(String(r.reason)) || ids.has(String(r.id))) throw new Error("Invalid fill row");
    ids.add(String(r.id));
    return Object.fromEntries([...strings, ...numbers, "sourceSha", "side", "clock", "enabled", "error", "reason"].map(k => [k, r[k]])) as FillRow;
  });
}

export async function readFillSource(source: FillSource): Promise<FillRow[]> {
  const script = await fs.readFile(path.join(process.cwd(), "server/fill-probability-probe.py"), "utf8");
  const request = JSON.stringify({ id: source.id, strategies: source.strategies });
  let stdout: string;
  if (source.host) {
    const { hosts } = await loadServerRegistry();
    if (!hosts.some(h => h.alias === source.host && h.active && h.group === "online")) throw new Error("Fill source unavailable");
    const command = `timeout 10s ${quote(source.python || "python3")} -c ${quote(script)} ${quote(request)}`;
    ({ stdout } = await exec("ssh", [...await sshTransportOptions(source.host), "-o", "ConnectTimeout=3", source.host, command], { cwd: os.homedir(), timeout: 12_000, maxBuffer: 4*1024*1024 }));
  } else {
    ({ stdout } = await exec(source.python || "python3", ["-c", script, request], { cwd: os.homedir(), timeout: 12_000, maxBuffer: 4*1024*1024 }));
  }
  return parseFillReply(JSON.parse(stdout), source);
}

export function createFillReader(read = readFillSource, now = Date.now) {
  const fresh = () => ({ sampledAt: null as number | null, values: new Map<string, FillRow[]>(), failures: new Set<string>(), pending: null as Promise<void> | null });
  let signature = "", state = fresh();
  return async (sources: FillSource[]): Promise<FillSnapshot> => {
    const next = JSON.stringify(sources);
    if (next !== signature) { signature = next; state = fresh(); }
    const current = state;
    if (!current.pending && (current.sampledAt === null || now() - current.sampledAt >= FILL_REFRESH_MS)) {
      current.pending = Promise.all(sources.map(async source => {
        try { current.values.set(source.id, await read(source)); current.failures.delete(source.id); }
        catch { current.failures.add(source.id); current.values.set(source.id, (current.values.get(source.id) || []).map(r => ({ ...r, error: true }))); }
      })).then(() => { current.sampledAt = now(); }).finally(() => { current.pending = null; });
    }
    if (current.pending) await current.pending;
    const rows = [...current.values.values()].flat();
    return { configured: sources.length > 0, serverTime: now(), sampledAt: current.sampledAt,
      sourceErrors: current.failures.size, rows };
  };
}
const read = createFillReader();
export async function getFillSnapshot(): Promise<FillSnapshot> {
  const file = path.join(resolveStateDir(), "claw3d/fill-probability.json");
  try {
    if ((await fs.stat(file)).size > 64*1024) throw new Error("Invalid fill configuration");
    return read(parseFillSources(JSON.parse(await fs.readFile(file, "utf8"))));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return read([]);
    throw error;
  }
}
