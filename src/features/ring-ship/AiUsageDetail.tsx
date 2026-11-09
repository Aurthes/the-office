"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { useUiText } from "@/lib/i18n/ui-language";
import { USAGE_TIME_ZONE } from "./ai-center";
import type { ObservedResponse, UsageDetail, UsageTaskLabel, UsagePurpose, UsageWindow } from "./ai-center";
import { AiPurposeSummary, PurposeComponents, PURPOSE_LABELS, UsageWindowRange } from "./AiPurposeSummary";

const number = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat().format(value);
const taskLabel = (task: UsageTaskLabel | null) => task ? [task.code, task.title].filter(Boolean).join(" · ") : "";
function ResponseRow({ row, timeZone }: { row: ObservedResponse; timeZone: string }) {
  const t = useUiText(), u = row.usage;
  const parts = [["Cached input", u.cachedInput], ["Uncached input", u.uncachedInput], ["Reasoning output", u.reasoningOutput], ["Other output", u.otherOutput]] as const;
  const bars = u.reasoningOutput === null || u.otherOutput === null ? [["Input tokens", u.input], ["Output tokens", u.output]] as const : parts;
  return <details className="ai-response">
    <summary><span><b>{row.agentName}</b><small>{new Date(row.observedAt).toLocaleTimeString([], { timeZone })} · {row.configuredModel || t("Unknown")}</small></span>
      <span className="ai-response-total"><b>{number(u.total)}</b><small>{t("tokens")}</small></span></summary>
    <div className="ai-response-body">
      {bars.every(([, value]) => value !== null) ? <div className="ai-response-parts" aria-hidden="true">{bars.map(([name, value], index) => <i key={name} data-part={index} style={{ width: `${u.total ? (value ?? 0) / u.total * 100 : 0}%` }} />)}</div> : null}
      <dl className="ai-response-numbers">{parts.map(([name, value]) => <div key={name}><dt>{t(name)}</dt><dd>{number(value)}</dd></div>)}</dl>
      <p className="ai-card-caption">{t("Input {input} + output {output} = total {total}", { input: number(u.input), output: number(u.output), total: number(u.total) })}</p>
      {row.sourceKind === "dictation" && u.total === null ? <p className="ai-notice">{t("Token usage unknown; duration is not converted to tokens.")}{row.durationSeconds != null ? ` ${row.durationSeconds} s` : ""}</p> : null}
      {row.totalBasis === "derivedInputOutput" ? <p className="ai-card-note">{t("Total is derived from reported input + output. Reasoning and cache-write usage are not reported.")}</p> : null}
      {u.cacheWriteInput ? <p className="ai-card-note">{t("Reported cache-write input: {count}. Not added to the total.", { count: number(u.cacheWriteInput) })}</p> : null}
      <dl className="ai-response-meta">
        <dt>{t(row.sourceKind === "dictation" ? "Provider request / attempt" : "Response ID")}</dt><dd>{row.responseId || row.providerRequestId || row.attemptId || t("Unknown")}</dd>
        <dt>{t("Office agent")}</dt><dd>{row.agentName} · {row.officeAgentId}</dd>
        <dt>{t("Turn ID")}</dt><dd>{row.turnId || t(row.sourceKind === "dictation" ? "HTTP transcription request; no native turn" : "Actual sample thread/turn is not reported")}{row.sameTurnResponses !== null ? ` · ${t("{count} observed responses in this turn", { count: row.sameTurnResponses })}` : ""}</dd>
        {row.sourceTurnId ? <><dt>{t("Source context turn")}</dt><dd>{row.sourceTurnId} · {t("Context reference, not the sample's actual turn")}</dd></> : null}
        <dt>{t("Purpose")}</dt><dd>{t(PURPOSE_LABELS[row.purpose])}</dd>
        <dt>{t("Configured model")}</dt><dd>{row.configuredModel || t("Unknown")} / {row.configuredEffort || t("Unknown")} · {t(row.modelBasis === "turnContext" ? "Recorded turn context" : row.modelBasis === "requestConfiguration" ? "Request configuration" : "Unknown")}</dd>
        <dt>{t("Actual model / response status")}</dt><dd>{row.sourceKind === "dictation" ? `${t("Unknown")} / ${row.status}` : t("Unknown / unknown — not reported by this source")}</dd>
        <dt>{t("Task / question")}</dt><dd>{taskLabel(row.task) || t(row.taskId ? "Unavailable task" : "Unattributed")}{row.phaseId ? ` / ${row.phaseId}` : ""}{row.questionIds.length ? ` · ${row.questionIds.join(", ")}` : ""}</dd>
        {row.taskId ? <><dt>{t("Task ID")}</dt><dd>{row.taskId}</dd></> : null}
      </dl>
      {row.attributionBasis === "turnDispatch" ? <p className="ai-card-note">{t("Task/question IDs were captured at turn dispatch, not at each model request. Later steering may change the context.")}</p> : <p className="ai-card-note">{t("No historical task binding. Current owners and tasks are not used to guess it.")}</p>}
      {row.previousObservedInput ? <p className="ai-card-note">{t("Input changed by {change} from the previous observed response in this turn ({input} input tokens). This comparison does not explain the cause.", { change: `${row.previousObservedInput.change >= 0 ? "+" : ""}${number(row.previousObservedInput.change)}`, input: number(row.previousObservedInput.input) })}<br />{row.previousObservedInput.responseId}</p> : null}
      {row.conflict ? <p role="alert" className="ai-notice">{t("Conflicting source records: first value retained, not added twice.")}</p> : null}
    </div>
  </details>;
}

export function AiUsageDetail({ date, accountTokens, client, onBack, onDateChange, initialPurpose, initialSnapshot, rolling = false, initialWindow, onWindow }: {
  date: string; accountTokens: number | null; client: Pick<GatewayClient, "call">; onBack: () => void; onDateChange: (date: string) => void; initialPurpose?: UsagePurpose; initialSnapshot?: string; rolling?: boolean; initialWindow?: UsageWindow; onWindow?: (value: UsageDetail) => void;
}) {
  const t = useUiText();
  const timeZone = USAGE_TIME_ZONE, anchor = useRef(initialWindow?.end);
  const [sort, setSort] = useState("total"), [agentId, setAgent] = useState(""), [configuredModel, setModel] = useState(""), [taskId, setTask] = useState("");
  const [purpose, setPurpose] = useState<UsagePurpose | null>(initialPurpose || null), [stage, setStage] = useState<"overview" | "components" | "records">(initialPurpose ? "components" : "overview");
  const [cursor, setCursor] = useState<string | null>(null), [previous, setPrevious] = useState<(string | null)[]>([]);
  const [result, setResult] = useState<UsageDetail | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(false), [refresh, setRefresh] = useState(0);
  const requestRefresh = useRef(!initialSnapshot), snapshotRef = useRef<string | null>(initialSnapshot || null), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [stage]);
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (refreshSources: boolean) => {
      setLoading(true); setError(false);
      try {
        const value = await client.call<UsageDetail>("office.usage.detail", { schemaVersion: 2, ...(rolling ? { window: "rolling24h", ...(anchor.current ? { end: anchor.current } : {}) } : { date, timeZone }), sort, includeRecords: stage === "records", ...(purpose ? { purpose } : {}), ...(agentId ? { agentId } : {}), ...(configuredModel ? { configuredModel } : {}), ...(taskId ? { taskId } : {}), ...(cursor ? { cursor } : snapshotRef.current ? { snapshot: snapshotRef.current } : {}), refresh: refreshSources });
        if (!Array.isArray(value?.rows) || (rolling ? value.window?.kind !== "rolling24h" || anchor.current && value.window.end !== anchor.current : value.date !== date || value.timeZone !== timeZone) || !value.coverage || !value.purposeSummary) throw new Error("Unavailable detail");
        if (stopped) return;
        setResult(value); snapshotRef.current = value.snapshot;
        if (rolling && value.window) { anchor.current = value.window.end; onWindow?.(value); }
        // Only poll the small derived index while its initial backfill is active.
        // Pagination remains on its stable snapshot until the user refreshes.
        if (value.coverage.indexing && !cursor && stage === "overview") timer = setTimeout(() => { snapshotRef.current = null; void load(false); }, 2000);
      } catch { if (!stopped) setError(true); }
      finally { if (!stopped) setLoading(false); }
    };
    const refreshSources = requestRefresh.current; requestRefresh.current = false;
    void load(refreshSources);
    return () => { stopped = true; clearTimeout(timer); };
  }, [client, date, timeZone, rolling, onWindow, sort, agentId, configuredModel, taskId, cursor, refresh, purpose, stage]);
  const filtersChanged = (base = false) => { setCursor(null); setPrevious([]); if (base) snapshotRef.current = null; };
  const reload = () => { requestRefresh.current = true; filtersChanged(true); setRefresh(value => value + 1); };
  const selected = result?.purposeSummary.purposes.find(bucket => bucket.id === purpose);
  return <section className="ai-usage-detail-view" aria-label={t("Daily response detail")} aria-busy={loading}>
    <div className="ai-detail-heading"><button type="button" className="ai-coupon-apply" onClick={onBack}><ArrowLeft size={14} />{t("Back to daily usage")}</button>
      <button type="button" className="ai-icon-button" aria-label={t("Refresh response detail")} disabled={loading} onClick={reload}><RefreshCw size={16} /></button></div>
    <h1 ref={heading} tabIndex={-1}>{t(stage === "overview" ? "Usage by purpose" : stage === "records" ? "Observed requests and responses" : PURPOSE_LABELS[purpose || "unknown"])}</h1>
    <p className="ai-card-caption">{t("Only reported Office response records are included. Missing records and failed requests without usage are unknown, not zero.")}</p>
    <div className="ai-detail-totals">{!rolling ? <div><span>{t("Account date total")}: {date}</span><strong>{number(accountTokens)}</strong><small>{t("Provider account days are an independent reference. Office rolling totals use their own window.")}</small></div> : null}
      <div><span>{t("Office observed subtotal")}</span><strong>{error ? "—" : number(result?.purposeSummary.denominatorTokens)}</strong><small>{!rolling ? t("{date} · UTC 00:00 to next day 00:00 (end excluded)", { date }) : t("Last 24 complete hours")} · {t("Filtered, partial sum")}</small></div></div>
    {rolling && result?.window ? <UsageWindowRange value={result.window} /> : null}
    <div className="ai-detail-filters">
      {!rolling ? <label>{t("Date")}<input type="date" aria-label={t("Detail date")} value={date} onChange={event => { if (event.target.value) onDateChange(event.target.value); }} /></label> : null}
      {stage === "records" ? <label>{t("Sort by")}<select value={sort} onChange={event => { setSort(event.target.value); filtersChanged(); }}>{[["total", "Total tokens"], ["uncachedInput", "Uncached input"], ["input", "Input tokens"], ["output", "Output tokens"], ["time", "Newest first"]].map(([value, name]) => <option key={value} value={value}>{t(name)}</option>)}</select></label> : null}
      <label>{t("Office agent")}<select value={agentId} onChange={event => { setAgent(event.target.value); filtersChanged(true); }}><option value="">{t("All agents")}</option>{result?.filters.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
      <label>{t("Configured model")}<select value={configuredModel} onChange={event => { setModel(event.target.value); filtersChanged(true); }}><option value="">{t("All models")}</option>{result?.filters.configuredModels.map(model => <option key={model} value={model}>{model}</option>)}</select></label>
      <label>{t("Task")}<select value={taskId} onChange={event => { setTask(event.target.value); filtersChanged(true); }}><option value="">{t("All tasks")}</option><option value="unattributed">{t("Unattributed")}</option>{result?.filters.tasks.map(task => <option key={task.id} value={task.id}>{taskLabel(task) || `${t("Unavailable task")} · ${task.id}`}</option>)}</select></label>
    </div>
    {error ? <p role="alert" className="ai-notice">{t("Response detail is unavailable. Retry or return to the account chart.")}</p> : null}
    {loading ? <p role="status" className="ai-card-caption">{t("Loading response records…")}</p> : null}
    {result && !error ? <>
      <p className="ai-card-note" role="status">{result.coverage.indexing ? t("Indexing Office metadata in the background…") : t("{count} observed response records", { count: result.count })} · {t("{ready}/{known} known Office sources readable", { ready: result.coverage.readySources, known: result.coverage.knownSources })}</p>
      <p className="ai-card-note">{t("Office-only compatibility reader ({version}); internal format, partial coverage.", { version: result.coverage.supportedVersion })} {t("UTC dates retained from {date}.", { date: result.coverage.retainedFrom })}{result.coverage.indexedThrough ? ` ${t("Latest observed record: {time}", { time: new Date(result.coverage.indexedThrough).toLocaleString([], { timeZone }) })}` : ""}</p>
      {result.coverage.capacityLimited ? <p className="ai-notice">{t("Capacity eviction shortened the retained detail range.")}{result.coverage.retainedFromPartial ? <><br />{t("The first retained UTC day ({date}) is partial: indexed records before {time} are no longer retained.", { date: result.coverage.retainedFrom, time: new Date(result.coverage.retainedFromUtc + "T00:00:00Z").toLocaleString([], { timeZone }) })}</> : null}</p> : null}
      {result.coverage.unavailable || result.coverage.storageLimit || result.coverage.unsupportedSources || result.coverage.partialLines || Object.keys(result.coverage.knownGaps).length ? <p className="ai-notice">{t("Coverage has gaps; unavailable or unsupported sources are not counted as zero.")} {result.coverage.storageLimit ? t("Local index storage limit reached.") : ""}<br />{Object.entries(result.coverage.knownGaps).map(([reason, count]) => `${reason}: ${count}`).join(" · ")}{result.coverage.partialLines ? ` · ${t("Incomplete source lines")}: ${result.coverage.partialLines}` : ""}</p> : null}
      {result.windowPartial ? <p className="ai-notice">{t("Retention limits cut this window; the subtotal is partial.")}</p> : null}
      {result.outsideRetention ? <p className="ai-notice">{t("This date is outside the currently retained detail range (age or capacity limit).")}</p> : !result.count && !loading ? <p className="ai-unavailable">{t("No recoverable response records for this selection. This does not mean zero consumption.")}</p> : null}
      {stage === "overview" ? <AiPurposeSummary summary={result.purposeSummary} onSelect={id => { setPurpose(id); setStage("components"); filtersChanged(); }} /> : <>
        <button type="button" className="ai-coupon-apply" onClick={() => { setStage(stage === "records" ? "components" : "overview"); if (stage !== "records") setPurpose(null); filtersChanged(); }}>{t(stage === "records" ? "Back to composition" : "Back to purposes")}</button>
        {selected ? <PurposeComponents bucket={selected} denominator={result.purposeSummary.denominatorTokens} /> : null}
        {stage === "components" ? <button type="button" className="ai-coupon-apply" disabled={loading} onClick={() => { setStage("records"); filtersChanged(); }}>{t("View response records")}</button> : null}
      </>}
      {stage === "records" ? <>
        <div className="ai-response-list">{result.rows.map(row => <ResponseRow key={row.id} row={row} timeZone={timeZone} />)}</div>
        <nav className="ai-detail-pages" aria-label={t("Response pages")}><button type="button" className="ai-coupon-apply" disabled={loading || !previous.length} onClick={() => { setCursor(previous.at(-1) ?? null); setPrevious(value => value.slice(0, -1)); }}>{t("Previous page")}</button>
          <button type="button" className="ai-coupon-apply" disabled={loading || !result.nextCursor} onClick={() => { setPrevious(value => [...value, cursor]); setCursor(result.nextCursor); }}>{t("Next page")}</button></nav>
      </> : null}
    </> : null}
  </section>;
}
