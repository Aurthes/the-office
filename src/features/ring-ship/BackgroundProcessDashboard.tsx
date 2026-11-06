"use client";

import { useEffect, useState } from "react";
import { Activity, Clock, FileText, RefreshCw } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import type { BackgroundLog, BackgroundProcess, BackgroundSnapshot } from "@/lib/monitoring/types";

const endpoint = "/api/monitoring/background-processes";
export function formatProcessDuration(seconds: number | null) {
  if (seconds === null) return "—";
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds / 3600) % 24, minutes = Math.floor(seconds / 60) % 60;
  return `${days ? `${days}d ` : ""}${hours ? `${hours}h ` : ""}${minutes}m ${Math.floor(seconds) % 60}s`;
}

export function BackgroundProcessDashboard({ active }: { active: boolean }) {
  const t = useUiText();
  const [snapshot, setSnapshot] = useState<BackgroundSnapshot | null>(null), [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false), [request, setRequest] = useState(0);
  const [selection, setSelection] = useState<{ id: string; stream: BackgroundProcess["logStreams"][number] } | null>(null);
  const [log, setLog] = useState<BackgroundLog | null>(null), [logError, setLogError] = useState("");
  const selectedRegistered = Boolean(snapshot?.jobs.some(job => job.id === selection?.id));
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); let live = true, running = false, timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (!live || running) return;
      clearTimeout(timer);
      if (document.hidden) { timer = setTimeout(load, 5000); return; }
      running = true; setRefreshing(true);
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not load background tasks.");
        if (live) { setSnapshot(body); setError(""); }
      } catch (cause) { if (live) setError(cause instanceof Error ? cause.message : "Could not load background tasks."); }
      finally { running = false; if (live) { setRefreshing(false); timer = setTimeout(load, 5000); } }
    };
    void load(); document.addEventListener("visibilitychange", load);
    return () => { live = false; clearTimeout(timer); controller.abort(); document.removeEventListener("visibilitychange", load); };
  }, [active, request]);
  useEffect(() => {
    if (!active || !selection || !selectedRegistered) return;
    const controller = new AbortController(); let live = true, running = false, timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (!live || running) return;
      clearTimeout(timer);
      if (document.hidden) { timer = setTimeout(load, 5000); return; }
      running = true;
      try {
        const response = await fetch(`${endpoint}?${new URLSearchParams(selection)}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not read this task log.");
        if (live) { setLog(body); setLogError(""); }
      } catch (cause) { if (live) setLogError(cause instanceof Error ? cause.message : "Could not read this task log."); }
      finally { running = false; if (live) timer = setTimeout(load, 5000); }
    };
    void load(); document.addEventListener("visibilitychange", load);
    return () => { live = false; clearTimeout(timer); controller.abort(); document.removeEventListener("visibilitychange", load); };
  }, [active, selection, request, selectedRegistered]);
  const jobs = snapshot?.jobs ?? [], selected = jobs.find(job => job.id === selection?.id);
  const choose = (job: BackgroundProcess, stream = job.logStreams[0]) => { setSelection({ id: job.id, stream }); setLog(null); setLogError(""); };
  const status = { running: "Running", stopped: "Not running", failed: "Last run failed", unknown: "Status unavailable" };
  const streamLabel = { events: "Progress log", stdout: "Output log", stderr: "Error log" };
  return <section className="background-dashboard" aria-label={t("Local background tasks")}>
    <div className="monitor-fleet-heading"><div><h2>{t("Local machine")} · {t("Background tasks")}</h2><p>{t("Long-running work on this Office host · Updates every 5 seconds while visible")}</p></div><button type="button" className="monitor-icon-button" disabled={refreshing} onClick={() => setRequest(n => n + 1)} aria-label={t("Refresh background tasks")}><RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /></button></div>
    {error ? <p role="alert" className="monitor-error">{t(error)}{snapshot ? ` · ${t("Showing the last received snapshot.")}` : ""}</p> : null}
    {!snapshot && !error ? <p role="status" className="monitor-empty">{t("Loading background tasks…")}</p> : null}
    {snapshot ? <div className="background-summary"><span><Activity size={14} />{jobs.filter(job => job.status === "running").length} {t("Running")}</span><span data-alert={jobs.some(job => job.status === "failed")}>{jobs.filter(job => job.status === "failed").length} {t("Last run failed")}</span><small>{t("Sampled")} · {new Date(snapshot.updatedAt).toLocaleTimeString()}</small></div> : null}
    {snapshot && !jobs.length ? <div className="monitor-empty">{t("No background tasks registered on this machine yet.")}</div> : null}
    <div className="background-jobs">{jobs.map(job => <article key={job.id} className="background-job" data-status={job.status} aria-label={job.name}>
      <header><div><span className="background-status-dot" /><h3>{job.name}</h3></div><b>{t(status[job.status])}</b></header>
      <div className="background-job-details"><span><Clock size={12} />{t("Running for")} {formatProcessDuration(job.elapsedSeconds)}</span>{job.pid !== null ? <span>PID {job.pid}</span> : null}{job.lastExitCode !== null ? <span>{t("Last exit code")} {job.lastExitCode}</span> : null}</div>
      <div className="background-progress"><small>{t("Latest progress")}</small><p>{job.progress?.text || t("No progress output yet.")}</p>{job.progress?.at ? <time dateTime={new Date(job.progress.at).toISOString()}>{new Date(job.progress.at).toLocaleString()}</time> : null}</div>
      {job.error ? <p className="monitor-error">{t(job.error)}</p> : null}
      {job.logStreams.length ? <button type="button" className="background-log-button" aria-expanded={selection?.id === job.id} onClick={() => { if (selection?.id === job.id) setSelection(null); else choose(job); }}><FileText size={14} />{t(selection?.id === job.id ? "Hide logs" : "View logs")}</button> : <small className="background-no-log">{t("No log source available.")}</small>}
      {selection?.id === job.id ? <div className="background-log-view" aria-label={t("Logs for {name}", { name: job.name })}>
        <div role="group" aria-label={t("Log source")}>{job.logStreams.map(stream => <button key={stream} type="button" aria-pressed={selection.stream === stream} onClick={() => choose(job, stream)}>{t(streamLabel[stream])}</button>)}</div>
        {logError ? <p role="alert" className="monitor-error">{t(logError)}</p> : null}
        {log ? <><pre tabIndex={0}>{log.content || t("No log output yet.")}</pre><small>{t(log.truncated ? "Recent output only; older lines are omitted." : "Recent output")}{log.updatedAt ? ` · ${new Date(log.updatedAt).toLocaleTimeString()}` : ""}</small>{!log.available ? <p>{t("Log file is not available yet.")}</p> : null}</> : !logError ? <p role="status">{t("Loading logs…")}</p> : null}
      </div> : null}
    </article>)}</div>
    {selection && !selected ? <p className="monitor-error">{t("This background task is no longer registered.")}</p> : null}
    <p className="monitor-fleet-note">{t("Not running does not mean completed. The progress time shows when the task last reported an update.")}</p>
  </section>;
}
