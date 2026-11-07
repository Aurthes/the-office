"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import { FILL_REFRESH_MS, fillState, probabilityGap, type FillRow, type FillSnapshot } from "@/lib/fill-probability/model";
import "./fill-probability.css";

const number = (v: number | null) => typeof v === "number" && Number.isFinite(v) ? Number(v.toPrecision(6)).toString() : "N/A";
const signed = (v: number) => `${v > 0 ? "+" : ""}${number(v)}`;
const stamp = (v: number | null) => v && Number.isFinite(v) ? new Date(v).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "N/A";
const sourceNotes: Record<string, string> = {
  "no-exposure": "No weighted exposure has been recorded",
  "cache-not-exported": "This symbol has no feedback snapshot from the running version",
  "invalid-cache": "The feedback snapshot failed schema, identity or value validation",
  "live-identity-unverified": "The running process, configured source and heartbeat could not be matched",
};

function Stages({ row, now, failed }: { row: FillRow; now: number; failed: boolean }) {
  const t = useUiText();
  const state = fillState(row, now, failed);
  const usable = state === "snapshot";
  const status = t(state === "stale" ? "Snapshot expired or read failed" : state === "disabled" ? "Feedback disabled" : state === "empty" ? "No weighted exposure" : state === "unknown" ? "Source or schema unverified" : "Historical snapshot; observation time and sample readiness unknown");
  const stages: { key: string; label: string; value: number | null; unit: "probability" | "multiplier" | "log" | "action"; note: string }[] = [
    { key: "target", label: "Base theoretical target", value: row.target, unit: "probability", note: "Configured probability over a one-second horizon" },
    { key: "base", label: "Base theoretical EMA", value: usable ? row.baseTheoreticalEma : null, unit: "probability", note: "Snapshot-derived from persisted base-model hazard and weighted exposure" },
    { key: "model", label: "C_A-adjusted theoretical EMA", value: usable ? row.theoreticalEma : null, unit: "probability", note: "Historical intervals use their own C_A; this is not base EMA times current C_A" },
    { key: "actual", label: "Actual EMA", value: usable ? row.actualEma : null, unit: "probability", note: "Snapshot-derived from persisted weighted hits and exposure" },
    { key: "ca", label: "C_A · arrival-rate multiplier", value: usable ? row.ca : null, unit: "multiplier", note: "Current applied multiplier; not a probability" },
    { key: "logca", label: "Applied log C_A", value: usable ? row.logCa : null, unit: "log", note: "Applied log multiplier after the existing controller bounds" },
    { key: "ca-probability", label: "After current C_A · instantaneous probability", value: null, unit: "probability", note: "Not exported by this production version" },
    { key: "before-normalize", label: "Before normalization · side target", value: null, unit: "probability", note: "Not exported by this production version" },
    { key: "after-normalize", label: "After normalization", value: null, unit: "probability", note: "Not exported by this production version" },
    { key: "before-guard", label: "Before price guards", value: null, unit: "probability", note: "Not exported by this production version" },
    { key: "guard", label: "Guard action · post-only / P2", value: null, unit: "action", note: "Guard action unknown; not the same as not triggered" },
    { key: "final", label: "After guards · final probability", value: null, unit: "probability", note: "Not exported by this production version" },
  ];
  const clockUnit = row.clock === "exposure_seconds" ? t("exposure seconds") : row.clock === "trials" ? t("trials") : t("Unknown");
  return <article className="fill-record" aria-label={t("Selected probability record")}>
    <div className="fill-record-title"><div><h3>{row.symbol} · {t(row.side === "bid" ? "Buy / bid" : "Sell / ask")}</h3><p>{row.strategy} · {row.account} · {row.exchange} {row.market}</p></div><span className="fill-state" data-state={state}>{status}</span></div>
    <p className="fill-scope">{t("EMA scope: symbol + side, shared across accounts in this strategy instance.")}</p>
    <div className="fill-table-scroll"><table aria-label={t("Fill probability stages")}><thead><tr><th scope="col">{t("Stage")}</th><th scope="col">{t("Value")}</th><th scope="col">{t("Difference from target")}</th><th scope="col">{t("Evidence / explanation")}</th></tr></thead>
      <tbody>{stages.map(stage => {
        const hasValue = typeof stage.value === "number" && Number.isFinite(stage.value);
        // Cache v8/v9 have no sample-readiness evidence. Show the signed distance,
        // but do not present a sparse or old EMA as a trusted red/green signal.
        const gap = stage.unit === "probability" ? probabilityGap(stage.value, row.target, stage.key === "target" && usable) : null;
        return <tr key={stage.key} data-stage={stage.key} data-state={hasValue ? stage.key === "target" && usable ? "reference" : "snapshot" : "unknown"}>
          <th scope="row">{t(stage.label)}</th>
          <td className="fill-value" style={{ color: gap?.color }}><strong>{hasValue ? number(stage.value) : "N/A"}</strong>{hasValue ? <small>{stage.unit === "probability" ? `/ 1s (${number(stage.value! * 100)}%)` : stage.unit === "multiplier" ? "×" : t("log units")}</small> : null}</td>
          <td className="fill-gap" style={{ color: gap?.color }}>{gap ? <><strong>{signed(gap.absolute)}</strong><small>{signed(gap.relative * 100)}%</small></> : "—"}</td>
          <td><span>{t(stage.note)}</span>{stage.key !== "target" && hasValue && stage.unit === "probability" ? <small>{status}</small> : null}</td>
        </tr>;
      })}</tbody></table></div>
    <p className="fill-legend">{t("Green → red: increasing absolute relative distance from target; + is above, − is below. Gray means unavailable or unverified. Color is not a trading guard.")}</p>
    <details className="fill-evidence"><summary>{t("Source, timing and sample evidence")}</summary><dl>
      <div><dt>{t("Source SHA")}</dt><dd className="fill-sha">{row.sourceSha || "N/A"}</dd></div>
      <div><dt>{t("Schema / update axis")}</dt><dd>{row.schema ?? "N/A"} · {clockUnit}</dd></div>
      <div><dt>{t("Instance / PID")}</dt><dd>{row.instance || "N/A"} / {row.pid ?? "N/A"}</dd></div>
      <div><dt>{t("Heartbeat time")}</dt><dd>{stamp(row.heartbeatAt)}</dd></div>
      <div><dt>{t("Snapshot export time")}</dt><dd>{stamp(row.savedAt)}</dd></div>
      <div><dt>{t("Last observation time")}</dt><dd>{stamp(row.observedAt)}</dd></div>
      <div><dt>{t("Half-life / adjustment interval")}</dt><dd>{number(row.halfLife)} / {number(row.adjustmentInterval)} {clockUnit}</dd></div>
      <div><dt>{t("Adjustment progress (remainder)")}</dt><dd>{number(row.adjustmentProgress)} {clockUnit}</dd></div>
      <div><dt>{t("Weighted hits / weighted exposure")}</dt><dd>{number(row.weightedHits)} / {number(row.weightedExposureSeconds)} s</dd></div>
      <div><dt>{t("Total samples / readiness")}</dt><dd>{t("Not exported; unknown")}</dd></div>
    </dl><p>{t("Export time is not observation time. Weighted exposure is not elapsed time or sample count; adjustment progress is not total samples.")}</p>
      {row.reason ? <p>{t("Source note")}: {t(sourceNotes[row.reason] || "Source or schema unverified")}</p> : null}
    </details>
    <p className="fill-flow">{t("Quote path: skew → pairwise normalization → solve price → spread / anti-arbitrage limits → P1 outward tick rounding → post-only → P2 probability-ratio recheck.")}</p>
    <p className="fill-flow">{t("Side targets may intentionally differ from the base target. Missing stage telemetry prevents attributing the difference to a specific step.")}</p>
  </article>;
}

export function FillProbabilityDashboard() {
  const t = useUiText();
  const [sample, setSample] = useState<{ data: FillSnapshot; receivedAt: number } | null>(null);
  const [clock, setClock] = useState(0), [failed, setFailed] = useState(false), [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ strategy: "", exchange: "", account: "", symbol: "", side: "" });
  const [selected, setSelected] = useState("");
  const refresh = useRef<() => void>(() => undefined);
  useEffect(() => {
    let stopped = false, busy = false, controller: AbortController | null = null;
    const load = async () => {
      if (stopped || busy || document.hidden) return;
      busy = true; setLoading(true); controller = new AbortController();
      const request = controller;
      const timeout = setTimeout(() => request.abort(), 10_000);
      try {
        const response = await fetch("/api/monitoring/fill-probability", { cache: "no-store", signal: request.signal });
        if (!response.ok) throw new Error();
        const data = await response.json() as FillSnapshot;
        if (!Number.isFinite(data.serverTime) || typeof data.configured !== "boolean" || !Array.isArray(data.rows)) throw new Error();
        if (!stopped && !request.signal.aborted) { const receivedAt = performance.now(); setSample({ data, receivedAt }); setClock(receivedAt); setFailed(false); }
      } catch { if (!stopped) setFailed(true); }
      finally { clearTimeout(timeout); busy = false; if (!stopped) setLoading(false); }
    };
    refresh.current = () => { void load(); };
    const visible = () => { setClock(performance.now()); if (document.hidden) controller?.abort(); else void load(); };
    const poll = setInterval(() => { void load(); }, FILL_REFRESH_MS);
    const age = setInterval(() => setClock(performance.now()), 1_000);
    document.addEventListener("visibilitychange", visible);
    void load();
    return () => { stopped = true; controller?.abort(); clearInterval(poll); clearInterval(age); document.removeEventListener("visibilitychange", visible); refresh.current = () => undefined; };
  }, []);
  const rows = sample?.data.rows || [];
  const filtered = rows.filter(row => (!filters.strategy || row.strategy === filters.strategy) && (!filters.exchange || row.exchange === filters.exchange) && (!filters.account || row.account === filters.account) && (!filters.side || row.side === filters.side) && row.symbol.toLowerCase().includes(filters.symbol.toLowerCase()));
  const row = filtered.find(item => item.id === selected) || filtered[0];
  const now = sample ? sample.data.serverTime + Math.max(0, clock - sample.receivedAt) : 0;
  return <section className="fill-dashboard" aria-label={t("Fill probability")}>
    <header><div><p className="fill-eyebrow">{t("MONITOR ROOM")}</p><h2>{t("Fill probability")}</h2><p>{t("One-second probability, target distance and the real quote path.")}</p></div>
      <button type="button" onClick={() => refresh.current()} disabled={loading} aria-label={t("Refresh fill probability")}><RefreshCw size={15} />{t("Refresh fill probability")}</button></header>
    <p className="fill-notice">{t("Chain telemetry is incomplete: normalization and final guard values are not exported. N/A does not mean zero or no guard action.")}</p>
    {failed || (sample?.data.sourceErrors ?? 0) > 0 ? <p className="fill-notice" role="alert">{t("Probability data could not be read. Previous values are unverified.")}</p> : null}
    {!sample && loading ? <p role="status">{t("Loading fill probability…")}</p> : null}
    {sample && !sample.data.configured ? <p>{t("Fill probability source has not been configured.")}</p> : null}
    <div className="fill-filters">{([ ["strategy", "Strategy"], ["exchange", "Exchange"], ["account", "Account"] ] as const).map(([key, label]) => <label key={key}>{t(label)}<select value={filters[key]} onChange={event => setFilters(current => ({ ...current, [key]: event.target.value }))}><option value="">{t("All")}</option>{[...new Set(rows.map(item => item[key]))].sort().map(value => <option key={value}>{value}</option>)}</select></label>)}
      <label>{t("Symbol")}<input value={filters.symbol} onChange={event => setFilters(current => ({ ...current, symbol: event.target.value }))} placeholder={t("Filter symbol")} /></label>
      <label>{t("Side")}<select value={filters.side} onChange={event => setFilters(current => ({ ...current, side: event.target.value }))}><option value="">{t("All")}</option><option value="bid">{t("Buy / bid")}</option><option value="ask">{t("Sell / ask")}</option></select></label>
    </div>
    {filtered.length ? <label className="fill-selection">{t("Record ({count})", { count: filtered.length })}<select value={row?.id || ""} onChange={event => setSelected(event.target.value)}>{filtered.map(item => <option key={item.id} value={item.id}>{item.strategy} / {item.account} / {item.symbol} / {t(item.side === "bid" ? "Buy / bid" : "Sell / ask")}</option>)}</select></label> : sample?.data.configured ? <p>{t("No matching probability records.")}</p> : null}
    {row ? <Stages row={row} now={now} failed={failed} /> : null}
    <footer>{t("Read-only · Refreshes every 10 seconds while visible · No EMA or trading control is recalculated in the browser")}</footer>
  </section>;
}
