import { TerminalSquare } from "lucide-react";
import type { ServerRow } from "@/lib/monitoring/types";
import { serverFamily } from "@/lib/monitoring/families";
import { useUiText } from "@/lib/i18n/ui-language";
import { formatBytes } from "./ServerDashboard";

export function ServerRackInfo({ row, onTerminal }: { row?: ServerRow; onTerminal: (alias: string) => void }) {
  const t = useUiText();
  if (!row) return <p>{t("Server registration is no longer available.")}</p>;
  const m = row.metrics, family = serverFamily(row);
  const disk = m?.disks.reduce<typeof m.disks[number] | undefined>((best, value) => !best || value.percent > best.percent ? value : best, undefined);
  const metrics = [
    { label: "CPU", percent: m?.cpuPercent ?? null, detail: m ? `${m.cores} ${t("cores")}` : "—" },
    { label: t("Memory"), percent: m?.memoryTotal && m.memoryUsed !== null ? m.memoryUsed / m.memoryTotal * 100 : null, detail: m ? `${formatBytes(m.memoryUsed)} / ${formatBytes(m.memoryTotal)}` : "—" },
    { label: t("Disk"), percent: disk?.percent ?? null, detail: disk?.mount || "—" },
  ];
  return <div className="server-rack-info">
    <div className="mt-2 flex items-center justify-between gap-2 text-[10px]"><span style={{ color: family.color }}>{t(family.label)}</span><span>{t({ ready: "Reachable", pending: "Sampling", unreachable: "Unreachable", disabled: "Registration disabled" }[row.status])}</span></div>
    <p className="text-[10px] text-white/60">{t(row.group === "online" ? "Production servers" : row.group === "offline" ? "Research and compute servers" : "Local machine")}{m?.uptimeSeconds != null ? ` · ${t("Uptime")} ${Math.floor(m.uptimeSeconds / 3600)}h` : ""}</p>
    <button type="button" disabled={!row.active} onClick={() => onTerminal(row.alias)} className="mt-3 flex min-h-10 items-center gap-2 rounded border border-blue-200/40 px-3 text-xs text-blue-100 disabled:opacity-40"><TerminalSquare size={14} />{t("Terminal")}</button>
    {metrics.map(metric => <div key={metric.label} className="mt-2 text-[10px]" data-resource={metric.label}><div className="flex justify-between gap-2"><span>{metric.label}</span><span>{metric.percent === null ? "—" : `${metric.percent.toFixed(1)}%`}</span></div><div className="my-1 h-1 overflow-hidden rounded bg-white/10"><div className="h-full rounded" style={{ width: `${Math.max(0, Math.min(100, metric.percent ?? 0))}%`, background: metric.percent !== null && metric.percent >= 90 ? "#e99e9e" : metric.percent !== null && metric.percent >= 70 ? "#e6b77e" : family.color }} /></div><small className="text-white/45">{metric.detail}</small></div>)}
    <p className="mt-2 text-[9px] text-white/45">{row.sampledAt ? `${t("Sampled")} · ${new Date(row.sampledAt).toLocaleTimeString()}` : t("Sampling registered servers…")}{row.status !== "ready" && m ? ` · ${t("Stale sample")}` : ""}</p>
    {row.error ? <p className="text-[10px] text-amber-200">{t(row.error)}</p> : null}
  </div>;
}
