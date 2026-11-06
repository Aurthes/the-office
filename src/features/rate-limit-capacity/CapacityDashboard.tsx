"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import { CAPACITY_REFRESH_MS, capacityDisplay, type CapacityRow, type CapacitySnapshot, type CapacityState } from "@/lib/rate-limit-capacity/model";
import "./capacity.css";

const stamp = (value: number | null) => value ? new Date(value).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "—";

function CapacityCell({ row, now, failed }: { row?: CapacityRow; now: number; failed: boolean }) {
  const t = useUiText();
  if (!row) return <span className="capacity-unmonitored">{t("Capacity not monitored")}</span>;
  const d = capacityDisplay(row, now, failed), e = d.evidence;
  const label = (state: CapacityState | "stale") => t(state === "normal" ? "Normal capacity" : state === "low" ? "Low capacity" : state === "stale" ? "Capacity data expired" : "Capacity unknown");
  return <div className="capacity-cell" data-state={d.state}>
    <strong className="capacity-badge">{label(d.state)}</strong>
    {d.state === "stale" && d.lastState !== "unknown" ? <span>{t("Last confirmed: {state}", { state: label(d.lastState) })}</span> : null}
    <span>{t("Capacity evidence")}: <time dateTime={e?.evidenceAt ? new Date(e.evidenceAt).toISOString() : undefined}>{stamp(e?.evidenceAt ?? null)}</time></span>
    <span>{t("Heartbeat received")}: {stamp(e?.heartbeatAt ?? null)}</span>
    {d.reason ? <small>{t(d.reason === "read" ? "Capacity read failed" : d.reason === "heartbeat" ? "Heartbeat is missing or expired" : d.reason === "evidence" ? "Capacity evidence is missing or expired" : "Strategy has not confirmed its capacity")}</small> : null}
    {e?.limit ? <details><summary>{t("Capacity details")}</summary>
      <p>{t("Reported limit")}: {e.limit}</p>
      <p>{t("Normal baseline")}: {e.normalLimit ?? "—"} / {e.normalWindowMs ? `${e.normalWindowMs / 1000}s` : "—"}</p>
      <p>{t("Reported recovery wait")}: {e.waitMs === null ? "—" : `${e.waitMs / 1000}s`}</p>
      <p>{e.strategy}</p>
    </details> : null}
  </div>;
}

export function CapacityDashboard() {
  const t = useUiText();
  const [sample, setSample] = useState<{ data: CapacitySnapshot; receivedAt: number } | null>(null);
  const [clock, setClock] = useState(0), [failed, setFailed] = useState(false), [loading, setLoading] = useState(true);
  const refresh = useRef<() => void>(() => undefined);
  useEffect(() => {
    let stopped = false, busy = false, controller: AbortController | null = null;
    const load = async () => {
      if (stopped || busy || document.hidden) return;
      busy = true; setLoading(true); controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 10_000);
      try {
        const response = await fetch("/api/monitoring/rate-limit-capacity", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json() as CapacitySnapshot;
        if (!Number.isFinite(data.serverTime) || typeof data.configured !== "boolean" || !Array.isArray(data.rows)) throw new Error();
        if (!stopped) { const receivedAt = performance.now(); setSample({ data, receivedAt }); setClock(receivedAt); setFailed(false); }
      } catch { if (!stopped) setFailed(true); }
      finally { clearTimeout(timeout); busy = false; if (!stopped) setLoading(false); }
    };
    refresh.current = () => { void load(); };
    const visible = () => { setClock(performance.now()); if (document.hidden) controller?.abort(); else void load(); };
    const poll = setInterval(() => { void load(); }, CAPACITY_REFRESH_MS);
    // Re-evaluate age even if a fetch hangs. A green badge cannot freeze on screen.
    const age = setInterval(() => setClock(performance.now()), 1000);
    document.addEventListener("visibilitychange", visible);
    void load();
    return () => { stopped = true; controller?.abort(); clearInterval(poll); clearInterval(age); document.removeEventListener("visibilitychange", visible); refresh.current = () => undefined; };
  }, []);
  const now = sample ? sample.data.serverTime + Math.max(0, clock - sample.receivedAt) : 0;
  const accounts = new Map<string, { exchange: string; account: string; spot?: CapacityRow; perp?: CapacityRow }>();
  for (const row of sample?.data.rows || []) {
    const key = JSON.stringify([row.exchange, row.account]);
    const account = accounts.get(key) || { exchange: row.exchange, account: row.account };
    account[row.market] = row; accounts.set(key, account);
  }
  return <section className="capacity-dashboard" aria-label={t("Account order capacity")}>
    <header><div><p className="capacity-eyebrow">{t("MONITOR ROOM")}</p><h2>{t("Account order capacity")}</h2>
      <p>{t("Spot and Perp are evaluated separately. Data older than 30 seconds is unverified.")}</p></div>
      <button type="button" onClick={() => refresh.current()} disabled={loading} aria-label={t("Refresh capacity status")}><RefreshCw size={15} />{t("Refresh capacity status")}</button>
    </header>
    {failed || (sample?.data.sourceErrors ?? 0) > 0 ? <p className="capacity-notice" role="alert">{t("Capacity data could not be read. Previous values are unverified.")}</p> : null}
    {!sample && loading ? <p role="status">{t("Loading capacity status…")}</p> : null}
    {sample && !sample.data.configured ? <p className="capacity-notice">{t("Capacity source has not been configured.")}</p> : null}
    <table><thead><tr><th scope="col">{t("Account")}</th><th scope="col">Spot</th><th scope="col">Perp</th></tr></thead>
      <tbody>{[...accounts.entries()].map(([key, account]) => <tr key={key}><th scope="row"><strong>{account.account}</strong><small>{account.exchange}</small></th>
        <td><CapacityCell row={account.spot} now={now} failed={failed} /></td><td><CapacityCell row={account.perp} now={now} failed={failed} /></td></tr>)}</tbody>
    </table>
    {sample?.data.configured && !accounts.size ? <p>{t("No account capacity data has been reported.")}</p> : null}
    <footer>{t("Read-only · Refreshes every 5 seconds while visible · Capacity restriction is separate from process liveness")}</footer>
  </section>;
}
