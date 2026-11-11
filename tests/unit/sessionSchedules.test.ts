import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SessionSchedules } from "@/features/office/components/SessionSchedules";
import { SessionWorkspace } from "@/features/office/components/SessionWorkspace";
import type { ScheduledTask } from "@/features/ring-ship/ScheduledTasks";
afterEach(cleanup);
const task = (id: string, threadId = "A", extra = {}): ScheduledTask => ({ id, name: id, threadId, prompt: "Exact instructions\n".repeat(80), intervalMinutes: 5, firstRunAt: 1794400000000, nextRunAt: 1794400000000, enabled: true, sessionName: threadId, targetAvailable: true, runs: [], ...extra });
function fixture() {
  const events = new Set<(event: { event: string }) => void>(), statuses = new Set<(status: "connected" | "connecting" | "disconnected") => void>();
  const client = { call: vi.fn<(method: string, params: unknown) => Promise<unknown>>(async () => ({ tasks: [] })), onEvent: (fn: (event: { event: string }) => void) => { events.add(fn); return () => { events.delete(fn); }; }, onStatus: (fn: (status: "connected" | "connecting" | "disconnected") => void) => { statuses.add(fn); return () => { statuses.delete(fn); }; } };
  const event = () => act(() => events.forEach(fn => fn({ event: "schedules.updated" })));
  const status = (value: "connected" | "disconnected") => act(() => statuses.forEach(fn => fn(value)));
  return { client, events, statuses, event, status };
}
it("filters exact Office thread, reuses actual running/unknown semantics and only exposes read/refresh/details", async () => {
  const f = fixture(); f.client.call.mockResolvedValue({ tasks: [task("Own enabled"), task("Other secret", "B"), task("Own running", "A", { enabled: false, runs: [{ id: "run", status: "running", scheduledAt: 1794300000000, manual: false, error: null, finishedAt: null }] }), task("Own unknown", "A", { enabled: false, runs: [{ id: "unknown", status: "unknown", scheduledAt: 1794300000000, manual: false, error: "Receipt unknown", finishedAt: null }] })] });
  render(React.createElement(SessionSchedules, { client: f.client, threadId: "A", active: true }));
  expect(await screen.findByText("Own enabled")).toBeVisible(); expect(screen.queryByText("Other secret")).toBeNull();
  expect(screen.getByText("Running")).toBeVisible(); expect(screen.getByText("Check conversation", { exact: false })).toBeTruthy();
  expect(screen.getAllByText(/Next run/)).toHaveLength(3); expect(screen.getByText("Receipt unknown")).toBeVisible();
  expect(screen.getAllByText("Task instructions")).toHaveLength(3);
  expect(screen.getAllByRole("button")).toHaveLength(1); expect(f.client.call).toHaveBeenCalledExactlyOnceWith("schedule.list", {});
});
it("keeps failure and disconnect distinct from a successful empty list and ignores late offline replies", async () => {
  const f = fixture(); f.client.call.mockRejectedValueOnce(new Error("Read failed"));
  render(React.createElement(SessionSchedules, { client: f.client, threadId: "A", active: true }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Read failed"); expect(screen.queryByText("No scheduled tasks for this conversation.")).toBeNull();
  let resolve!: (value: unknown) => void; f.client.call.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh scheduled tasks" }));
  await waitFor(() => expect(f.client.call).toHaveBeenCalledTimes(2)); f.status("disconnected");
  await act(async () => resolve({ tasks: [] }));
  expect(screen.getByRole("status")).toHaveTextContent("Connect the Office gateway to view scheduled tasks."); expect(screen.queryByText("No scheduled tasks for this conversation.")).toBeNull();
  f.status("connected"); expect(await screen.findByText("No scheduled tasks for this conversation.")).toBeVisible();
});
it("does not show A's late data after switching thread or accept a disconnected client's late result", async () => {
  const a = fixture(), b = fixture(); let resolveA!: (value: unknown) => void;
  a.client.call.mockImplementationOnce(() => new Promise(r => { resolveA = r; })); b.client.call.mockResolvedValue({ tasks: [task("B only", "B")] });
  const view = render(React.createElement(SessionSchedules, { client: a.client, threadId: "A", active: true }));
  view.rerender(React.createElement(SessionSchedules, { client: b.client, threadId: "B", active: true }));
  expect(await screen.findByText("B only")).toBeVisible(); await act(async () => resolveA({ tasks: [task("Stale A")] }));
  expect(screen.queryByText("Stale A")).toBeNull(); expect(screen.getByText("B only")).toBeVisible();
  expect(a.events.size).toBe(0); expect(a.statuses.size).toBe(0); view.unmount(); expect(b.events.size).toBe(0);
});
it("coalesces update bursts, recovers malformed lists and cancels loads while inactive", async () => {
  const f = fixture(); let resolve!: (value: unknown) => void;
  f.client.call.mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValueOnce({ tasks: [task("Fresh event result")] });
  const view = render(React.createElement(SessionSchedules, { client: f.client, threadId: "A", active: true }));
  f.event(); f.event(); await act(async () => resolve({ tasks: [] }));
  expect(await screen.findByText("Fresh event result")).toBeVisible(); expect(f.client.call).toHaveBeenCalledTimes(2);
  f.client.call.mockResolvedValueOnce({ unrelated: true }); f.event(); expect(await screen.findByRole("alert")).toHaveTextContent("Scheduled tasks are not available");
  view.rerender(React.createElement(SessionSchedules, { client: f.client, threadId: "A", active: false })); const count = f.client.call.mock.calls.length;
  f.event(); expect(f.client.call).toHaveBeenCalledTimes(count); expect(f.events.size).toBe(0);
});
it("adds the view to Workspace keyboard navigation without loading schedules before it is selected", async () => {
  const f = fixture(); f.client.call.mockImplementation(async method => method === "schedule.list" ? { tasks: [task("Workspace own")] } : { path: "", entries: [] });
  render(React.createElement(SessionWorkspace, { client: f.client, threadId: "A", asset: null, assets: [], onSelectAsset: vi.fn(), onClose: vi.fn() }));
  await waitFor(() => expect(f.client.call).toHaveBeenCalledTimes(1));
  const files = screen.getByRole("tab", { name: "Files" }); files.focus(); fireEvent.keyDown(files, { key: "End" });
  const schedule = screen.getByRole("tab", { name: "Schedule Task" }); expect(schedule).toHaveFocus(); expect(schedule).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByText("Workspace own")).toBeVisible();
  fireEvent.keyDown(schedule, { key: "Home" }); expect(screen.getByRole("tab", { name: "Files" })).toHaveFocus();
  expect(f.client.call.mock.calls.map(([method]) => method)).toEqual(["session.workspace.list", "schedule.list"]);
});

it("handles GatewayClient's synchronous initial status without duplicate reads or offline RPC", async () => {
  const online = fixture();
  online.client.onStatus = fn => { fn("connected"); online.statuses.add(fn); return () => { online.statuses.delete(fn); }; };
  const view = render(React.createElement(SessionSchedules, { client: online.client, threadId: "A", active: true }));
  expect(await screen.findByText("No scheduled tasks for this conversation.")).toBeVisible();
  expect(online.client.call).toHaveBeenCalledTimes(1); view.unmount();
  const offline = fixture();
  offline.client.onStatus = fn => { fn("disconnected"); offline.statuses.add(fn); return () => { offline.statuses.delete(fn); }; };
  render(React.createElement(SessionSchedules, { client: offline.client, threadId: "A", active: true }));
  expect(await screen.findByRole("status")).toHaveTextContent("Connect the Office gateway");
  expect(offline.client.call).not.toHaveBeenCalled();
  offline.status("connected");
  expect(await screen.findByText("No scheduled tasks for this conversation.")).toBeVisible();
  expect(offline.client.call).toHaveBeenCalledTimes(1);
});
