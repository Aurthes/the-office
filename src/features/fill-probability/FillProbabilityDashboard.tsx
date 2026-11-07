"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import { FILL_REFRESH_MS, fillState, quoteState, probabilityGap, type FillGuardState, type FillRow, type FillSnapshot, type FillRecordIdentity, type FillRecordSnapshot } from "@/lib/fill-probability/model";
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
type Filters = { strategy: string; exchange: string; account: string; symbol: string; side: string };
const emptyFilters: Filters = { strategy: "", exchange: "", account: "", symbol: "", side: "" };
const identity = ({ id, strategy, exchange, account, symbol, side }: FillRow): FillRecordIdentity => ({ id, strategy, exchange, account, symbol, side });
const matching = (rows: FillRecordIdentity[], filters: Filters) => rows.filter(row =>
  (!filters.strategy || row.strategy === filters.strategy) && (!filters.exchange || row.exchange === filters.exchange) &&
  (!filters.account || row.account === filters.account) && (!filters.side || row.side === filters.side) && row.symbol.toLowerCase().includes(filters.symbol.toLowerCase()));
const chosen = (rows: FillRecordIdentity[], filters: Filters, selected: string) => {
  const filtered = matching(rows, filters);
  return filtered.find(row => row.id === selected) || filtered[0];
};

// Old servers may still return the full snapshot during a rollback.
function recordReply(data: FillSnapshot | FillRecordSnapshot, filters: Filters, selected: string): FillRecordSnapshot {
  if (!Number.isFinite(data.serverTime) || typeof data.configured !== "boolean" || !Number.isFinite(data.sourceErrors) ||
      data.sampledAt !== null && !Number.isFinite(data.sampledAt)) throw new Error();
  let reply: FillRecordSnapshot;
  if ("rows" in data && Array.isArray(data.rows)) {
    const records = data.rows.map(identity), wanted = chosen(records, filters, selected);
    reply = { configured: data.configured, serverTime: data.serverTime, sampledAt: data.sampledAt,
      sourceErrors: data.sourceErrors, view: "record", records, row: data.rows.find(row => row.id === wanted?.id) || null };
  } else if ("view" in data && data.view === "record" && Array.isArray(data.records)) reply = data;
  else throw new Error();
  const ids = new Set<string>();
  for (const row of reply.records) {
    if (!row || [row.id, row.strategy, row.exchange, row.account, row.symbol].some(value => typeof value !== "string" || value.length > 1024) ||
        !["bid", "ask"].includes(row.side) || ids.has(row.id)) throw new Error();
    ids.add(row.id);
  }
  const wanted = chosen(reply.records, filters, selected);
  if (wanted ? !reply.row || Object.keys(wanted).some(key => reply.row![key as keyof FillRecordIdentity] !== wanted[key as keyof FillRecordIdentity]) : reply.row !== null) throw new Error();
  return reply;
}

function Stages({ row, now, failed }: { row: FillRow; now: number; failed: boolean }) {
  const t = useUiText();
  const state = fillState(row, now, failed), currentQuoteState = quoteState(row, now, failed);
  const emaUsable = state === "snapshot" || state === "ready", emaReady = state === "ready";
  const q = row.quote, quoteReady = currentQuoteState === "ready";
  const positiveUnderflow = q?.underflow === true && typeof q.logAfterNormalize === "number" && Number.isFinite(q.logAfterNormalize);
  const disabledReasons = q?.disabledMask == null ? t("Source reason not exported") :
    ([ [1, "Model disabled this side"], [2, "Fee unavailable"], [4, "Risk blocked"], [8, "EV blocked"], [16, "Anti-arbitrage blocked"] ] as const)
      .filter(([bit]) => (q.disabledMask! & bit) !== 0).map(([, label]) => t(label)).join(", ") || t("No side disable flag");
  const status = t(state === "ready" ? "Original controller ready; current observation" : state === "stale" ? "Snapshot expired or freshness unverified" : state === "disabled" ? "Feedback disabled" : state === "empty" ? "No weighted exposure" : state === "not-ready" ? "Original controller not ready" : state === "unknown" ? "Source or schema unverified" : "Historical snapshot; observation time and readiness unknown");
  const guardLabel = (value: FillGuardState | undefined) => t(value === "changed" ? "Changed price" : value === "unchanged" ? "Passed without price change" : value === "not-run" ? "Not run" : value === "rejected" ? "Rejected" : "Unknown");
  const quoteValue = (value: number | null | undefined) => quoteReady ? value ?? null : null;
  const reference = quoteReady ? q!.baseTarget : row.target;
  const quoteNote = quoteReady ? "Captured from this account's quote calculation" : "Quote observation unavailable or expired";
  const stages: { key: string; label: string; value: number | null; unit: "probability" | "multiplier" | "log" | "action"; note: string; trusted: boolean; target: number | null; detail?: string; action?: string }[] = [
    { key: "target", label: "Base theoretical target", value: reference, unit: "probability", note: "Configured probability over a one-second horizon", trusted: quoteReady || emaUsable, target: reference },
    { key: "base", label: "Base theoretical EMA", value: emaUsable ? row.baseTheoreticalEma : null, unit: "probability", note: "Snapshot-derived from persisted base-model hazard and weighted exposure", trusted: emaReady, target: row.target, detail: emaUsable ? status : undefined },
    { key: "model", label: "C_A-adjusted theoretical EMA", value: emaUsable ? row.theoreticalEma : null, unit: "probability", note: "Historical intervals use their own C_A; this is not base EMA times current C_A", trusted: emaReady, target: row.target, detail: emaUsable ? status : undefined },
    { key: "actual", label: "Actual EMA", value: emaUsable ? row.actualEma : null, unit: "probability", note: "Original controller readout; legacy values are snapshot-derived", trusted: emaReady, target: row.target, detail: emaUsable ? status : undefined },
    { key: "ca", label: "C_A · arrival-rate multiplier", value: quoteReady ? q!.ca : emaUsable ? row.ca : null, unit: "multiplier", note: quoteReady ? "Multiplier used by this quote, not a probability" : "Controller export multiplier; not a probability", trusted: false, target: null },
    { key: "logca", label: "Applied log C_A", value: quoteReady ? q!.logCa : emaUsable ? row.logCa : null, unit: "log", note: "Applied log multiplier after the existing controller bounds", trusted: false, target: null },
    { key: "base-reference", label: "Before current C_A · same-price model probability", value: quoteValue(q?.baseAtReferenceProbability), unit: "probability", note: "Model estimate without C_A at the same captured reference price", trusted: quoteReady, target: q?.baseTarget ?? null, detail: t("Reference price: {price}", { price: number(quoteValue(q?.referencePrice)) }) },
    { key: "ca-probability", label: "After current C_A · instantaneous probability", value: quoteValue(q?.currentCaProbability), unit: "probability", note: "Model estimate with captured C_A at the solved pre-anti-arbitrage price", trusted: quoteReady, target: q?.baseTarget ?? null, detail: t("Reference price: {price}", { price: number(quoteValue(q?.referencePrice)) }) },
    { key: "before-normalize", label: "Before normalization · side target", value: quoteValue(q?.beforeNormalize), unit: "probability", note: quoteNote, trusted: quoteReady, target: q?.baseTarget ?? null },
    { key: "pmax", label: "Reachable maximum probability", value: quoteValue(q?.normalizationEnabled === false ? null : q?.pmax), unit: "probability", note: q?.normalizationEnabled === false ? "Normalization disabled; Pmax was not needed" : quoteNote, trusted: quoteReady, target: q?.baseTarget ?? null },
    { key: "after-normalize", label: "After normalization", value: quoteValue(q?.afterNormalize), unit: "probability", note: positiveUnderflow ? "Positive target below floating-point range; use the captured log target" : quoteNote, trusted: quoteReady, target: q?.baseTarget ?? null,
      detail: quoteReady ? t("Normalization: {state} · scale {scale}", { state: t(q!.normalizationEnabled ? "Enabled" : "Disabled"), scale: number(q!.normalizationScale) }) + (positiveUnderflow ? ` · ln(p) ${number(q!.logAfterNormalize)}` : "") : undefined },
    { key: "before-guard", label: "Before price guards", value: quoteValue(q?.p1BeforeProbability), unit: "probability", note: "Captured continuous price after spread and anti-arbitrage limits", trusted: quoteReady, target: q?.baseTarget ?? null, detail: t("Price: {price}", { price: number(quoteValue(q?.p1BeforePrice)) }) },
    { key: "p1", label: "After P1 · outward tick rounding", value: quoteValue(q?.p1State === "not-run" ? null : q?.p1AfterProbability), unit: "probability", note: quoteReady ? guardLabel(q!.p1State) : quoteNote, trusted: quoteReady, target: q?.baseTarget ?? null, detail: t("Price: {price}", { price: number(quoteValue(q?.p1AfterPrice)) }) },
    { key: "post-only", label: "After post-only guard", value: quoteValue(q?.postOnlyState === "not-run" ? null : q?.postOnlyAfterProbability), unit: "probability", note: quoteReady ? guardLabel(q!.postOnlyState) : quoteNote, trusted: quoteReady, target: q?.baseTarget ?? null, detail: t("Price: {price}", { price: number(quoteValue(q?.postOnlyAfterPrice)) }) },
    { key: "p2", label: "After P2 · probability-ratio recheck", value: quoteValue(q?.p2State === "not-run" ? null : q?.p2AfterProbability), unit: "probability", note: quoteReady ? guardLabel(q!.p2State) : quoteNote, trusted: quoteReady, target: q?.baseTarget ?? null, detail: t("Price: {price}", { price: number(quoteValue(q?.p2AfterPrice)) }) },
    { key: "guard", label: "Guard action · post-only / P2", value: null, unit: "action", note: quoteReady ? "Action comes from actual execution branches and before/after ticks" : "Guard action unknown; not the same as not triggered", trusted: false, target: null,
      action: quoteReady ? `${t("Post-only")}: ${guardLabel(q!.postOnlyState)} · P2: ${guardLabel(q!.p2State)}` : undefined,
      detail: q?.guardReason || undefined },
    { key: "final", label: "After guards · final probability", value: quoteValue(q?.quoted === true ? q.finalProbability : null), unit: "probability", note: quoteReady && q!.quoted === false ? "No near quote" : quoteReady ? "Model estimate at the final near target price; not a fill guarantee" : quoteNote, trusted: quoteReady && q?.quoted === true, target: q?.baseTarget ?? null,
      detail: quoteReady && q!.quoted === false ? `${q!.guardReason || t("Source reason not exported")} · ${disabledReasons} · ${t("Disable mask")}: ${q!.disabledMask ?? "N/A"}` : t("Price: {price}", { price: number(quoteValue(q?.quoted === true ? q.finalPrice : null)) }) },
  ];
  const clockUnit = row.clock === "exposure_seconds" ? t("exposure seconds") : row.clock === "trials" ? t("trials") : t("Unknown");
  return <article className="fill-record" aria-label={t("Selected probability record")}>
    <div className="fill-record-title"><div><h3>{row.symbol} · {t(row.side === "bid" ? "Buy / bid" : "Sell / ask")}</h3><p>{row.strategy} · {row.account} · {row.exchange} {row.market}</p></div><span className="fill-state" data-state={state}>{status}</span></div>
    <p className="fill-scope">{t("EMA scope: symbol + side, shared across accounts in this strategy instance.")}</p>
    <p className="fill-scope">{t("Quote scope: this account + symbol + side. Quote and EMA clocks are separate.")}</p>
    <div className="fill-table-scroll"><table aria-label={t("Fill probability stages")}><thead><tr><th scope="col">{t("Stage")}</th><th scope="col">{t("Value")}</th><th scope="col">{t("Difference from target")}</th><th scope="col">{t("Evidence / explanation")}</th></tr></thead>
      <tbody>{stages.map(stage => {
        const hasValue = typeof stage.value === "number" && Number.isFinite(stage.value);
        const gap = stage.unit === "probability" ? probabilityGap(stage.value, stage.target, stage.trusted) : null;
        return <tr key={stage.key} data-stage={stage.key} data-state={hasValue ? stage.key === "target" && stage.trusted ? "reference" : stage.trusted ? "current" : "snapshot" : stage.action ? "current" : "unknown"}>
          <th scope="row">{t(stage.label)}</th>
          <td className="fill-value" style={{ color: gap?.color }}><strong>{hasValue ? number(stage.value) : stage.action || "N/A"}</strong>{hasValue ? <small>{stage.unit === "probability" ? `/ 1s (${number(stage.value! * 100)}%)` : stage.unit === "multiplier" ? "×" : t("log units")}</small> : null}</td>
          <td className="fill-gap" style={{ color: gap?.color }}>{gap ? <><strong>{signed(gap.absolute)}</strong><small>{signed(gap.relative * 100)}%</small></> : "—"}</td>
          <td><span>{t(stage.note)}</span>{stage.detail ? <small>{stage.detail}</small> : null}</td>
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
      <div><dt>{t("Quote calculation time")}</dt><dd>{stamp(q?.at ?? null)}</dd></div>
      <div><dt>{t("Quote export time")}</dt><dd>{stamp(q?.exportedAt ?? null)}</dd></div>
      <div><dt>{t("Quote observation state")}</dt><dd>{t(currentQuoteState === "ready" ? "Current quote observation" : currentQuoteState === "stale" ? "Quote observation expired or freshness unverified" : "Quote observation unavailable")}</dd></div>
      <div><dt>{t("Quote source reason")}</dt><dd>{q?.guardReason || "—"}</dd></div>
      <div><dt>{t("Half-life / adjustment interval")}</dt><dd>{number(row.halfLife)} / {number(row.adjustmentInterval)} {clockUnit}</dd></div>
      <div><dt>{t("Adjustment progress (remainder)")}</dt><dd>{number(row.adjustmentProgress)} {clockUnit}</dd></div>
      <div><dt>{t("Weighted hits / weighted exposure")}</dt><dd>{number(row.weightedHits)} / {number(row.weightedExposureSeconds)} s</dd></div>
      <div><dt>{t("Original controller readiness / skip reason")}</dt><dd>{typeof row.ready !== "boolean" ? t("Not exported; unknown") : `${t(row.ready ? "Ready" : "Not ready")} · ${row.skipReason || "—"}`}</dd></div>
    </dl><p>{t("Export time is not observation time. Weighted exposure is not elapsed time or sample count; adjustment progress is not total samples.")}</p>
      <p>{t("Freshness includes request time; slow responses may appear gray.")}</p>
      <p>{t("Controller ready is the producer's existing rule, not statistical confidence or trading health.")}</p>
      {row.reason ? <p>{t("Source note")}: {t(sourceNotes[row.reason] || "Source or schema unverified")}</p> : null}
    </details>
    <p className="fill-flow">{t("Quote path: skew → pairwise normalization → solve price → spread / anti-arbitrage limits → P1 outward tick rounding → post-only → P2 probability-ratio recheck.")}</p>
    <p className="fill-flow">{t("Side targets may intentionally differ from the base target. Missing stage telemetry prevents attributing the difference to a specific step.")}</p>
  </article>;
}

export function FillProbabilityDashboard() {
  const t = useUiText();
  const [sample, setSample] = useState<{ data: FillRecordSnapshot; requestStartedAt: number } | null>(null);
  const [clock, setClock] = useState(0), [failed, setFailed] = useState(false), [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [selected, setSelected] = useState("");
  const selection = useRef({ filters: emptyFilters, selected: "", version: 0 });
  const refresh = useRef<(selectionChanged?: boolean) => void>(() => undefined);
  const changeFilter = (key: keyof Filters, value: string) => {
    const next = { ...selection.current.filters, [key]: value };
    selection.current = { ...selection.current, filters: next, version: selection.current.version + 1 };
    setFilters(next); refresh.current(true);
  };
  const changeRecord = (value: string) => {
    selection.current = { ...selection.current, selected: value, version: selection.current.version + 1 };
    setSelected(value); refresh.current(true);
  };
  useEffect(() => {
    let stopped = false, busy = false, controller: AbortController | null = null;
    let queued = false, records: FillRecordIdentity[] = [], detailId: string | undefined;
    const load = async (replace = false) => {
      if (stopped || document.hidden) return;
      if (busy) { if (replace) { queued = true; controller?.abort(); } return; }
      queued = false;
      busy = true; setLoading(true); controller = new AbortController();
      const request = controller, spec = selection.current, requestStartedAt = performance.now();
      // The producer read allows 12s; leave time for that read and public-network transfer.
      const timeout = setTimeout(() => request.abort(), 20_000);
      try {
        // A substring longer than any validated symbol cannot match. Bound its URL without turning it into a matching prefix.
        const symbol = spec.filters.symbol.length > 1024 ? "x".repeat(1025) : spec.filters.symbol;
        const params = new URLSearchParams({ view: "record", recordId: spec.selected, ...spec.filters, symbol });
        const response = await fetch(`/api/monitoring/fill-probability?${params}`, { cache: "no-store", signal: request.signal });
        if (!response.ok) throw new Error();
        const data = recordReply(await response.json(), spec.filters, spec.selected);
        if (!stopped && !request.signal.aborted && spec.version === selection.current.version) {
          records = data.records; detailId = data.row?.id;
          const receivedAt = performance.now(); setSample({ data, requestStartedAt }); setClock(receivedAt); setFailed(false);
        }
      } catch { if (!stopped && !queued && spec.version === selection.current.version) setFailed(true); }
      finally {
        clearTimeout(timeout); busy = false;
        if (!stopped) { if (queued && !document.hidden) { void load(); } else setLoading(false); }
      }
    };
    refresh.current = (selectionChanged = false) => {
      const spec = selection.current, wanted = chosen(records, spec.filters, spec.selected);
      if (selectionChanged && !busy && records.length && (!wanted || wanted.id === detailId)) return;
      void load(selectionChanged);
    };
    const visible = () => { setClock(performance.now()); if (document.hidden) controller?.abort(); else void load(true); };
    const poll = setInterval(() => { void load(); }, FILL_REFRESH_MS);
    const age = setInterval(() => setClock(performance.now()), 1_000);
    document.addEventListener("visibilitychange", visible);
    void load();
    return () => { stopped = true; controller?.abort(); clearInterval(poll); clearInterval(age); document.removeEventListener("visibilitychange", visible); refresh.current = () => undefined; };
  }, []);
  const rows = sample?.data.records || [];
  const filtered = matching(rows, filters);
  const wanted = filtered.find(item => item.id === selected) || filtered[0];
  const row = sample?.data.row?.id === wanted?.id ? sample?.data.row : null;
  const now = sample ? sample.data.serverTime + Math.max(0, clock - sample.requestStartedAt) : 0;
  return <section className="fill-dashboard" aria-label={t("Fill probability")}>
    <header><div><p className="fill-eyebrow">{t("MONITOR ROOM")}</p><h2>{t("Fill probability")}</h2><p>{t("One-second probability, target distance and the real quote path.")}</p></div>
      <button type="button" onClick={() => refresh.current()} disabled={loading} aria-label={t("Refresh fill probability")}><RefreshCw size={15} />{t("Refresh fill probability")}</button></header>
    {row && !row.quote ? <p className="fill-notice">{t("Quote observation has not been exported by this producer. N/A does not mean zero or no guard action.")}</p> : null}
    {row?.quote && !row.quote.available ? <p className="fill-notice">{t("Quote was observed, but quote stages are unavailable.")} {t("Observed at {time}: {reason}", { time: stamp(row.quote.at), reason: row.quote.guardReason || t("Source reason not exported") })}</p> : null}
    {failed || (sample?.data.sourceErrors ?? 0) > 0 ? <p className="fill-notice" role="alert">{t("Probability data could not be read. Previous values are unverified.")}</p> : null}
    {!sample && loading ? <p role="status">{t("Loading fill probability…")}</p> : null}
    {sample && wanted && !row && loading ? <p role="status">{t("Loading fill probability…")}</p> : null}
    {sample && !sample.data.configured ? <p>{t("Fill probability source has not been configured.")}</p> : null}
    <div className="fill-filters">{([ ["strategy", "Strategy"], ["exchange", "Exchange"], ["account", "Account"] ] as const).map(([key, label]) => <label key={key}>{t(label)}<select value={filters[key]} onChange={event => changeFilter(key, event.target.value)}><option value="">{t("All")}</option>{[...new Set(rows.map(item => item[key]))].sort().map(value => <option key={value}>{value}</option>)}</select></label>)}
      <label>{t("Symbol")}<input value={filters.symbol} onChange={event => changeFilter("symbol", event.target.value)} placeholder={t("Filter symbol")} /></label>
      <label>{t("Side")}<select value={filters.side} onChange={event => changeFilter("side", event.target.value)}><option value="">{t("All")}</option><option value="bid">{t("Buy / bid")}</option><option value="ask">{t("Sell / ask")}</option></select></label>
    </div>
    {filtered.length ? <label className="fill-selection">{t("Record ({count})", { count: filtered.length })}<select value={wanted?.id || ""} onChange={event => changeRecord(event.target.value)}>{filtered.map(item => <option key={item.id} value={item.id}>{item.strategy} / {item.account} / {item.symbol} / {t(item.side === "bid" ? "Buy / bid" : "Sell / ask")}</option>)}</select></label> : sample?.data.configured ? <p>{t("No matching probability records.")}</p> : null}
    {row ? <Stages row={row} now={now} failed={failed} /> : null}
    <footer>{t("Read-only · Refreshes every 10 seconds while visible · No EMA or trading control is recalculated in the browser")}</footer>
  </section>;
}
