import React from "react";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { firefighterAlerts, firefighterPrompt } from "@/lib/monitoring/firefighter";
import type { ServerRow } from "@/lib/monitoring/types";
import { dispatchFirefighter } from "@/features/office/operations/dispatchFirefighter";
import { ServerDashboard } from "@/features/ring-ship/ServerDashboard";
const { CodexOfficeStore } = createRequire(import.meta.url)("../../server/codex-office-store.js");
const directories: string[] = [];
afterEach(() => { cleanup(); vi.unstubAllGlobals(); directories.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })); });
const row = (patch: Partial<ServerRow> = {}): ServerRow => ({
  alias: "test-host", group: "online", active: true, status: "ready", sampledAt: Date.now(), checkedAt: Date.now(), error: null,
  metrics: { cores: 16, cpuPercent: 90, load1: 18, memoryTotal: 100, memoryUsed: 96, disks: [{ mount: "/data", percent: 93, total: 1000, used: 930 }], rxBytesPerSecond: 0, txBytesPerSecond: 0, uptimeSeconds: 10 }, ...patch,
});
const fixture = () => {
  const directory = mkdtempSync(path.join(tmpdir(), "office-firefighter-")); directories.push(directory);
  const client = { ready: true, call: vi.fn() }, store = new CodexOfficeStore(directory, client);
  return { directory, client, store };
};

it("offers rescue at the existing red boundary and excludes stale, disabled and unreachable samples", () => {
  const hot = row(); expect(firefighterAlerts(hot).map(a => a.metric)).toEqual(["cpu", "memory", "disk"]);
  expect(firefighterAlerts(row({ metrics: { ...hot.metrics!, cpuPercent: 89.9, memoryUsed: 69, disks: [] } }))).toEqual([]);
  for (const patch of [{ status: "unreachable" as const }, { active: false }, { metrics: null }, { sampledAt: Date.now() - 90_001 }]) expect(firefighterAlerts(row(patch))).toEqual([]);
});

it("builds different CPU, memory and disk missions with the exact host and sampled evidence", () => {
  const alerts = firefighterAlerts(row());
  const [cpu, memory, disk] = alerts.map(firefighterPrompt);
  expect(cpu).toContain('"server":"test-host"'); expect(cpu).toContain('"percent":90'); expect(cpu).toContain("主要进程、容器或服务");
  expect(memory).toContain("OOM"); expect(memory).toContain("泄漏");
  expect(disk).toContain("/data"); expect(disk).toContain("medium risk"); expect(disk).toContain("等待用户反馈"); expect(disk).toContain("不要先删");
  expect(disk).toContain("回滚版本"); expect(disk).toContain("清理后复测");
  expect(firefighterPrompt({ ...alerts[0], group: "local", host: "Local Mac" })).toContain("不要把显示名当成 SSH 地址");
});

it("creates one Open Space firefighter across concurrent clicks and reuses it after restart", async () => {
  const f = fixture();
  const workers = await Promise.all([f.store.firefighter(), f.store.firefighter(), f.store.firefighter()]);
  expect(new Set(workers.map(w => w.threadId)).size).toBe(1);
  expect(f.store.list()).toHaveLength(1); expect(f.store.projects()).toEqual([]);
  expect(f.store.list()[0]).toMatchObject({ name: "firefighter", projectId: null, workspace: realpathSync(path.join(f.directory, "workspaces", "firefighter")) });
  expect(new CodexOfficeStore(f.directory, f.client).list()).toHaveLength(1);
  expect(await new CodexOfficeStore(f.directory, f.client).firefighter()).toEqual({ threadId: workers[0].threadId, created: false });
  expect(f.client.call).not.toHaveBeenCalled();
});

it("ignores project members and archived firefighters but reuses an active unassigned worker by name", async () => {
  const f = fixture();
  const { project } = await f.store.createProject({ name: "Other project", workspace: f.directory, requestId: "project" });
  await f.store.createSession({ name: "firefighter", projectId: project.id, requestId: "project-worker" });
  const first = await f.store.firefighter(); await f.store.archiveSession({ threadId: first.threadId, requestId: "archive" });
  const second = await f.store.firefighter(); expect(second.threadId).not.toBe(first.threadId);
  await f.store.renameSession({ threadId: second.threadId, name: "Firefighter", requestId: "rename" });
  expect(await f.store.firefighter()).toEqual({ threadId: second.threadId, created: false });
  expect(JSON.parse(readFileSync(f.store.file, "utf8")).sessions).toHaveLength(3);
});

it.each([true, false])("dispatches to the resolved worker through the existing send RPC (created=%s)", async created => {
  const call = vi.fn(async (method: string) => method === "session.firefighter" ? { threadId: "worker", created } : { status: "started" });
  const result = await dispatchFirefighter({ call }, firefighterAlerts(row())[2], "click-id");
  expect(result).toEqual({ threadId: "worker", created });
  expect(call).toHaveBeenNthCalledWith(1, "session.firefighter", {});
  expect(call).toHaveBeenNthCalledWith(2, "session.send", { threadId: "worker", message: expect.stringContaining("medium risk"), requestId: "click-id" });
});

it("shows buttons only beside red metrics and does not dispatch until clicked", async () => {
  const hot = row(), cold = row({ alias: "healthy", metrics: { ...hot.metrics!, cpuPercent: 20, memoryUsed: 40, disks: [] } });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ configured: true, refreshing: false, updatedAt: Date.now(), servers: [hot, cold] })));
  let finish!: () => void;
  const onFirefight = vi.fn<(...args: unknown[]) => Promise<void>>(() => new Promise(resolve => { finish = resolve; }));
  render(React.createElement(ServerDashboard, { active: true, onFirefight }));
  const cpu = await screen.findByRole("button", { name: "Firefight test-host: CPU" });
  expect(screen.getAllByRole("button", { name: /^Firefight / })).toHaveLength(3); expect(onFirefight).not.toHaveBeenCalled();
  fireEvent.click(cpu); fireEvent.click(cpu);
  expect(onFirefight).toHaveBeenCalledOnce(); expect(cpu).toBeDisabled();
  expect(onFirefight).toHaveBeenCalledWith(expect.objectContaining({ host: "test-host", metric: "cpu", percent: 90 }), expect.any(String));
  await act(async () => finish()); expect(cpu).toBeEnabled();
});

it("keeps an uncertain dispatch visible and reuses its send identity on an explicit retry", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ configured: true, refreshing: false, servers: [row()] })));
  const onFirefight = vi.fn(async () => { throw new Error("connection lost"); });
  render(React.createElement(ServerDashboard, { active: true, onFirefight }));
  fireEvent.click(await screen.findByRole("button", { name: "Firefight test-host: Disk" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Check the firefighter conversation before retrying.");
  expect(onFirefight).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Firefight test-host: Disk" }));
  await act(async () => {});
  expect(onFirefight).toHaveBeenCalledTimes(2);
  expect(onFirefight.mock.calls[1]).toEqual(onFirefight.mock.calls[0]);
});
