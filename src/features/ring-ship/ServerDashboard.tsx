"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Cpu, HardDrive, MemoryStick, RefreshCw } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import type { ServerRow, ServerSnapshot } from "@/lib/monitoring/types";

const groups = { local: "Local machine", online: "Production servers", offline: "Research and compute servers" };

export function formatBytes(value: number | null) {
  if (value === null) return "—";
  const power = value > 0 ? Math.min(4, Math.max(0, Math.floor(Math.log(value) / Math.log(1024)))) : 0;
  return `${(value / 1024 ** power).toFixed(power ? 1 : 0)} ${["B", "KiB", "MiB", "GiB", "TiB"][power]}`;
}

function Meter({ percent, text, detail, stale }: { percent: number | null; text: string; detail: string; stale: boolean }) {
  const tone = percent === null ? "unknown" : percent >= 90 ? "hot" : percent >= 70 ? "warm" : "good";
  return <div className={`monitor-meter ${stale ? "stale" : ""}`} data-tone={tone}>
    <div className="monitor-meter-value"><span>{text}</span><b>{percent === null ? "—" : `${percent.toFixed(1)}%`}</b></div>
    <div className="monitor-meter-track"><span style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }} /></div>
    <small>{detail}</small>
  </div>;
}

function HostRow({ row }: { row: ServerRow }) {
  const t = useUiText(), m = row.metrics, stale = row.status !== "ready";
  const disk = m?.disks.reduce<typeof m.disks[number] | undefined>((best, value) => !best || value.percent > best.percent ? value : best, undefined);
  const status = { ready: "Reachable", pending: "Sampling", unreachable: "Unreachable", disabled: "Registration disabled" }[row.status];
  return <div className="monitor-host-row" data-status={row.status}>
    <div className="monitor-host-name"><span className="monitor-host-dot" /><div><b>{row.alias}</b><small title={row.error ? t(row.error) : undefined}>{t(status)}{stale && m ? ` · ${t("Stale sample")}` : ""}</small></div></div>
    <div><span className="monitor-mobile-label">CPU</span><Meter percent={m?.cpuPercent ?? null} text={m && m.cpuPercent !== null ? `${(m.cores * m.cpuPercent / 100).toFixed(1)} / ${m.cores}` : "—"} detail={t("Used / total cores")} stale={stale} /></div>
    <div><span className="monitor-mobile-label">{t("Memory")}</span><Meter percent={m && m.memoryTotal && m.memoryUsed !== null ? m.memoryUsed / m.memoryTotal * 100 : null} text={m ? `${formatBytes(m.memoryUsed)} / ${formatBytes(m.memoryTotal)}` : "—"} detail={t("Used / total RAM")} stale={stale} /></div>
    <div><span className="monitor-mobile-label">{t("Disk")}</span><Meter percent={disk?.percent ?? null} text={disk ? `${formatBytes(disk.used)} / ${formatBytes(disk.total)}` : "—"} detail={disk?.mount ?? t("Local filesystems")} stale={stale} />{m && m.disks.length > 1 ? <details className="monitor-disks"><summary>{t("{count} local filesystems", { count: m.disks.length })}</summary>{m.disks.map(d => <p key={d.mount}>{d.mount} · {formatBytes(d.used)} / {formatBytes(d.total)} · {d.percent}%</p>)}</details> : null}</div>
    <div className="monitor-host-network"><span className="monitor-mobile-label">{t("Network")}</span><span><ArrowDown size={11} />{formatBytes(m?.rxBytesPerSecond ?? null)}/s</span><span><ArrowUp size={11} />{formatBytes(m?.txBytesPerSecond ?? null)}/s</span></div>
    <div className="monitor-host-time" title={row.sampledAt ? new Date(row.sampledAt).toLocaleString() : undefined}>{row.sampledAt ? new Date(row.sampledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</div>
  </div>;
}

export function ServerDashboard({ active }: { active: boolean }) {
  const t = useUiText();
  const [snapshot, setSnapshot] = useState<ServerSnapshot | null>(null), [error, setError] = useState("");
  const [request, setRequest] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>, live = true, running = false;
    const load = async () => {
      if (!live || running) return;
      clearTimeout(timer);
      if (document.hidden) { timer = setTimeout(load, 30_000); return; }
      running = true; let delay = 30_000;
      try {
        const response = await fetch("/api/monitoring/servers", { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load server status.");
        if (live) { setSnapshot(body); setError(""); delay = body.refreshing ? 1500 : 30_000; }
      } catch (cause) { if (live) setError(cause instanceof Error ? cause.message : "Could not load server status."); }
      finally { running = false; if (live) timer = setTimeout(load, delay); }
    };
    void load(); document.addEventListener("visibilitychange", load);
    return () => { live = false; clearTimeout(timer); controller.abort(); document.removeEventListener("visibilitychange", load); };
  }, [active, request]);
  const rows = snapshot?.servers ?? [], reporting = rows.filter(row => row.status === "ready" && row.metrics);
  const cpuReporting = reporting.filter(row => row.metrics!.cpuPercent !== null);
  const memoryReporting = reporting.filter(row => row.metrics!.memoryTotal !== null && row.metrics!.memoryUsed !== null);
  const cores = cpuReporting.reduce((sum, row) => sum + row.metrics!.cores, 0);
  const usedCores = cpuReporting.reduce((sum, row) => sum + row.metrics!.cores * row.metrics!.cpuPercent! / 100, 0);
  const memoryTotal = memoryReporting.reduce((sum, row) => sum + row.metrics!.memoryTotal!, 0), memoryUsed = memoryReporting.reduce((sum, row) => sum + row.metrics!.memoryUsed!, 0);
  return <section className="monitor-fleet" aria-label={t("Server fleet status")}>
    <div className="monitor-fleet-heading"><div><h2>{t("Server fleet")}</h2><p>{t("Read-only host samples · Updates every 30 seconds while visible")}</p></div><button className="monitor-icon-button" type="button" disabled={snapshot?.refreshing} onClick={() => setRequest(n => n + 1)} aria-label={t("Refresh server status")}><RefreshCw size={16} className={snapshot?.refreshing ? "animate-spin" : ""} /></button></div>
    {error ? <p role="alert" className="monitor-error">{t(error)}{snapshot ? ` · ${t("Showing the last received snapshot.")}` : ""}</p> : null}
    {snapshot?.configured === false ? <div className="monitor-empty">{t("Server monitoring has not been connected yet.")}</div> : <>
      <div className="monitor-fleet-totals">
        <div><span>{t("Reporting hosts")}</span><b>{snapshot ? `${reporting.length} / ${rows.filter(row => row.active).length}` : "—"}</b><small>{snapshot?.refreshing ? t("Sampling registered servers…") : t("Reachability is separate from server purpose.")}</small></div>
        <div><span><Cpu size={13} />CPU</span><b>{cpuReporting.length ? `${usedCores.toFixed(1)} / ${cores}` : "—"}</b><small>{t("Used / total cores · reporting hosts")}</small></div>
        <div><span><MemoryStick size={13} />{t("Memory")}</span><b>{memoryReporting.length ? `${formatBytes(memoryUsed)} / ${formatBytes(memoryTotal)}` : "—"}</b><small>{t("Used / total RAM · reporting hosts")}</small></div>
      </div>
      {!snapshot ? <p role="status" className="monitor-empty">{t("Loading registered servers…")}</p> : <>
        <div className="monitor-host-columns" aria-hidden="true"><span>{t("Server")}</span><span>CPU</span><span>{t("Memory")}</span><span><HardDrive size={12} />{t("Most-used local disk")}</span><span>{t("Network")}</span><span>{t("Sampled")}</span></div>
        {Object.entries(groups).filter(([group]) => group !== "local" || rows.some(row => row.group === "local")).map(([group, label]) => <section key={group} className="monitor-host-group" aria-label={t(label)}>
          <h3><span>{t(label)}</span><small>{rows.filter(row => row.group === group && row.active).length} {t("registered")}</small></h3>
          {rows.filter(row => row.group === group && row.active).sort((a, b) => a.alias.localeCompare(b.alias, undefined, { numeric: true })).map(row => <HostRow key={row.alias} row={row} />)}
        </section>)}
        {rows.some(row => !row.active) ? <details className="monitor-disabled"><summary>{t("Disabled registrations")} · {rows.filter(row => !row.active).length}</summary>{rows.filter(row => !row.active).map(row => <HostRow key={row.alias} row={row} />)}</details> : null}
        <p className="monitor-fleet-note">{t("Disk shows the fullest local filesystem. Expand a row to see its other local disks. Network filesystems are excluded.")}</p>
      </>}
    </>}
  </section>;
}
