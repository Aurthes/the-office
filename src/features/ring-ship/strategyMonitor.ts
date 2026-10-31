// Keep the real browser page alive; no copied charts, proxy, or screenshot cache.
export const MONITOR_REUSE_MS = 5 * 60 * 1000;
let cached: { tab: Window; url: string; usedAt: number } | undefined;

export function openStrategyMonitor(url: string, now = Date.now()): boolean {
  if (cached && !cached.tab.closed) {
    if (cached.url !== url || now - cached.usedAt >= MONITOR_REUSE_MS) {
      cached.tab.location.href = url;
    }
    cached.tab.focus();
    cached.url = url;
    cached.usedAt = now;
    return true;
  }
  // Remove opener access before navigating away, while retaining our handle
  // so repeat clicks can focus the page without navigating or reloading it.
  const tab = window.open("", "claw3d-strategy-monitor");
  if (!tab) return false;
  try { tab.opener = null; } catch { /* A named tab from an earlier app load already has no opener. */ }
  tab.location.href = url;
  tab.focus();
  cached = { tab, url, usedAt: now };
  return true;
}

export function strategyMonitorUrl(): string | null {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_CLAW3D_GRAFANA_URL?.trim() || "");
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
