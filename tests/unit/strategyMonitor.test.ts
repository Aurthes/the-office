import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules(); });

it("focuses the warm tab without navigation, refreshes after inactivity, and reopens a closed tab", async () => {
  const { openStrategyMonitor, MONITOR_REUSE_MS } = await import("@/features/ring-ship/strategyMonitor");
  const navigate = vi.fn();
  const tab = { closed: false, focus: vi.fn(), opener: window, location: { set href(url: string) { navigate(url); } } };
  const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  const url = "https://grafana.example.com/d/strategy?var-strategyIdx=1&var-strategyIdx=3&refresh=5s";
  expect(openStrategyMonitor(url, 0)).toBe(true);
  expect(tab.opener).toBe(window);
  expect(navigate).toHaveBeenCalledExactlyOnceWith(url);
  openStrategyMonitor(url, MONITOR_REUSE_MS - 1);
  openStrategyMonitor(url, MONITOR_REUSE_MS + 1);
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(1);
  expect(tab.focus).toHaveBeenCalledTimes(3);
  openStrategyMonitor(url, 2 * MONITOR_REUSE_MS + 1);
  expect(navigate).toHaveBeenCalledTimes(2);
  expect(open).toHaveBeenCalledTimes(1);
  tab.closed = true;
  const replacement = { ...tab, closed: false, location: { href: "" } };
  open.mockReturnValue(replacement as unknown as Window);
  openStrategyMonitor(url, 2 * MONITOR_REUSE_MS + 2);
  expect(open).toHaveBeenCalledTimes(2);
  expect(replacement.location.href).toBe(url);
});

it("reloads a changed dashboard URL and reports popup blocking", async () => {
  const { openStrategyMonitor } = await import("@/features/ring-ship/strategyMonitor");
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  expect(openStrategyMonitor("https://grafana.example.com", 0)).toBe(false);
  const tab = { closed: false, focus: vi.fn(), opener: window, location: { href: "" } };
  open.mockReturnValue(tab as unknown as Window);
  expect(openStrategyMonitor("https://grafana.example.com/d/one", 1)).toBe(true);
  openStrategyMonitor("https://grafana.example.com/d/two", 2);
  expect(tab.location.href).toBe("https://grafana.example.com/d/two");
  expect(open).toHaveBeenCalledTimes(2);
});

it("accepts ordinary dashboard URLs and rejects invalid or credential-bearing settings", async () => {
  const { strategyMonitorUrl } = await import("@/features/ring-ship/strategyMonitor");
  for (const value of ["", "not a URL", "javascript:alert(1)", "https://user:secret@grafana.example.com"]) {
    vi.stubEnv("NEXT_PUBLIC_CLAW3D_GRAFANA_URL", value);
    expect(strategyMonitorUrl()).toBeNull();
  }
  const url = "https://grafana.example.com/d/strategy?var-strategyIdx=1&var-strategyIdx=3&refresh=5s";
  vi.stubEnv("NEXT_PUBLIC_CLAW3D_GRAFANA_URL", url);
  expect(strategyMonitorUrl()).toBe(url);
});

it("keeps different monitor links in independent warm tabs", async () => {
  const { openStrategyMonitor } = await import("@/features/ring-ship/strategyMonitor");
  const chart = { closed: false, focus: vi.fn(), location: { href: "" } };
  const other = { closed: false, focus: vi.fn(), location: { href: "" } };
  const open = vi.spyOn(window, "open").mockReturnValueOnce(chart as unknown as Window).mockReturnValueOnce(other as unknown as Window);
  openStrategyMonitor("https://grafana.example.com", 0, "grafana");
  openStrategyMonitor("https://status.example.com", 1, "status");
  openStrategyMonitor("https://grafana.example.com", 2, "grafana");
  expect(open).toHaveBeenCalledTimes(2);
  expect(chart.focus).toHaveBeenCalledTimes(2);
  expect(other.focus).toHaveBeenCalledTimes(1);
  expect(chart.location.href).toBe("https://grafana.example.com");
  expect(other.location.href).toBe("https://status.example.com");
});

it("opens a local dashboard through the current Office origin", async () => {
  const { openStrategyMonitor } = await import("@/features/ring-ship/strategyMonitor");
  const tab = { closed: false, focus: vi.fn(), location: { href: "" } };
  vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  expect(openStrategyMonitor("/account-history/", 0, "account-history")).toBe(true);
  expect(tab.location.href).toBe(window.location.origin + "/account-history/");
});
