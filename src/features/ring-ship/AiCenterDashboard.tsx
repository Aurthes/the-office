"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowUpRight, BrainCircuit, CalendarClock, Cpu, KeyRound, RefreshCw, X } from "lucide-react";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { useUiText } from "@/lib/i18n/ui-language";
import type { AiCenterSnapshot, QuotaWindow } from "./ai-center";
import "./ai-center.css";

const formatNumber = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat().format(value);

function UsageWindow({ value }: { value: QuotaWindow | null }) {
  const t = useUiText();
  if (!value) return <p className="ai-unavailable">{t("Usage window not provided")}</p>;
  const minutes = value.windowDurationMins;
  const label = minutes == null ? t("Usage window") : minutes % 1440 === 0 ? t("{count}-day window", { count: minutes / 1440 })
    : minutes % 60 === 0 ? t("{count}-hour window", { count: minutes / 60 }) : t("{count}-minute window", { count: minutes });
  const used = Math.round(value.usedPercent * 10) / 10;
  return <div className="ai-usage-window">
    <div className="ai-usage-heading"><b>{label}</b><span><strong>{used}%</strong> {t("used")}</span></div>
    <div className="ai-meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, used)} aria-valuetext={`${used}% ${t("used")}`}>
      <i style={{ width: `${Math.min(100, used)}%` }} data-high={used >= 90} />
    </div>
    <div className="ai-usage-detail"><span>{t("{percent}% remaining", { percent: Math.max(0, Math.round((100 - value.usedPercent) * 10) / 10) })}</span>
      <span><CalendarClock size={12} />{value.resetsAt ? t("Resets {time}", { time: new Date(value.resetsAt * 1000).toLocaleString() }) : t("Reset time not provided")}</span></div>
  </div>;
}

export function AiCenterDashboard({ open, onClose, client, connected }: {
  open: boolean; onClose: () => void; client?: Pick<GatewayClient, "call">; connected: boolean;
}) {
  const t = useUiText(), dialog = useRef<HTMLDialogElement>(null);
  const [snapshot, setSnapshot] = useState<AiCenterSnapshot | null>(null), [loading, setLoading] = useState(false);
  const [providerId, setProviderId] = useState("");
  const [error, setError] = useState(false), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const node = dialog.current;
    if (open && !node?.open) node?.showModal();
    if (!open && node?.open) node.close();
  }, [open]);
  useEffect(() => {
    setSnapshot(null); setError(false);
    if (!open || !client || !connected) { setLoading(false); return; }
    let stopped = false, pending = false;
    const load = async () => {
      if (pending) return;
      pending = true; setLoading(true);
      try {
        const result = await client.call<AiCenterSnapshot>("office.usage", {});
        if (!Array.isArray(result?.providers)) throw new Error("Usage unavailable");
        if (!stopped) { setSnapshot(result); setError(false); }
      } catch { if (!stopped) setError(true); }
      finally { pending = false; if (!stopped) setLoading(false); }
    };
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [open, client, connected, refresh]);
  const data = snapshot?.providers.find(provider => provider.id === providerId) || snapshot?.providers[0];
  const plan = data?.account?.plan || data?.limits?.find(bucket => bucket.plan)?.plan;
  const daily = data?.usage?.daily, peak = Math.max(1, ...(daily?.map(day => day.tokens) || []));
  const available = !!data && !error && !!(data.account || data.limits || data.usage || data.api.status === "available");
  const credit = data?.limits?.find(bucket => bucket.credits)?.credits;
  if (typeof document === "undefined") return null;
  return createPortal(<dialog ref={dialog} className="ai-dialog" aria-labelledby="ai-center-title"
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="ai-frame" aria-busy={loading}>
      <header className="ai-header">
        <button type="button" className="ai-icon-button" aria-label={t("Back to ship")} onClick={onClose}><ArrowLeft size={18} /></button>
        <span className="ai-header-title"><BrainCircuit size={17} />{t("AI CENTER")}</span>
        <span className="ai-connection" data-available={available}><i />{loading ? t("Refreshing…") : error ? t("Could not refresh") : available ? t("Connected account") : t("No usage data")}</span>
        <button type="button" className="ai-icon-button" disabled={loading || !connected || !client} aria-label={t("Refresh AI usage")} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} className={loading ? "ai-spinning" : ""} /></button>
        <button type="button" className="ai-icon-button" aria-label={t("Close AI Center")} onClick={onClose}><X size={19} /></button>
      </header>
      <div className="ai-content">
        <div className="ai-hero">
          <div><div className="ai-provider-picker"><span className="ai-eyebrow">{t("COMPUTATION CORE")}</span>{snapshot?.providers.length ? snapshot.providers.length > 1 ? <select aria-label={t("AI provider")} value={data?.id} onChange={event => setProviderId(event.target.value)}>{snapshot.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select> : <span className="ai-provider-name">{data?.name}</span> : null}</div><h1 id="ai-center-title">{t("Your AI, at a glance.")}</h1><p>{t("Subscriptions, tokens, and API capacity.")}</p></div>
          <div className="ai-core-art" aria-hidden="true"><div className="ai-art-orbit" /><div className="ai-art-orbit ai-art-orbit-two" /><div className="ai-art-crystal"><Cpu size={34} strokeWidth={1} /></div><div className="ai-art-plinth" /></div>
        </div>
        {!client || !connected ? <p className="ai-notice" role="status">{t("Connect your AI gateway to view usage.")}</p> : null}
        {error ? <p className="ai-notice" role="alert">{t("Usage could not be refreshed. Try again or check the provider dashboard.")}</p> : null}
        <div className="ai-stats">
          <div><span>{t("Subscription plan")}</span><strong className="ai-plan">{plan?.replaceAll("_", " ") || "—"}</strong><small>{t(data?.accountLabel || "Provider account")}</small></div>
          <div><span>{t("Account tokens")}</span><strong>{formatNumber(data?.usage?.lifetimeTokens)}</strong><small>{t("Lifetime usage reported by provider")}</small></div>
          <div><span>{t("Additional credits")}</span><strong>{credit?.unlimited ? t("Unlimited") : credit?.balance ?? "—"}</strong><small>{t("Provider-reported balance")}</small></div>
        </div>
        <div className="ai-panels">
          <section className="ai-card ai-subscription">
            <div className="ai-card-heading"><span><BrainCircuit size={17} />{t("Subscription limits")}</span><small>{data?.name || "—"}</small></div>
            <p className="ai-card-caption">{t("Usage and reset times for the selected account.")}</p>
            {data?.limits?.length ? data.limits.map(bucket => <div className="ai-bucket" key={bucket.id}>
              <h3>{bucket.name}</h3>{bucket.windows.length ? bucket.windows.map((window, index) => <UsageWindow key={index} value={window} />) : <UsageWindow value={null} />}
            </div>) : <p className="ai-unavailable">{loading ? t("Loading usage…") : t("Subscription limits are not available for this account.")}</p>}
            <p className="ai-card-note">{t("Token usage and subscription limits use different units.")}</p>
          </section>
          <section className="ai-card">
            <div className="ai-card-heading"><span><Cpu size={17} />{t("Token activity")}</span><small>{t("ACCOUNT")}</small></div>
            <p className="ai-card-caption">{t("Across the selected provider account")}</p>
            <div className="ai-token-peak"><span>{t("Peak daily tokens")}</span><strong>{formatNumber(data?.usage?.peakDailyTokens)}</strong></div>
            {daily?.length ? <>
              <div className="ai-token-chart" aria-label={t("Recent daily token usage")}>{daily.map(day => <div key={day.date} title={`${day.date}: ${formatNumber(day.tokens)}`}>
                <span className="sr-only">{day.date}: {formatNumber(day.tokens)}</span><i style={{ height: `${day.tokens / peak * 100}%` }} />
              </div>)}</div>
              <div className="ai-chart-dates"><span>{daily[0].date}</span><span>{daily[daily.length - 1].date}</span></div>
            </> : <p className="ai-unavailable">{loading ? t("Loading usage…") : t("Daily token history is not available.")}</p>}
          </section>
        </div>
        <section className="ai-card ai-api-card">
          <div className="ai-card-heading"><span><KeyRound size={17} />{t("API quota")}</span>{data?.links.limits ? <a href={data.links.limits} target="_blank" rel="noreferrer">{t("{provider} limits", { provider: data.name })}<ArrowUpRight size={14} /></a> : null}</div>
          <p className="ai-card-caption">{t("API rate limits are separate from subscription limits.")}</p>
          {data?.api.status === "available" ? data.api.models.length ? <div className="ai-table-scroll"><table>
            <thead><tr><th>{t("Model")}</th><th>{t("Requests / min")}</th><th>{t("Tokens / min")}</th><th>{t("Requests / day")}</th></tr></thead>
            <tbody>{data.api.models.map((model, index) => <tr key={`${model.model}:${index}`}><td>{model.model}</td><td>{formatNumber(model.rpm)}</td><td>{formatNumber(model.tpm)}</td><td>{formatNumber(model.rpd)}</td></tr>)}</tbody>
          </table></div> : <p className="ai-unavailable">{t("No model quotas were returned for this API project.")}</p>
            : <div className="ai-api-empty"><KeyRound size={24} /><div><b>{loading ? t("Loading usage…") : data?.api.status === "not_configured" ? t("API quota is not connected") : t("API quota is temporarily unavailable")}</b><p>{t("Your administrator can connect API project quotas. You can also check the provider website.")}</p></div></div>}
          <div className="ai-api-links">{data?.links.usage ? <a href={data.links.usage} target="_blank" rel="noreferrer">{t("API usage & billing")}<ArrowUpRight size={13} /></a> : null}<span>{t("Unavailable values appear as —.")}</span></div>
        </section>
      </div>
      <footer className="ai-footer"><span>{t("AI CENTER")} / {t("RESOURCE TELEMETRY")}</span><span>{snapshot ? t("Updated {time}", { time: new Date(snapshot.fetchedAt).toLocaleTimeString() }) : t("Waiting for usage data")}</span><span>{t("ESC TO RETURN")}</span></footer>
    </div>
  </dialog>, document.body);
}
