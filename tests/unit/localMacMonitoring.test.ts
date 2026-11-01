// @vitest-environment node
import os from "node:os";
import { expect, it } from "vitest";
import { cpuUsage, macDisks, macMemoryUsed, macNetworkCounters } from "@/lib/monitoring/local-mac";
import { probeServer } from "@/lib/monitoring/servers";

it("uses the actual VM page size and excludes reclaimable pages without adding swap", () => {
  const text = "Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 2.\nPages inactive: 3.\nPages speculative: 1.\nPages stored in compressor: 100000.\n";
  expect(macMemoryUsed(text, 10 * 16384)).toBe(4 * 16384);
  expect(macMemoryUsed(text.replace("16384", "4096"), 10 * 4096)).toBe(4 * 4096);
  expect(macMemoryUsed(null, 100)).toBeNull();
  expect(macMemoryUsed("Pages free: 2.", 100)).toBeNull();
});

it("counts each physical interface once, including link rows without an address", () => {
  const text = "Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll\n" + [
    "en0 1500 <Link#7> aa:bb 3 0 100 4 0 200 0",
    "en0 1500 192.0.2 192.0.2.1 3 - 100 4 - 200 -",
    "en0 1500 fe80::1 fe80::1 3 - 100 4 - 200 -",
    "en5 1500 <Link#8> 2 0 50 3 0 70 0",
    "lo0 16384 <Link#1> 2 0 9000 3 0 8000 0",
    "utun6 1380 <Link#23> 2 0 9000 3 0 8000 0",
    "bridge0 1500 <Link#16> aa:bb 2 0 9000 3 0 8000 0",
  ].join("\n");
  expect([...macNetworkCounters(text)!]).toEqual([["en0", [100, 200]], ["en5", [50, 70]]]);
  expect(macNetworkCounters(null)).toBeNull();
  expect(macNetworkCounters("unexpected output")).toBeNull();
});

it("keeps the macOS data volume and mount names with spaces, excluding non-device filesystems", () => {
  const text = "Filesystem 1024-blocks Used Available Capacity Mounted on\n" + [
    "/dev/disk3s1s1 1000 100 50 67% /",
    "/dev/disk3s5 1000 850 50 95% /System/Volumes/Data",
    "/dev/disk4s1 2000 500 1500 25% /Volumes/External Drive",
    "devfs 100 100 0 100% /dev",
  ].join("\n");
  expect(macDisks(text)).toEqual([
    { mount: "/", total: 1024000, used: 102400, percent: 67 },
    { mount: "/System/Volumes/Data", total: 1024000, used: 870400, percent: 95 },
    { mount: "/Volumes/External Drive", total: 2048000, used: 512000, percent: 25 },
  ]);
  expect(macDisks(null)).toEqual([]);
});

it("computes CPU usage from counter deltas across all cores, preserving real idle zero", () => {
  const cpu = (user: number, idle: number) => ({ model: "fixture", speed: 1, times: { user, idle, nice: 0, sys: 0, irq: 0 } });
  expect(cpuUsage([cpu(100, 100), cpu(100, 100)], [cpu(125, 175), cpu(125, 175)])).toBe(25);
  expect(cpuUsage([cpu(100, 100)], [cpu(100, 200)])).toBe(0);
  expect(cpuUsage([cpu(100, 100)], [cpu(100, 100)])).toBeNull();
  expect(cpuUsage([cpu(100, 100)], [cpu(1, 1)])).toBeNull();
});

it.skipIf(os.platform() !== "darwin")("samples this Mac directly without depending on a local SSH server", async () => {
  const result = await probeServer({ alias: "Local Mac", group: "local", active: true });
  expect(result.cores).toBe(os.cpus().length);
  expect(result.cpuPercent).toBeGreaterThanOrEqual(0);
  expect(result.cpuPercent).toBeLessThanOrEqual(100);
  expect(result.memoryTotal).toBe(os.totalmem());
  expect(result.memoryUsed).toBeGreaterThan(0);
  expect(result.memoryUsed).toBeLessThanOrEqual(result.memoryTotal!);
  expect(result.disks.some(disk => disk.mount === "/System/Volumes/Data")).toBe(true);
  expect(result.rxBytesPerSecond).toBeGreaterThanOrEqual(0);
  expect(result.txBytesPerSecond).toBeGreaterThanOrEqual(0);
});
