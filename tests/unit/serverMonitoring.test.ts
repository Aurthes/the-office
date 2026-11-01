// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createServerStatusStore, monitoringHosts, parseServerPool, SERVER_REFRESH_MS } from "@/lib/monitoring/servers";
import type { PoolHost, ServerMetrics } from "@/lib/monitoring/types";

const metrics: ServerMetrics = { cores: 16, cpuPercent: 25, load1: 4, memoryTotal: 1024, memoryUsed: 0, disks: [{ mount: "/", total: 100, used: 50, percent: 50 }], rxBytesPerSecond: 0, txBytesPerSecond: 0, uptimeSeconds: 100 };
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

it("keeps server purpose separate from active state and never includes registry notes or transport settings", () => {
  expect(parseServerPool("# header\nprod|online|release_root=/private|secret note\ncompute|offline||note\nold|offline|active=no|out of service")).toEqual([
    { alias: "prod", group: "online", active: true }, { alias: "compute", group: "offline", active: true }, { alias: "old", group: "offline", active: false },
  ]);
  for (const text of ["-oProxyCommand=x|online||", "user@host|online||", "host;touch|online||", "a|unknown||", "a|local||", "a|online||\na|offline||"]) expect(() => parseServerPool(text)).toThrow();
});

it("includes Local Mac independently of the remote registry and leaves Linux host lists unchanged", () => {
  expect(monitoringHosts("", "darwin")).toEqual([{ alias: "Local Mac", group: "local", active: true }]);
  const remote = "compute|offline||\nretired|online|active=no|";
  expect(monitoringHosts(remote, "darwin")).toEqual([{ alias: "Local Mac", group: "local", active: true }, ...parseServerPool(remote)]);
  expect(monitoringHosts(remote, "linux")).toEqual(parseServerPool(remote));
  expect(monitoringHosts("", "linux")).toEqual([]);
});

it("shares one refresh across clients, streams completed rows, bounds concurrency, and never probes disabled hosts", async () => {
  let running = 0, maximum = 0;
  const pending: Array<() => void> = [];
  const probe = vi.fn(async () => {
    running++; maximum = Math.max(maximum, running);
    await new Promise<void>(resolve => pending.push(resolve)); running--; return metrics;
  });
  let time = 100;
  const read = createServerStatusStore(probe, () => time);
  const hosts = parseServerPool(Array.from({ length: 6 }, (_, i) => `h${i}|offline||`).join("\n") + "\nretired|online|active=no|");
  expect(read(hosts).refreshing).toBe(true);
  expect(probe).toHaveBeenCalledTimes(4);
  read(hosts); read(hosts); expect(probe).toHaveBeenCalledTimes(4);
  pending.shift()!(); await flush();
  expect(read(hosts).servers.filter(row => row.status === "ready")).toHaveLength(1);
  while (pending.length) { pending.shift()!(); await flush(); }
  const done = read(hosts);
  expect(done.refreshing).toBe(false);
  expect(done.servers.filter(row => row.status === "ready")).toHaveLength(6);
  expect(done.servers.find(row => row.alias === "retired")).toMatchObject({ status: "disabled", metrics: null, sampledAt: null });
  expect(maximum).toBe(4); expect(probe).toHaveBeenCalledTimes(6);
  time += SERVER_REFRESH_MS - 1; read(hosts); expect(probe).toHaveBeenCalledTimes(6);
  time += 1; expect(read(hosts).refreshing).toBe(true); expect(probe).toHaveBeenCalledTimes(10);
  while (pending.length) { pending.shift()!(); await flush(); }
});

it("marks unreachable hosts and preserves a timestamped stale sample instead of inventing zero usage", async () => {
  let time = 100;
  const probe = vi.fn<((host: PoolHost) => Promise<ServerMetrics>)>().mockResolvedValueOnce(metrics).mockRejectedValue(new Error("private transport details"));
  const read = createServerStatusStore(probe, () => time), hosts = parseServerPool("prod|online||");
  read(hosts); await flush();
  const good = read(hosts).servers[0];
  expect(good).toMatchObject({ status: "ready", sampledAt: 100, metrics });
  time += SERVER_REFRESH_MS; read(hosts); await flush();
  const failed = read(hosts).servers[0];
  expect(failed).toMatchObject({ status: "unreachable", sampledAt: 100, checkedAt: time, metrics });
  expect(failed.error).not.toContain("private transport");
});

it("keeps first-time connection failures as unknown values and incorporates registry changes", async () => {
  const probe = vi.fn().mockRejectedValue(new Error("no network"));
  const read = createServerStatusStore(probe);
  read(parseServerPool("a|offline||")); await flush();
  expect(read(parseServerPool("a|offline||")).servers[0]).toMatchObject({ status: "unreachable", metrics: null, sampledAt: null });
  const changed = read(parseServerPool("b|online|active=no|"));
  expect(changed.servers).toHaveLength(1); expect(changed.servers[0].alias).toBe("b");
  await flush();
  expect(probe).toHaveBeenCalledTimes(1);
});
