import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseServerPool, loadServerRegistry, sshTransportOptions } from "../../../server/server-registry";
import { probeLocalMac } from "./local-mac";
import type { PoolHost, ServerMetrics, ServerRow, ServerSnapshot } from "./types";

export const SERVER_REFRESH_MS = 30_000;

export { parseServerPool } from "../../../server/server-registry";

export function monitoringHosts(text: string, platform: NodeJS.Platform = os.platform()): PoolHost[] {
  const hosts = parseServerPool(text);
  void platform;
  return hosts;
}

function metricsFromJson(stdout: string): ServerMetrics {
  const value = JSON.parse(stdout);
  if (!value || typeof value !== "object" || !Number.isInteger(value.cores) || value.cores < 1 || !Array.isArray(value.disks)) throw new Error("Invalid host metrics.");
  const number = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
  return {
    cores: value.cores, cpuPercent: number(value.cpuPercent) === null ? null : Math.min(100, value.cpuPercent), load1: number(value.load1),
    memoryTotal: number(value.memoryTotal), memoryUsed: number(value.memoryUsed),
    rxBytesPerSecond: number(value.rxBytesPerSecond), txBytesPerSecond: number(value.txBytesPerSecond), uptimeSeconds: number(value.uptimeSeconds),
    disks: value.disks.flatMap((d: Record<string, unknown>) => d && typeof d.mount === "string" && number(d.total) !== null && number(d.used) !== null && number(d.percent) !== null ? [{ mount: d.mount.slice(0, 160), total: d.total as number, used: d.used as number, percent: d.percent as number }] : []),
  };
}

export async function probeServer(host: PoolHost): Promise<ServerMetrics> {
  if (host.group === "local") return probeLocalMac();
  const options = [...await sshTransportOptions(host.alias), "-o", "ConnectTimeout=4", "-o", "ServerAliveInterval=2", "-o", "ServerAliveCountMax=1"];
  const script = await fs.readFile(path.join(process.cwd(), "server", "monitoring-probe.py"), "utf8");
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn("ssh", [...options, host.alias, "timeout", "6s", "python3", "-"], { cwd: os.homedir(), stdio: ["pipe", "pipe", "pipe"], timeout: 8500, killSignal: "SIGKILL" });
    let output = "", error = "";
    child.stdout.on("data", chunk => { output += String(chunk); if (output.length > 128_000) child.kill("SIGKILL"); });
    child.stderr.on("data", chunk => { error = (error + String(chunk)).slice(-4000); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(output) : reject(new Error(error.includes("Permission denied") ? "SSH authentication failed" : error.includes("Host key verification failed") ? "SSH host key not trusted" : "Server is unreachable or the sample timed out")));
    child.stdin.on("error", () => undefined);
    child.stdin.end(script);
  });
  return metricsFromJson(stdout);
}

// One shared, bounded refresh. Clients see completed rows while the remaining
// hosts are sampled. Closed dashboards stop requesting further refreshes.
export function createServerStatusStore(probe: (host: PoolHost) => Promise<ServerMetrics> = probeServer, now = Date.now) {
  let rows: ServerRow[] = [], signature = "", updatedAt: number | null = null;
  let inFlight: Promise<void> | null = null;
  return (hosts: PoolHost[]): ServerSnapshot => {
    const nextSignature = JSON.stringify(hosts);
    if (signature !== nextSignature) {
      rows = hosts.map(host => {
        const previous = rows.find(row => row.alias === host.alias && row.group === host.group && row.active === host.active);
        return previous ? Object.assign(previous, host, { family: host.family }) : { ...host, status: host.active ? "pending" : "disabled", metrics: null, sampledAt: null, checkedAt: null, error: null };
      });
      signature = nextSignature; updatedAt = null;
    }
    if (!inFlight && (updatedAt === null || now() - updatedAt >= SERVER_REFRESH_MS)) {
      const generation = signature, queue = rows.filter(row => row.active);
      const worker = async () => {
        for (;;) {
          const row = queue.shift(); if (!row) return;
          if (!rows.includes(row) || !row.active) continue;
          try {
            const metrics = await probe(row);
            row.metrics = metrics; row.sampledAt = now(); row.status = "ready"; row.error = null;
          } catch (error) {
            row.status = "unreachable";
            row.error = error instanceof Error && ["SSH authentication failed", "SSH host key not trusted"].includes(error.message) ? error.message : "Server is unreachable or the sample timed out";
          }
          row.checkedAt = now();
        }
      };
      inFlight = Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker)).then(() => {
        if (signature === generation) updatedAt = now();
      }).finally(() => { inFlight = null; });
    }
    return { configured: true, refreshing: !!inFlight, updatedAt, servers: rows.map(row => ({ ...row })) };
  };
}

const snapshot = createServerStatusStore();
export async function getServerSnapshot(): Promise<ServerSnapshot> {
  const { configured, hosts } = await loadServerRegistry();
  return { ...snapshot(hosts), configured };
}
