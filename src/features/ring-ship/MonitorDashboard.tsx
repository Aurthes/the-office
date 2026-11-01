"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowUpRight, Check, Monitor, Plus, Settings2, Trash2, X } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import type { MonitorLink } from "@/lib/monitoring/types";
import { openStrategyMonitor, strategyMonitorUrl } from "./strategyMonitor";
import { MonitorIllustration } from "./MonitorIllustration";
import { ServerDashboard } from "./ServerDashboard";
import "./monitor-dashboard.css";

const embedsAccountHistory = (link: MonitorLink) => link.url === "/account-history/";

export function MonitorDashboard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useUiText(), dialog = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<"hub" | "servers" | "configure" | "account-history">("hub");
  const [embedded, setEmbedded] = useState<MonitorLink | null>(null);
  const [links, setLinks] = useState<MonitorLink[]>(() => {
    const url = strategyMonitorUrl();
    return url ? [{ id: "grafana", label: "Grafana", url, visual: "chart" }] : [];
  });
  const [draft, setDraft] = useState<MonitorLink[]>([]), [error, setError] = useState("");
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  useEffect(() => {
    const node = dialog.current;
    if (open && !node?.open) node?.showModal();
    if (!open && node?.open) node.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    fetch("/api/monitoring", { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load monitor links.");
      if (!controller.signal.aborted) { setLinks(body.links); setError(""); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load monitor links."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open]);
  const configure = () => { setDraft(links.map(link => ({ ...link }))); setError(""); setView("configure"); };
  const launch = (link: MonitorLink) => {
    if (embedsAccountHistory(link)) { setEmbedded(link); setView("account-history"); setError(""); return; }
    setError(openStrategyMonitor(link.url, Date.now(), link.id) ? "" : "Allow pop-ups for this site, then try again.");
  };
  const save = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/monitoring", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ links: draft }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save monitor links.");
      setLinks(body.links); setView("hub");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save monitor links."); }
    finally { setSaving(false); }
  };
  const edit = (index: number, patch: Partial<MonitorLink>) => setDraft(current => current.map((link, i) => i === index ? { ...link, ...patch } : link));
  const back = () => { setEmbedded(null); setView("hub"); setError(""); };
  const close = () => { back(); onClose(); };
  if (typeof document === "undefined") return null;
  return createPortal(<dialog ref={dialog} className="monitor-dialog" aria-label={t("Monitor room")} onCancel={event => { event.preventDefault(); close(); }}>
    <div className="monitor-frame" data-view={view}>
      <header className="monitor-header">
        <button className="monitor-icon-button" type="button" aria-label={view === "hub" ? t("Back to ship") : t("Back to monitors")} onClick={() => { if (view === "hub") close(); else back(); }}><ArrowLeft size={18} /></button>
        <div className="monitor-title"><span><Monitor size={14} />{t("MONITOR ROOM")}</span><h1>{view === "account-history" ? embedded?.label : view === "servers" ? t("Fleet status") : view === "configure" ? t("Configure monitors") : t("Operations console")}</h1></div>
        <span className="monitor-header-detail">{t("SHIP SYSTEMS")}</span>
        {view === "hub" ? <button className="monitor-action" type="button" onClick={configure} disabled={loading}><Settings2 size={15} /><span>{t("Configure")}</span></button> : null}
        <button className="monitor-icon-button" type="button" onClick={close} aria-label={t("Close monitoring dashboard")}><X size={19} /></button>
      </header>
      <div className="monitor-content">
        {view !== "servers" && error ? <p role="alert" className="monitor-error">{t(error)}</p> : null}
        {view === "hub" ? <>
          <div className="monitor-intro"><div><h2>{t("Choose a monitor")}</h2><p>{t("Open a dashboard from the ship’s control screen.")}</p></div><small>{t("Illustrated shortcuts")}</small></div>
          <div className="monitor-tiles">
            {links.map(link => <button key={link.id} type="button" className="monitor-tile" onClick={() => launch(link)} aria-label={t("Open monitor: {name}", { name: link.label })}>
              <div className="monitor-tile-graphic" data-visual={link.visual}><div className="monitor-window-bar"><i /><i /><i /><span>{link.id === "grafana" ? t("Strategy performance") : t("Dashboard")}</span><small>{t("Illustration")}</small></div><MonitorIllustration visual={link.visual} /></div>
              <div className="monitor-tile-caption"><div><h3>{link.label}</h3><p>{t(embedsAccountHistory(link) ? "Opens inside this console" : "Opens in a reusable browser tab")}</p></div>{embedsAccountHistory(link) ? <Monitor size={21} /> : <ArrowUpRight size={21} />}</div>
            </button>)}
            <button type="button" className="monitor-tile monitor-server-tile" onClick={() => { setError(""); setView("servers"); }} aria-label={t("Open server fleet status")}>
              <div className="monitor-tile-graphic" data-visual="servers"><div className="monitor-window-bar"><i /><i /><i /><span>{t("INFRASTRUCTURE")}</span><small>{t("Illustration")}</small></div><MonitorIllustration visual="servers" /></div>
              <div className="monitor-tile-caption"><div><h3>{t("Server fleet")}</h3><p>{t("CPU · Memory · Disks · Local & remote hosts")}</p></div><ArrowUpRight size={21} /></div>
            </button>
            <button className="monitor-add-tile" type="button" onClick={configure} disabled={loading}><Plus size={22} /><span>{t("Add a monitor")}</span><small>{t("Connect another dashboard")}</small></button>
          </div>
          <p className="monitor-footnote">{t("The illustrations are shortcuts. Live data appears in the dashboards you open.")}</p>
        </> : null}
        <div hidden={view !== "servers"}><ServerDashboard active={open && view === "servers"} /></div>
        {open && view === "account-history" && embedded ? <iframe className="monitor-embedded-frame" src={embedded.url} title={embedded.label} referrerPolicy="same-origin" onLoad={event => {
          try {
            event.currentTarget.contentWindow?.addEventListener("keydown", key => {
              if (key.key === "Escape" && !key.defaultPrevented) { key.preventDefault(); close(); }
            });
          } catch { /* A browser-blocked frame must leave the console's back/close controls usable. */ }
        }} /> : null}
        {view === "configure" ? <form className="monitor-config" onSubmit={event => { event.preventDefault(); void save(); }}>
          <div className="monitor-intro"><div><h2>{t("Your dashboard shortcuts")}</h2><p>{t("Names, links, and illustrations are shared across your devices.")}</p></div></div>
          <div className="monitor-config-system"><Monitor size={18} /><div><b>{t("Server fleet")}</b><p>{t("Built-in · Local machine and registered servers")}</p></div></div>
          {draft.map((link, index) => <fieldset className="monitor-config-link" key={link.id} disabled={saving}>
            <label>{t("Monitor name")}<input required maxLength={60} value={link.label} onChange={event => edit(index, { label: event.target.value })} /></label>
            <label className="monitor-config-url">{t("Dashboard URL")}<input required type="text" inputMode="url" maxLength={4096} value={link.url} placeholder="https://… or /dashboard/" onChange={event => edit(index, { url: event.target.value })} /></label>
            <label>{t("Illustration")}<select value={link.visual} onChange={event => edit(index, { visual: event.target.value as MonitorLink["visual"] })}><option value="chart">{t("Time series")}</option><option value="servers">{t("Server racks")}</option><option value="globe">{t("Network globe")}</option></select></label>
            <button type="button" className="monitor-icon-button" aria-label={t("Remove monitor: {name}", { name: link.label })} onClick={() => setDraft(current => current.filter(item => item.id !== link.id))}><Trash2 size={16} /></button>
          </fieldset>)}
          <div className="monitor-config-footer"><button className="monitor-action" type="button" disabled={draft.length >= 8 || saving} onClick={() => setDraft(current => [...current, { id: crypto.randomUUID(), label: "", url: "", visual: "chart" }])}><Plus size={15} />{t("Add a monitor")}</button><button type="submit" className="monitor-primary" disabled={saving}><Check size={16} />{saving ? t("Saving…") : t("Save monitors")}</button></div>
        </form> : null}
      </div>
      <footer className="monitor-frame-footer"><span>{t("MONITOR ROOM")}</span><span>{view === "servers" ? t("HOST RESOURCE OVERVIEW") : view === "account-history" ? t("Dashboard") : t("DASHBOARD LAUNCHER")}</span><span>{t("ESC TO RETURN")}</span></footer>
    </div>
  </dialog>, document.body);
}
