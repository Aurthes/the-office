import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MonitorDashboard } from "@/features/ring-ship/MonitorDashboard";
import { formatBytes, ServerDashboard } from "@/features/ring-ship/ServerDashboard";

const links = [{ id: "grafana", label: "Grafana", url: "https://grafana.example.com/d/a", visual: "chart" }];
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => Response.json({ links: options?.method === "PUT" ? JSON.parse(options.body).links : links })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("opens a console first, launches Grafana only on its card click, and shows the built-in server entry", async () => {
  const tab = { closed: false, focus: vi.fn(), location: { href: "" } };
  const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  const close = vi.fn();
  render(createElement(MonitorDashboard, { open: true, onClose: close }));
  await screen.findByRole("button", { name: "Open monitor: Grafana" });
  expect(open).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Open server fleet status" })).toBeInTheDocument();
  expect(document.querySelectorAll(".monitor-tile svg.monitor-illustration")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Open monitor: Grafana" }));
  expect(tab.location.href).toBe(links[0].url);
  fireEvent.click(screen.getByRole("button", { name: "Close monitoring dashboard" }));
  expect(close).toHaveBeenCalledOnce();
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/servers"))).toBe(false);
});

it("saves configured labels and links without translating user names", async () => {
  render(createElement(MonitorDashboard, { open: true, onClose: vi.fn() }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Configure" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Configure" }));
  fireEvent.change(screen.getByLabelText("Monitor name"), { target: { value: "My custom metrics" } });
  fireEvent.change(screen.getByLabelText("Dashboard URL"), { target: { value: "https://metrics.example.com/d/new" } });
  fireEvent.click(screen.getByRole("button", { name: "Save monitors" }));
  expect(await screen.findByRole("button", { name: "Open monitor: My custom metrics" })).toBeInTheDocument();
  const save = vi.mocked(fetch).mock.calls.find(([, options]) => options?.method === "PUT");
  expect(JSON.parse(String(save?.[1]?.body)).links[0]).toMatchObject({ label: "My custom metrics", url: "https://metrics.example.com/d/new" });
});

it("keeps unknown resource values distinct from genuine zero usage", () => {
  expect(formatBytes(null)).toBe("—");
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(1024 ** 3)).toBe("1.0 GiB");
  expect(formatBytes(1024 ** 4)).toBe("1.0 TiB");
});

it("shows Local Mac and newly registered compute hosts in separate groups with shared totals", async () => {
  const metrics = { cores: 8, cpuPercent: 25, memoryTotal: 16 * 1024 ** 3, memoryUsed: 8 * 1024 ** 3, disks: [], rxBytesPerSecond: 0, txBytesPerSecond: 0 };
  vi.mocked(fetch).mockResolvedValue(Response.json({ configured: true, refreshing: false, updatedAt: 1, servers: [
    { alias: "Local Mac", group: "local", active: true, status: "ready", metrics, sampledAt: 1 },
    { alias: "compute-new", group: "offline", active: true, status: "ready", metrics, sampledAt: 1 },
  ] }));
  render(createElement(ServerDashboard, { active: true }));
  expect(within(await screen.findByRole("region", { name: "Local machine" })).getByText("Local Mac")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Research and compute servers" })).getByText("compute-new")).toBeInTheDocument();
  expect(screen.getByText("2 / 2")).toBeInTheDocument();
  expect(screen.getByText("4.0 / 16")).toBeInTheDocument();
});

it("stops fleet requests when closed or hidden and resumes when visible", async () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.mocked(fetch).mockResolvedValue(Response.json({ configured: true, refreshing: false, servers: [], updatedAt: 1 }));
  const view = render(createElement(ServerDashboard, { active: true }));
  await act(async () => undefined);
  expect(fetch).toHaveBeenCalledTimes(1);
  view.rerender(createElement(ServerDashboard, { active: false }));
  await act(() => vi.advanceTimersByTimeAsync(35_000));
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.mocked(fetch).mockResolvedValue(Response.json({ configured: true, refreshing: false, servers: [], updatedAt: 2 }));
  view.rerender(createElement(ServerDashboard, { active: true }));
  await act(async () => undefined);
  expect(fetch).toHaveBeenCalledTimes(2);
  hidden.mockReturnValue(true);
  fireEvent(document, new Event("visibilitychange"));
  await act(() => vi.advanceTimersByTimeAsync(35_000));
  expect(fetch).toHaveBeenCalledTimes(2);
  vi.mocked(fetch).mockResolvedValue(Response.json({ configured: true, refreshing: false, servers: [], updatedAt: 3 }));
  hidden.mockReturnValue(false);
  await act(async () => { fireEvent(document, new Event("visibilitychange")); });
  expect(fetch).toHaveBeenCalledTimes(3);
});
