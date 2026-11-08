"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import { FILL_REFRESH_MS, FILL_COLUMNS, FILL_DEFAULT_COLUMNS, fillState, quoteState, probabilityGap, projectFillTable, fillTableFields, fillTableId, fillTableOrder,
  type FillColumn, type FillGuardState, type FillSnapshot, type FillTableSnapshot, type FillTableSide, type FillTableRow } from "@/lib/fill-probability/model";
import "./fill-probability.css";

const number = (v: number | null | undefined) => typeof v === "number" && Number.isFinite(v) ? Number(v.toPrecision(6)).toString() : "N/A";
const signed = (v: number) => `${v > 0 ? "+" : ""}${number(v)}`;
const stamp = (v: number | null) => v && Number.isFinite(v) ? new Date(v).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "N/A";
type Filters = { strategy: string; exchange: string; account: string; symbol: string; side: string };
const emptyFilters: Filters = { strategy: "", exchange: "", account: "", symbol: "", side: "" };
const labels: Record<FillColumn, string> = {
  target: "Base theoretical target", base: "Base theoretical EMA", model: "Theoretical EMA", actual: "Actual EMA", ca: "c_A", logca: "Applied log C_A",
  "base-reference": "Fill prob/s before c_A", "ca-probability": "Fill prob/s after c_A", "before-normalize": "Before normalization · side target",
  pmax: "Reachable maximum probability", "after-normalize": "After normalization", "before-guard": "Before price guards",
  p1: "After P1 · outward tick rounding", "post-only": "After post-only guard", p2: "After P2 · probability-ratio recheck", guard: "Guard action · post-only / P2", final: "After guards · final probability",
};
const finiteOrNull = (v: unknown) => v === null || typeof v === "number" && Number.isFinite(v);
function tableReply(raw: FillSnapshot | FillTableSnapshot, columns: FillColumn[]): FillTableSnapshot {
  if (!Number.isFinite(raw.serverTime) || typeof raw.configured !== "boolean" || !Number.isFinite(raw.sourceErrors) || !finiteOrNull(raw.sampledAt)) throw new Error();
  const data = "view" in raw && raw.view === "table" ? raw : !("view" in raw) && Array.isArray(raw.rows) ? projectFillTable(raw, columns) : null;
  if (!data || !Array.isArray(data.rows) || !Array.isArray(data.columns) || JSON.stringify(data.columns) !== JSON.stringify(columns)) throw new Error();
  const ids = new Set<string>(), sideIds = new Set<string>(), fields = fillTableFields(columns);
  for (const row of data.rows) {
    if (!row || [row.producer, row.instance, row.strategy, row.exchange, row.market, row.account, row.symbol].some(v => typeof v !== "string" || v.length > 1024) || row.id !== fillTableId(row) || ids.has(row.id)) throw new Error();
    ids.add(row.id);
    for (const side of [row.bid, row.ask]) {
      if (side === null) continue;
      if (!side || typeof side.id !== "string" || side.id.length > 1024 || sideIds.has(side.id) ||
          typeof side.error !== "boolean" || ![true, false, null].includes(side.enabled) || ![true, false, null].includes(side.ready) ||
          side.sourceSha !== null && (typeof side.sourceSha !== "string" || !/^[0-9a-f]{40}$/i.test(side.sourceSha)) ||
          !["exposure_seconds", "trials", "unknown"].includes(side.clock) ||
          [side.pid, side.heartbeatAt, side.savedAt, side.observedAt, side.schema, side.weightedExposureSeconds, side.target].some(v => !finiteOrNull(v))) throw new Error();
      sideIds.add(side.id);
      for (const [column, field] of [["base", "baseTheoreticalEma"], ["model", "theoreticalEma"], ["actual", "actualEma"]] as const)
        if (columns.includes(column) && !finiteOrNull(side[field])) throw new Error();
      const q = side.quote;
      if (q !== null && (!q || typeof q.available !== "boolean" || [q.at, q.exportedAt, q.baseTarget, q.currentCaProbability].some(v => !finiteOrNull(v)))) throw new Error();
      if (q) for (const key of fields.quote) {
        const value = q[key];
        if (!Object.hasOwn(q, key) || (key === "available" ? typeof value !== "boolean" : ["normalizationEnabled", "underflow", "quoted"].includes(key) ? ![null, true, false].includes(value as boolean | null) : ["p1State", "postOnlyState", "p2State"].includes(key) ? !["changed", "unchanged", "not-run", "rejected", "unknown"].includes(String(value)) : key === "guardReason" ? value !== null && (typeof value !== "string" || value.length > 128) : !finiteOrNull(value))) throw new Error();
      }
    }
  }
  return data;
}

function metrics(row: FillTableSide, now: number, failed: boolean, t: ReturnType<typeof useUiText>) {
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
  const stages: { key: FillColumn; label: string; value: number | null; unit: "probability" | "multiplier" | "log" | "action"; note: string; trusted: boolean; target: number | null; detail?: string; action?: string }[] = [
    { key: "target", label: "Base theoretical target", value: reference, unit: "probability", note: "Configured probability over a one-second horizon", trusted: quoteReady || emaUsable, target: reference },
    { key: "base", label: "Base theoretical EMA", value: emaUsable ? row.baseTheoreticalEma ?? null : null, unit: "probability", note: "Snapshot-derived from persisted base-model hazard and weighted exposure", trusted: emaReady, target: row.target, detail: emaUsable ? status : undefined },
    { key: "model", label: "C_A-adjusted theoretical EMA", value: emaUsable ? row.theoreticalEma ?? null : null, unit: "probability", note: "Historical intervals use their own C_A; this is not base EMA times current C_A", trusted: emaReady, target: row.target, detail: emaUsable ? status : undefined },
    { key: "actual", label: "Actual EMA", value: emaUsable ? row.actualEma ?? null : null, unit: "probability", note: "Original controller readout; legacy values are snapshot-derived", trusted: emaReady, target: row.target, detail: emaUsable ? status : undefined },
    { key: "ca", label: "C_A · arrival-rate multiplier", value: quoteReady ? q!.ca ?? null : null, unit: "multiplier", note: quoteReady ? "Multiplier used by this quote, not a probability" : "Quote observation unavailable or expired", trusted: false, target: null },
    { key: "logca", label: "Applied log C_A", value: quoteReady ? q!.logCa ?? null : null, unit: "log", note: "Applied log multiplier after the existing controller bounds", trusted: false, target: null },
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
  return stages;
}

function SymbolRow({ row, columns, availableColumns, sideFilter, now, failed }: { row: FillTableRow; columns: FillColumn[]; availableColumns: FillColumn[]; sideFilter: string; now: number; failed: boolean }) {
  const t = useUiText();
  const values = { bid: row.bid ? metrics(row.bid, now, failed, t) : [], ask: row.ask ? metrics(row.ask, now, failed, t) : [] };
  const sides = (["bid", "ask"] as const).filter(side => !sideFilter || sideFilter === side);
  return <tr data-symbol={row.symbol} data-record={row.id}>
    <th scope="row"><strong>{row.symbol}</strong><small>{row.strategy} / {row.account} / {row.exchange} {row.market}</small>
      <details className="fill-row-evidence"><summary>{t("Source evidence")}</summary><small>{row.producer} / {row.instance}</small>
        {sides.map(side => { const item = row[side]; return <div key={side}>{t(side === "bid" ? "Buy / bid" : "Sell / ask")}: {item ? <>
          <span data-ema-state={fillState(item, now, failed)}>{t("EMA")}: {fillState(item, now, failed)}</span> · <span data-quote-state={quoteState(item, now, failed)}>{t("Quote")}: {quoteState(item, now, failed)}</span>
          <small>{t("Observed")}: {stamp(item.observedAt)} · {t("Saved")}: {stamp(item.savedAt)} · {t("Quote")}: {stamp(item.quote?.at ?? null)} · {t("Exported")}: {stamp(item.quote?.exportedAt ?? null)}</small>
          <small>{item.sourceSha} / PID {item.pid ?? "N/A"} / v{item.schema ?? "N/A"} / {item.clock} · {item.reason || item.skipReason || ""}</small>
        </> : "N/A"}</div>; })}
      </details>
    </th>
    {columns.map(column => <td key={column} data-column={column}>{sides.map(side => {
      const stage = availableColumns.includes(column) ? values[side].find(item => item.key === column) : undefined;
      const hasValue = typeof stage?.value === "number" && Number.isFinite(stage.value);
      const gap = stage?.unit === "probability" ? probabilityGap(stage.value, stage.target, stage.trusted) : null;
      return <div key={side} className="fill-pair" data-side={side} data-state={hasValue ? stage!.trusted ? "current" : "snapshot" : stage?.action ? "current" : "unknown"} title={stage ? `${t(stage.note)} ${stage.detail || ""}` : t("Loading fill probability…")}>
        <span className="fill-value" style={{ color: gap?.color }}><span>{t(side === "bid" ? "Bid" : "Ask")}: </span><strong>{hasValue ? number(stage!.value) : stage?.action || "N/A"}</strong>{hasValue ? <span> {stage!.unit === "probability" ? "/1s" : stage!.unit === "multiplier" ? "×" : t("log units")}</span> : null}</span>
        {gap ? <small className="fill-gap" style={{ color: gap.color }}>Δ {signed(gap.absolute)} ({signed(gap.relative * 100)}%)</small> : null}
        {stage?.detail ? <small className="fill-stage-detail">{stage.detail}</small> : null}
      </div>;
    })}</td>)}
  </tr>;
}

type FillRequestTiming = { sequence: number; requestId: string | null };
// Fixed names keep only one entry per stage; a task-local observer can retain the finite sample.
function markFillRequest(stage: string, timing: FillRequestTiming, at = performance.now()) {
  try {
    performance.clearMarks?.(`fill:${stage}`);
    performance.mark?.(`fill:${stage}`, { startTime: at, detail: timing });
  } catch { /* Unsupported diagnostics must not alter normal reads/rendering. */ }
}

export function FillProbabilityDashboard() {
  const t = useUiText();
  const [sample, setSample] = useState<{ data: FillTableSnapshot; requestStartedAt: number; timing: FillRequestTiming } | null>(null);
  const [clock, setClock] = useState(0), [failed, setFailed] = useState(false);
  const [readStatus, setReadStatus] = useState<{ kind: "loading" | "retry" | "idle" | "exhausted" | "blocked"; attempt: number }>({ kind: "loading", attempt: 1 });
  const loading = readStatus.kind === "loading" || readStatus.kind === "retry";
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [columns, setColumns] = useState<FillColumn[]>([...FILL_DEFAULT_COLUMNS]);
  const requestSequence = useRef(0);
  const selection = useRef({ columns: [...FILL_DEFAULT_COLUMNS], version: 0 });
  const refresh = useRef<(selectionChanged?: boolean) => void>(() => undefined);
  const changeColumn = (column: FillColumn, checked: boolean) => {
    const next = FILL_COLUMNS.filter(key => key === column ? checked : selection.current.columns.includes(key));
    selection.current = { columns: next, version: selection.current.version + 1 }; setColumns(next); refresh.current(true);
  };
  useLayoutEffect(() => {
    if (!sample) return;
    markFillRequest("commit", sample.timing);
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => markFillRequest("display-opportunity", sample.timing)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [sample]);
  useEffect(() => {
    type Round = { id: number; spec: typeof selection.current; attempts: number; phase: "idle" | "active" | "backoff" | "paused" | "halted"; resumeRetry: boolean };
    let stopped = false, busy = false, queued = false, generation = 0;
    let active: { controller: AbortController; intentional: boolean; timedOut: boolean; timer?: ReturnType<typeof setTimeout> } | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const fresh = (): Round => ({ id: ++generation, spec: selection.current, attempts: 0, phase: "idle", resumeRetry: false });
    let round = fresh();
    const halted = (r: Round) => r.phase === "halted";
    const clearRetry = () => { clearTimeout(retryTimer); retryTimer = undefined; };
    const cancel = () => { if (active) { active.intentional = true; clearTimeout(active.timer); active.controller.abort(); } };
    const backoff = (r: Round) => {
      if (stopped || r !== round || r.phase === "halted") return;
      r.phase = document.hidden ? "paused" : "backoff"; r.resumeRetry = true;
      setReadStatus({ kind: "retry", attempt: r.attempts });
      if (!document.hidden) retryTimer = setTimeout(() => { retryTimer = undefined; if (!stopped && r === round) { r.phase = "paused"; void load(); } }, 2_000);
    };
    const load = async () => {
      if (stopped || document.hidden || busy || round.phase === "halted" || round.phase === "backoff") return;
      const r = round, spec = r.spec;
      queued = false; busy = true; r.phase = "active"; r.resumeRetry = false; r.attempts++;
      const request = { controller: new AbortController(), intentional: false, timedOut: false, timer: undefined as ReturnType<typeof setTimeout> | undefined };
      active = request;
      const requestStartedAt = performance.now(), timing: FillRequestTiming = { sequence: ++requestSequence.current, requestId: null };
      markFillRequest("fetch-start", timing, requestStartedAt); setReadStatus({ kind: "loading", attempt: r.attempts });
      request.timer = setTimeout(() => { request.timedOut = true; request.controller.abort(); }, 30_000);
      let retryable = true;
      try {
        const params = new URLSearchParams({ view: "table", columns: spec.columns.join(",") });
        const response = await fetch(`/api/monitoring/fill-probability?${params}`, { cache: "no-store", signal: request.controller.signal });
        const id = response.headers.get("x-fill-request-id");
        timing.requestId = id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
        markFillRequest("headers", timing);
        if (!response.ok) {
          retryable = response.status === 408 || response.status === 429 || response.status >= 500;
          if (retryable) { try { if ((await response.json())?.retryable === false) retryable = false; } catch { /* HTTP error pages may be HTML or interrupted. */ } }
          throw new Error();
        }
        let raw: FillSnapshot | FillTableSnapshot;
        try { raw = await response.json(); } catch (error) { retryable = !(error instanceof SyntaxError); throw error; }
        markFillRequest("json-read", timing); retryable = false;
        const data = tableReply(raw, spec.columns);
        markFillRequest("validated", timing);
        if (data.sourceErrors > 0) { retryable = true; throw new Error(); }
        if (request.timedOut) { retryable = true; throw new Error(); }
        if (!stopped && r === round && !request.controller.signal.aborted && spec.version === selection.current.version) {
          markFillRequest("submit", timing); setSample({ data, requestStartedAt, timing }); setClock(performance.now()); setFailed(false);
          r.phase = "idle"; setReadStatus({ kind: "idle", attempt: r.attempts });
        }
      } catch {
        if (!stopped && r === round) {
          if (request.intentional) { r.attempts = Math.max(0, r.attempts - 1); r.phase = "paused"; }
          else {
            setFailed(true);
            if ((request.timedOut || retryable) && r.attempts < 3) backoff(r);
            else { r.phase = "halted"; setReadStatus({ kind: request.timedOut || retryable ? "exhausted" : "blocked", attempt: r.attempts }); }
          }
        }
      } finally {
        if (request.intentional && r === round && r.phase === "active") { r.attempts = Math.max(0, r.attempts - 1); r.phase = "paused"; }
        markFillRequest("settled", timing); clearTimeout(request.timer); active = null; busy = false;
        // Only the latest explicit query/resume can start after a cancelled in-flight promise settles.
        if (!stopped && queued && !document.hidden && !halted(round)) { queued = false; void load(); }
      }
    };
    const reset = () => {
      clearRetry(); round = fresh(); setReadStatus({ kind: "loading", attempt: 1 });
      if (busy) { queued = true; cancel(); } else void load();
    };
    refresh.current = reset;
    const visible = () => {
      setClock(performance.now());
      if (document.hidden) { clearRetry(); if (busy) cancel(); else if (round.phase === "backoff") { round.phase = "paused"; round.resumeRetry = true; } return; }
      if (round.phase === "halted") return;
      if (busy) { queued = true; return; }
      if (round.phase === "paused") { if (round.resumeRetry) backoff(round); else void load(); } else if (round.phase === "idle") reset();
    };
    const poll = setInterval(() => { if (!document.hidden && !busy && round.phase === "idle") reset(); }, FILL_REFRESH_MS);
    const age = setInterval(() => setClock(performance.now()), 1_000);
    document.addEventListener("visibilitychange", visible); void load();
    return () => { stopped = true; clearRetry(); cancel(); clearInterval(poll); clearInterval(age); document.removeEventListener("visibilitychange", visible); refresh.current = () => undefined; };
  }, []);
  const rows = sample?.data.rows || [];
  const now = sample ? sample.data.serverTime + Math.max(0, clock - sample.requestStartedAt) : 0;
  const filtered = rows.filter(row => (!filters.strategy || row.strategy === filters.strategy) && (!filters.exchange || row.exchange === filters.exchange) &&
    (!filters.account || row.account === filters.account) && row.symbol.toLowerCase().includes(filters.symbol.toLowerCase()) &&
    (!filters.side || row[filters.side as "bid" | "ask"] !== null)).sort((a, b) => fillTableOrder(a, b, now, failed));
  return <section className="fill-dashboard" aria-label={t("Fill probability")}>
    <header><div><p className="fill-eyebrow">{t("MONITOR ROOM")}</p><h2>{t("Fill probability")}</h2><p>{t("One-second probability, target distance and the real quote path.")}</p></div>
      <button type="button" onClick={() => refresh.current()} disabled={loading} aria-label={t("Refresh fill probability")}><RefreshCw size={15} />{t("Refresh fill probability")}</button></header>
    {failed || (sample?.data.sourceErrors ?? 0) > 0 ? <p className="fill-notice" role="alert">{t("Probability data could not be read. Previous values are unverified.")}</p> : null}
    {readStatus.kind !== "idle" ? <p role="status">{t(readStatus.kind === "loading" ? "Reading / transferring data. Please wait patiently. Attempt {attempt}/3." : readStatus.kind === "retry" ? "Temporary read failure. Retrying in 2 seconds. Attempt {attempt}/3." : readStatus.kind === "exhausted" ? "Read attempts exhausted. Please refresh manually. Attempt {attempt}/3." : "Data could not be read. Please refresh manually. Attempt {attempt}/3.", { attempt: readStatus.attempt })}</p> : null}
    {sample && !sample.data.configured ? <p>{t("Fill probability source has not been configured.")}</p> : null}
    <div className="fill-filters">{([ ["strategy", "Strategy"], ["exchange", "Exchange"], ["account", "Account"] ] as const).map(([key, label]) => <label key={key}>{t(label)}<select value={filters[key]} onChange={e => setFilters(current => ({ ...current, [key]: e.target.value }))}><option value="">{t("All")}</option>{[...new Set(rows.map(item => item[key]))].sort().map(value => <option key={value}>{value}</option>)}</select></label>)}
      <label>{t("Symbol")}<input value={filters.symbol} onChange={e => setFilters(current => ({ ...current, symbol: e.target.value }))} placeholder={t("Filter symbol")} /></label>
      <label>{t("Side")}<select value={filters.side} onChange={e => setFilters(current => ({ ...current, side: e.target.value }))}><option value="">{t("All")}</option><option value="bid">{t("Buy / bid")}</option><option value="ask">{t("Sell / ask")}</option></select></label>
    </div>
    <details className="fill-columns"><summary>{t("Columns")}</summary><fieldset><legend>{t("Select metrics")}</legend>{FILL_COLUMNS.map(key => <label key={key}><input type="checkbox" checked={columns.includes(key)} onChange={e => changeColumn(key, e.target.checked)} />{t(labels[key])}</label>)}</fieldset></details>
    <p className="fill-scope">{t("EMA scope: symbol + side, shared across accounts in this strategy instance.")} {t("Quote scope: this account + symbol + side. Quote and EMA clocks are separate.")}</p>
    <p className="fill-legend">{t("Green → red follows absolute distance from target; unavailable, expired or sample-unknown evidence stays gray.")} {t("Freshness includes the time spent reading. A slow response may turn gray.")}</p>
    {filtered.length ? <div className="fill-table-scroll"><table className="fill-symbol-table" aria-label={t("Fill probability symbols")}><thead><tr><th scope="col">{t("Symbol")}</th>{columns.map(key => <th key={key} scope="col">{t(labels[key])}</th>)}</tr></thead><tbody>{filtered.map(row => <SymbolRow key={row.id} row={row} columns={columns} availableColumns={sample!.data.columns} sideFilter={filters.side} now={now} failed={failed} />)}</tbody></table></div> : sample?.data.configured ? <p>{t("No matching probability records.")}</p> : null}
    <footer>{t("Read-only · Refreshes every 10 seconds while visible · No EMA or trading control is recalculated in the browser")}</footer>
  </section>;
}
