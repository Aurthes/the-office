import { execFile } from "node:child_process";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { DiskMetric, ServerMetrics } from "./types";

const exec = promisify(execFile);
const read = (command: string, args: string[] = []) => exec(command, args, { timeout: 2000, maxBuffer: 256_000 }).then(result => result.stdout).catch(() => null);

export function macMemoryUsed(text: string | null, total: number): number | null {
  if (text === null) return null;
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  const available = ["free", "inactive", "speculative"].map(name => Number(new RegExp(`^Pages ${name}:\\s+(\\d+)\\.`, "m").exec(text)?.[1]));
  if (!pageSize || available.some(value => !Number.isFinite(value))) return null;
  // Free, inactive and speculative pages are reclaimable. Do not count swap or
  // the uncompressed size of compressed pages as physical RAM in use.
  return Math.max(0, Math.min(total, total - available.reduce((a, b) => a + b, 0) * pageSize));
}

export function macNetworkCounters(text: string | null): Map<string, [number, number]> | null {
  if (text === null || !/\bIbytes\b.*\bObytes\b/.test(text.split("\n")[0])) return null;
  const result = new Map<string, [number, number]>();
  for (const line of text.split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/), tail = fields.slice(-7);
    // One link-layer row per physical interface. IP rows repeat the same byte
    // counters; bridges, loopback and VPN interfaces would double-count traffic.
    if (!/^en\d+\*?$/.test(fields[0]) || !fields[2]?.startsWith("<Link#")) continue;
    const rx = Number(tail[2]), tx = Number(tail[5]);
    if (Number.isFinite(rx) && Number.isFinite(tx) && rx >= 0 && tx >= 0) result.set(fields[0].replace(/\*$/, ""), [rx, tx]);
  }
  return result;
}

export function macDisks(text: string | null): DiskMetric[] {
  if (text === null) return [];
  const seen = new Set<string>();
  return text.split("\n").slice(1).flatMap(line => {
    const fields = /^(\/dev\/\S+)\s+(\d+)\s+(\d+)\s+\d+\s+(\d+(?:\.\d+)?)%\s+(.+)$/.exec(line);
    if (!fields || seen.has(fields[1])) return [];
    seen.add(fields[1]);
    return [{ mount: fields[5], total: Number(fields[2]) * 1024, used: Number(fields[3]) * 1024, percent: Number(fields[4]) }];
  });
}

export function cpuUsage(first: os.CpuInfo[], second: os.CpuInfo[]): number | null {
  if (!first.length || first.length !== second.length) return null;
  const totals = (cpus: os.CpuInfo[]) => cpus.reduce((sum, cpu) => ({
    total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0), idle: sum.idle + cpu.times.idle,
  }), { total: 0, idle: 0 });
  const before = totals(first), after = totals(second), total = after.total - before.total, idle = after.idle - before.idle;
  return total > 0 && idle >= 0 ? Math.max(0, Math.min(100, 100 * (1 - idle / total))) : null;
}

async function network() {
  const counters = macNetworkCounters(await read("/usr/sbin/netstat", ["-ibn"]));
  return { counters, time: performance.now() };
}

export async function probeLocalMac(): Promise<ServerMetrics> {
  const firstCpu = os.cpus(), firstNet = await network();
  await delay(1000);
  const [secondNet, memory, disks] = await Promise.all([
    network(), read("/usr/bin/vm_stat"), read("/bin/df", ["-k", "-P", "-l"]),
  ]);
  const secondCpu = os.cpus(), elapsed = (secondNet.time - firstNet.time) / 1000;
  const shared = firstNet.counters && secondNet.counters ? [...firstNet.counters.keys()].filter(name => secondNet.counters!.has(name)) : [];
  const rate = (index: 0 | 1) => shared.length && elapsed > 0 ? shared.reduce((sum, name) => sum + Math.max(0, secondNet.counters!.get(name)![index] - firstNet.counters!.get(name)![index]), 0) / elapsed : null;
  const memoryTotal = os.totalmem();
  return {
    cores: secondCpu.length || 1, cpuPercent: cpuUsage(firstCpu, secondCpu), load1: os.loadavg()[0],
    memoryTotal, memoryUsed: macMemoryUsed(memory, memoryTotal), disks: macDisks(disks),
    rxBytesPerSecond: rate(0), txBytesPerSecond: rate(1), uptimeSeconds: os.uptime(),
  };
}
