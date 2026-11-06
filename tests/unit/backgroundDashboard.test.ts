import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BackgroundProcessDashboard, formatProcessDuration } from "@/features/ring-ship/BackgroundProcessDashboard";
import { ServerRoomDashboard } from "@/features/ring-ship/MonitorDashboard";
import { ServerRackInfo } from "@/features/ring-ship/ServerRackInfo";
const snapshot = { updatedAt: 1700000000000, jobs: [{ id: "sync", name: "Data sync", kind: "launchd", status: "failed", pid: null, elapsedSeconds: null, lastExitCode: 1, progress: { text: "2026-01-01T00 · download · partial", at: 1700000000000 }, logStreams: ["events", "stderr"], error: null }] };
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal"); Reflect.deleteProperty(HTMLDialogElement.prototype, "close"); });
it("shows actual task status and fetches only the selected recent log", async () => {
  const fetcher = vi.fn(async (url: string) => Response.json(url.includes("?") ? { id: "sync", stream: "events", content: "download checkpoint", updatedAt: 1700000000000, available: true, truncated: false } : snapshot)); vi.stubGlobal("fetch", fetcher);
  render(createElement(BackgroundProcessDashboard, { active: true }));
  const job = await screen.findByRole("article", { name: "Data sync" });
  expect(within(job).getByText("Last run failed")).toBeInTheDocument(); expect(within(job).getByText("Last exit code 1")).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(within(job).getByRole("button", { name: "View logs" })); await screen.findByText("download checkpoint");
  expect(fetcher.mock.calls[1][0]).toBe("/api/monitoring/background-processes?id=sync&stream=events");
  fireEvent.click(within(job).getByRole("button", { name: "Error log" })); await act(async () => undefined);
  expect(fetcher.mock.calls[2][0]).toContain("stream=stderr");
  expect(formatProcessDuration(93784)).toBe("1d 2h 3m 4s");
});
it("stops task and log polling when the view is closed or hidden", async () => {
  vi.useFakeTimers(); const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const fetcher = vi.fn(async (url: string) => Response.json(url === "/api/monitoring/background-processes" ? snapshot : {})); vi.stubGlobal("fetch", fetcher);
  const view = render(createElement(BackgroundProcessDashboard, { active: true })); await act(async () => undefined); expect(fetcher).toHaveBeenCalledTimes(1);
  hidden.mockReturnValue(true); await act(() => vi.advanceTimersByTimeAsync(15000)); expect(fetcher).toHaveBeenCalledTimes(1);
  hidden.mockReturnValue(false); await act(async () => { fireEvent(document, new Event("visibilitychange")); }); expect(fetcher).toHaveBeenCalledTimes(2);
  view.rerender(createElement(BackgroundProcessDashboard, { active: false })); await act(() => vi.advanceTimersByTimeAsync(15000)); expect(fetcher).toHaveBeenCalledTimes(2);
});
it("preserves the last task snapshot on a refresh failure and can recover", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(snapshot)).mockRejectedValueOnce(new Error("Offline")).mockImplementation(async () => Response.json(snapshot)); vi.stubGlobal("fetch", fetcher);
  render(createElement(BackgroundProcessDashboard, { active: true })); await screen.findByRole("article", { name: "Data sync" });
  fireEvent.click(screen.getByRole("button", { name: "Refresh background tasks" })); await screen.findByRole("alert"); expect(screen.getByRole("article", { name: "Data sync" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh background tasks" })); await act(async () => undefined); expect(screen.queryByRole("alert")).toBeNull();
});
it("opens the local tasks view from the shared console without fetching remote machines", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  const fetcher = vi.fn(async (url: string) => Response.json(url === "/api/monitoring/background-processes" ? snapshot : {})); vi.stubGlobal("fetch", fetcher);
  render(createElement(ServerRoomDashboard, { open: true, onClose: vi.fn(), initialView: "local" })); await screen.findByRole("article", { name: "Data sync" });
  expect(screen.getByRole("button", { name: "Local machine · Background tasks" })).toHaveAttribute("aria-pressed", "true");
  expect(fetcher.mock.calls.every(([url]) => url === "/api/monitoring/background-processes")).toBe(true);
});
it("places the task shortcut on the local machine's rack card", () => {
  const open = vi.fn();
  render(createElement(ServerRackInfo, { row: { alias: "Office host", group: "local", active: true, status: "ready", metrics: null, sampledAt: null, checkedAt: null, error: null }, onTerminal: vi.fn(), onBackgroundProcesses: open }));
  fireEvent.click(screen.getByRole("button", { name: "Background tasks" })); expect(open).toHaveBeenCalledTimes(1);
});
