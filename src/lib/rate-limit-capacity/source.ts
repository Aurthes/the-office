import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveStateDir } from "@/lib/clawdbot/paths";
import { loadServerRegistry, sshTransportOptions } from "../../../server/server-registry";
import { CAPACITY_REFRESH_MS, capacityRows, type CapacitySnapshot, type ProducerReply } from "./model";

const exec = promisify(execFile);
export type CapacitySource = { id: string; host?: string; python?: string; strategies: { name: string; setting: string }[] };
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export function parseCapacitySources(raw: unknown): CapacitySource[] {
  const config = raw as { version?: number; sources?: CapacitySource[] };
  if (config?.version !== 1 || !Array.isArray(config.sources) || config.sources.length > 4) throw new Error("Invalid capacity configuration");
  const names = new Set<string>();
  const absolute = (s: unknown): s is string => typeof s === "string" && path.posix.isAbsolute(s) && s.length <= 1024 && !/[\x00-\x1f\x7f]/.test(s);
  for (const s of config.sources) {
    if (!s || typeof s.id !== "string" || !/^[a-zA-Z0-9_.-]{1,64}$/.test(s.id) || names.has(s.id) ||
      (s.host !== undefined && (typeof s.host !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(s.host))) ||
      (s.python !== undefined && s.python !== "python3" && !absolute(s.python)) || !Array.isArray(s.strategies) || !s.strategies.length || s.strategies.length > 16) throw new Error("Invalid capacity source");
    names.add(s.id);
    const strategies = new Set<string>();
    for (const strategy of s.strategies) {
      if (!strategy || typeof strategy.name !== "string" || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(strategy.name) || strategies.has(strategy.name) || !absolute(strategy.setting)) throw new Error("Invalid capacity strategy");
      strategies.add(strategy.name);
    }
  }
  return config.sources;
}

export async function readCapacitySource(source: CapacitySource): Promise<ProducerReply[]> {
  const script = await fs.readFile(path.join(process.cwd(), "server/rate-limit-capacity-probe.py"), "utf8");
  const request = JSON.stringify({ id: source.id, strategies: source.strategies });
  let stdout: string;
  if (source.host) {
    const { hosts } = await loadServerRegistry();
    if (!hosts.some(h => h.alias === source.host && h.active && h.group === "online")) throw new Error("Capacity source unavailable");
    const options = await sshTransportOptions(source.host);
    const command = `timeout 6s ${quote(source.python || "python3")} -c ${quote(script)} ${quote(request)}`;
    ({ stdout } = await exec("ssh", [...options, "-o", "ConnectTimeout=3", source.host, command], { cwd: os.homedir(), timeout: 8_000, maxBuffer: 4*1024*1024 }));
  } else {
    ({ stdout } = await exec(source.python || "python3", ["-c", script, request], { cwd: os.homedir(), timeout: 8_000, maxBuffer: 4*1024*1024 }));
  }
  const data = JSON.parse(stdout) as { version: number; producers: ProducerReply[] };
  if (data.version !== 1 || !Array.isArray(data.producers) || data.producers.length !== source.strategies.length ||
      data.producers.some((p, i) => p?.strategy !== source.strategies[i].name || p.id !== `${source.id}:${p.strategy}`)) throw new Error("Invalid capacity reply");
  return data.producers;
}

export function createCapacityReader(read = readCapacitySource, now = Date.now) {
  let signature = "", sampledAt: number | null = null;
  let values = new Map<string, ProducerReply[]>();
  let pending: Promise<void> | null = null;
  return async (sources: CapacitySource[]): Promise<CapacitySnapshot> => {
    const next = JSON.stringify(sources);
    if (next !== signature) { signature = next; sampledAt = null; values = new Map(); }
    if (!pending && (sampledAt === null || now() - sampledAt >= CAPACITY_REFRESH_MS)) {
      const generation = signature;
      pending = Promise.all(sources.map(async source => {
        try {
          const replies = await read(source);
          if (generation === signature) values.set(source.id, replies.map(p => p.error ? {
            ...values.get(source.id)?.find(old => old.id === p.id), ...p,
            expected: p.expected && Array.isArray(p.expected) && p.expected.length ? p.expected : values.get(source.id)?.find(old => old.id === p.id)?.expected,
            heartbeat: p.heartbeat || values.get(source.id)?.find(old => old.id === p.id)?.heartbeat,
          } : p));
        } catch {
          if (generation === signature) values.set(source.id, (values.get(source.id) || source.strategies.map(s => ({ id: `${source.id}:${s.name}`, strategy: s.name }))).map(p => ({ ...p, error: "read-failed" })));
        }
      })).then(() => { if (generation === signature) sampledAt = now(); }).finally(() => { pending = null; });
    }
    if (pending) await pending;
    const producers = [...values.values()].flat();
    return { configured: sources.length > 0, sampledAt, serverTime: now(), sourceErrors: producers.filter(p => p.error).length, rows: capacityRows(producers) };
  };
}
const read = createCapacityReader();
export async function getCapacitySnapshot(): Promise<CapacitySnapshot> {
  const file = path.join(resolveStateDir(), "claw3d/rate-limit-capacity.json");
  try {
    if ((await fs.stat(file)).size > 64*1024) throw new Error("Invalid capacity configuration");
    return read(parseCapacitySources(JSON.parse(await fs.readFile(file, "utf8"))));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return read([]);
    throw error;
  }
}
