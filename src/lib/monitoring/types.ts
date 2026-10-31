export type MonitorLink = { id: string; label: string; url: string; visual: "chart" | "servers" | "globe" };
export type PoolHost = { alias: string; group: "online" | "offline"; active: boolean };
export type DiskMetric = { mount: string; total: number; used: number; percent: number };
export type ServerMetrics = {
  cores: number; cpuPercent: number | null; load1: number | null;
  memoryTotal: number | null; memoryUsed: number | null;
  disks: DiskMetric[]; rxBytesPerSecond: number | null; txBytesPerSecond: number | null;
  uptimeSeconds: number | null;
};
export type ServerRow = PoolHost & {
  status: "pending" | "ready" | "unreachable" | "disabled";
  metrics: ServerMetrics | null; sampledAt: number | null; checkedAt: number | null; error: string | null;
};
export type ServerSnapshot = { configured: boolean; refreshing: boolean; updatedAt: number | null; servers: ServerRow[] };
