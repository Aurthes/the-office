import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { probeLocalMac } from "./local-mac";
import type { PoolHost, ServerMetrics, ServerRow, ServerSnapshot } from "./types";

const exec = promisify(execFile);
export const SERVER_REFRESH_MS = 30_000;

export function parseServerPool(text: string): PoolHost[] {
  const hosts: PoolHost[] = [], seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const [alias, group, params = ""] = line.split("|").map(value => value.trim());
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(alias) || !["online", "offline"].includes(group) || seen.has(alias)) throw new Error("Invalid server registry.");
    seen.add(alias);
    const active = !params.split(",").some(value => /^active\s*=\s*no$/i.test(value.trim()));
    hosts.push({ alias, group: group as PoolHost["group"], active });
  }
  if (hosts.length > 128) throw new Error("Server registry is too large.");
  return hosts;
}

export function monitoringHosts(text: string, platform: NodeJS.Platform = os.platform()): PoolHost[] {
  const hosts = parseServerPool(text);
  return platform === "darwin" ? [{ alias: "Local Mac", group: "local", active: true }, ...hosts] : hosts;
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
  const { stdout: effective } = await exec("ssh", ["-G", host.alias], { timeout: 1500, maxBuffer: 128_000 });
  const configuredPath = /^controlpath (.+)$/m.exec(effective)?.[1];
  const options = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=4", "-o", "ServerAliveInterval=2", "-o", "ServerAliveCountMax=1", "-o", "ControlMaster=auto", "-o", "ControlPersist=600"];
  if (!configuredPath || configuredPath === "none") {
    const directory = path.join(os.homedir(), ".ssh", "controlmasters");
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    options.push("-o", `ControlPath=${path.join(directory, "%C")}`);
  }
  // Check/reuse an existing host transport. Never stop another task's master.
  await exec("ssh", [...options, "-O", "check", host.alias], { timeout: 1000 }).catch(() => undefined);
  const script = await fs.readFile(path.join(process.cwd(), "server", "monitoring-probe.py"), "utf8");
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn("ssh", [...options, host.alias, "timeout", "6s", "python3", "-"], { stdio: ["pipe", "pipe", "pipe"], timeout: 8500, killSignal: "SIGKILL" });
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
        return previous || { ...host, status: host.active ? "pending" : "disabled", metrics: null, sampledAt: null, checkedAt: null, error: null };
      });
      signature = nextSignature; updatedAt = null;
    }
    if (!inFlight && (updatedAt === null || now() - updatedAt >= SERVER_REFRESH_MS)) {
      const generation = signature, queue = rows.filter(row => row.active);
      const worker = async () => {
        for (;;) {
          const row = queue.shift(); if (!row) return;
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
  const file = process.env.CLAW3D_SERVER_POOL_FILE?.trim();
  let text = "";
  if (file) {
    const stat = await fs.stat(file);
    if (stat.size > 80_000) throw new Error("Server registry is too large.");
    text = await fs.readFile(file, "utf8");
  }
  const hosts = monitoringHosts(text);
  return file || hosts.length ? snapshot(hosts) : { configured: false, refreshing: false, updatedAt: null, servers: [] };
}
