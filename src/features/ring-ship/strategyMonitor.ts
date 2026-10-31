// Keep the real browser page alive; no copied charts, proxy, or screenshot cache.
export const MONITOR_REUSE_MS = 5 * 60 * 1000;
const tabs = new Map<string, { tab: Window; url: string; usedAt: number }>();

export function openStrategyMonitor(url: string, now = Date.now(), id = "grafana"): boolean {
  const cached = tabs.get(id);
  if (cached && !cached.tab.closed) {
    if (cached.url !== url || now - cached.usedAt >= MONITOR_REUSE_MS) {
      cached.tab.location.href = url;
    }
    cached.tab.focus();
    cached.url = url;
    cached.usedAt = now;
    return true;
  }
  // Keep the browser's opener relationship: Chrome requires it to activate
  // this cross-origin tab on later clicks without navigating or reloading it.
  const tab = window.open("", id === "grafana" ? "claw3d-strategy-monitor" : `claw3d-monitor-${id}`);
  if (!tab) return false;
  tab.location.href = url;
  tab.focus();
  tabs.set(id, { tab, url, usedAt: now });
  return true;
}

export function strategyMonitorUrl(): string | null {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_CLAW3D_GRAFANA_URL?.trim() || "");
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
