"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { useUiText } from "@/lib/i18n/ui-language";
import type { ObservedResponse, UsageDetail, UsageTaskLabel } from "./ai-center";

const number = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat().format(value);
const taskLabel = (task: UsageTaskLabel | null) => task ? [task.code, task.title].filter(Boolean).join(" · ") : "";
function ResponseRow({ row, timeZone }: { row: ObservedResponse; timeZone: string }) {
  const t = useUiText(), u = row.usage;
  const parts = [["Cached input", u.cachedInput], ["Uncached input", u.uncachedInput], ["Reasoning output", u.reasoningOutput], ["Other output", u.otherOutput]] as const;
  return <details className="ai-response">
    <summary><span><b>{row.agentName}</b><small>{new Date(row.observedAt).toLocaleTimeString([], { timeZone })} · {row.configuredModel || t("Unknown")}</small></span>
      <span className="ai-response-total"><b>{number(u.total)}</b><small>{t("tokens")}</small></span></summary>
    <div className="ai-response-body">
      <div className="ai-response-parts" aria-hidden="true">{parts.map(([name, value], index) => <i key={name} data-part={index} style={{ width: `${u.total ? value / u.total * 100 : 0}%` }} />)}</div>
      <dl className="ai-response-numbers">{parts.map(([name, value]) => <div key={name}><dt>{t(name)}</dt><dd>{number(value)}</dd></div>)}</dl>
      <p className="ai-card-caption">{t("Input {input} + output {output} = total {total}", { input: number(u.input), output: number(u.output), total: number(u.total) })}</p>
      {u.cacheWriteInput ? <p className="ai-card-note">{t("Reported cache-write input: {count}. Not added to the total.", { count: number(u.cacheWriteInput) })}</p> : null}
      <dl className="ai-response-meta">
        <dt>{t("Response ID")}</dt><dd>{row.responseId}</dd>
        <dt>{t("Office agent")}</dt><dd>{row.agentName} · {row.officeAgentId}</dd>
        <dt>{t("Turn ID")}</dt><dd>{row.turnId} · {t("{count} observed responses in this turn", { count: row.sameTurnResponses })}</dd>
        <dt>{t("Configured model")}</dt><dd>{row.configuredModel || t("Unknown")} / {row.configuredEffort || t("Unknown")} · {t(row.modelBasis === "turnContext" ? "Recorded turn context" : "Unknown")}</dd>
        <dt>{t("Actual model / response status")}</dt><dd>{t("Unknown / unknown — not reported by this source")}</dd>
        <dt>{t("Task / question")}</dt><dd>{taskLabel(row.task) || t(row.taskId ? "Unavailable task" : "Unattributed")}{row.phaseId ? ` / ${row.phaseId}` : ""}{row.questionIds.length ? ` · ${row.questionIds.join(", ")}` : ""}</dd>
        {row.taskId ? <><dt>{t("Task ID")}</dt><dd>{row.taskId}</dd></> : null}
      </dl>
      {row.attributionBasis === "turnDispatch" ? <p className="ai-card-note">{t("Task/question IDs were captured at turn dispatch, not at each model request. Later steering may change the context.")}</p> : <p className="ai-card-note">{t("No historical task binding. Current owners and tasks are not used to guess it.")}</p>}
      {row.previousObservedInput ? <p className="ai-card-note">{t("Input changed by {change} from the previous observed response in this turn ({input} input tokens). This comparison does not explain the cause.", { change: `${row.previousObservedInput.change >= 0 ? "+" : ""}${number(row.previousObservedInput.change)}`, input: number(row.previousObservedInput.input) })}<br />{row.previousObservedInput.responseId}</p> : null}
      {row.conflict ? <p role="alert" className="ai-notice">{t("Conflicting source records: first value retained, not added twice.")}</p> : null}
    </div>
  </details>;
}

export function AiUsageDetail({ date, accountTokens, client, onBack, onDateChange }: {
  date: string; accountTokens: number | null; client: Pick<GatewayClient, "call">; onBack: () => void; onDateChange: (date: string) => void;
}) {
  const t = useUiText();
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [sort, setSort] = useState("total"), [agentId, setAgent] = useState(""), [configuredModel, setModel] = useState(""), [taskId, setTask] = useState("");
  const [cursor, setCursor] = useState<string | null>(null), [previous, setPrevious] = useState<(string | null)[]>([]);
  const [result, setResult] = useState<UsageDetail | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(false), [refresh, setRefresh] = useState(0);
  const requestRefresh = useRef(true), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (refreshSources: boolean) => {
      setLoading(true); setError(false);
      try {
        const value = await client.call<UsageDetail>("office.usage.detail", { date, timeZone, sort, ...(agentId ? { agentId } : {}), ...(configuredModel ? { configuredModel } : {}), ...(taskId ? { taskId } : {}), ...(cursor ? { cursor } : {}), refresh: refreshSources });
        if (!Array.isArray(value?.rows) || value.date !== date || value.timeZone !== timeZone || !value.coverage) throw new Error("Unavailable detail");
        if (stopped) return;
        setResult(value);
        // Only poll the small derived index while its initial backfill is active.
        // Pagination remains on its stable snapshot until the user refreshes.
        if (value.coverage.indexing && !cursor) timer = setTimeout(() => void load(false), 2000);
      } catch { if (!stopped) setError(true); }
      finally { if (!stopped) setLoading(false); }
    };
    const refreshSources = requestRefresh.current; requestRefresh.current = false;
    void load(refreshSources);
    return () => { stopped = true; clearTimeout(timer); };
  }, [client, date, timeZone, sort, agentId, configuredModel, taskId, cursor, refresh]);
  const filtersChanged = () => { setCursor(null); setPrevious([]); };
  const reload = () => { requestRefresh.current = true; filtersChanged(); setRefresh(value => value + 1); };
  return <section className="ai-usage-detail-view" aria-label={t("Daily response detail")} aria-busy={loading}>
    <div className="ai-detail-heading"><button type="button" className="ai-coupon-apply" onClick={onBack}><ArrowLeft size={14} />{t("Back to daily usage")}</button>
      <button type="button" className="ai-icon-button" aria-label={t("Refresh response detail")} disabled={loading} onClick={reload}><RefreshCw size={16} /></button></div>
    <h1 ref={heading} tabIndex={-1}>{t("Observed model responses")}</h1>
    <p className="ai-card-caption">{t("Only reported Office response records are included. Missing records and failed requests without usage are unknown, not zero.")}</p>
    <div className="ai-detail-totals"><div><span>{t("Account date total")}: {date}</span><strong>{number(accountTokens)}</strong><small>{t("Account day timezone is not provided; these totals are not directly comparable.")}</small></div>
      <div><span>{t("Office observed subtotal")}</span><strong>{error ? "—" : number(result?.totals?.total)}</strong><small>{date} · {timeZone} · {t("Filtered, partial sum")}</small></div></div>
    <div className="ai-detail-filters">
      <label>{t("Date")}<input type="date" aria-label={t("Detail date")} value={date} onChange={event => { if (event.target.value) onDateChange(event.target.value); }} /></label>
      <label>{t("Sort by")}<select value={sort} onChange={event => { setSort(event.target.value); filtersChanged(); }}>{[["total", "Total tokens"], ["uncachedInput", "Uncached input"], ["input", "Input tokens"], ["output", "Output tokens"], ["time", "Newest first"]].map(([value, name]) => <option key={value} value={value}>{t(name)}</option>)}</select></label>
      <label>{t("Office agent")}<select value={agentId} onChange={event => { setAgent(event.target.value); filtersChanged(); }}><option value="">{t("All agents")}</option>{result?.filters.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
      <label>{t("Configured model")}<select value={configuredModel} onChange={event => { setModel(event.target.value); filtersChanged(); }}><option value="">{t("All models")}</option>{result?.filters.configuredModels.map(model => <option key={model} value={model}>{model}</option>)}</select></label>
      <label>{t("Task")}<select value={taskId} onChange={event => { setTask(event.target.value); filtersChanged(); }}><option value="">{t("All tasks")}</option><option value="unattributed">{t("Unattributed")}</option>{result?.filters.tasks.map(task => <option key={task.id} value={task.id}>{taskLabel(task) || `${t("Unavailable task")} · ${task.id}`}</option>)}</select></label>
    </div>
    {error ? <p role="alert" className="ai-notice">{t("Response detail is unavailable. Retry or return to the account chart.")}</p> : null}
    {loading ? <p role="status" className="ai-card-caption">{t("Loading response records…")}</p> : null}
    {result && !error ? <>
      <p className="ai-card-note" role="status">{result.coverage.indexing ? t("Indexing Office metadata in the background…") : t("{count} observed response records", { count: result.count })} · {t("{ready}/{known} known Office sources readable", { ready: result.coverage.readySources, known: result.coverage.knownSources })}</p>
      <p className="ai-card-note">{t("Office-only compatibility reader ({version}); internal format, partial coverage.", { version: result.coverage.supportedVersion })} {t("Local dates retained from {date}.", { date: result.coverage.retainedFrom })}{result.coverage.indexedThrough ? ` ${t("Latest observed record: {time}", { time: new Date(result.coverage.indexedThrough).toLocaleString([], { timeZone }) })}` : ""}</p>
      {result.coverage.capacityLimited ? <p className="ai-notice">{t("Capacity eviction shortened the retained detail range.")}{result.coverage.retainedFromPartial ? <><br />{t("The first retained local day ({date}) is partial: indexed records before {time} are no longer retained.", { date: result.coverage.retainedFrom, time: new Date(result.coverage.retainedFromUtc + "T00:00:00Z").toLocaleString([], { timeZone }) })}</> : null}</p> : null}
      {result.coverage.unavailable || result.coverage.storageLimit || result.coverage.unsupportedSources || result.coverage.partialLines || Object.keys(result.coverage.knownGaps).length ? <p className="ai-notice">{t("Coverage has gaps; unavailable or unsupported sources are not counted as zero.")} {result.coverage.storageLimit ? t("Local index storage limit reached.") : ""}<br />{Object.entries(result.coverage.knownGaps).map(([reason, count]) => `${reason}: ${count}`).join(" · ")}{result.coverage.partialLines ? ` · ${t("Incomplete source lines")}: ${result.coverage.partialLines}` : ""}</p> : null}
      {result.outsideRetention ? <p className="ai-notice">{t("This date is outside the currently retained detail range (age or capacity limit).")}</p> : !result.rows.length && !loading ? <p className="ai-unavailable">{t("No recoverable response records for this selection. This does not mean zero consumption.")}</p> : null}
      <div className="ai-response-list">{result.rows.map(row => <ResponseRow key={row.id} row={row} timeZone={timeZone} />)}</div>
      <nav className="ai-detail-pages" aria-label={t("Response pages")}><button type="button" className="ai-coupon-apply" disabled={loading || !previous.length} onClick={() => { setCursor(previous.at(-1) ?? null); setPrevious(value => value.slice(0, -1)); }}>{t("Previous page")}</button>
        <button type="button" className="ai-coupon-apply" disabled={loading || !result.nextCursor} onClick={() => { setPrevious(value => [...value, cursor]); setCursor(result.nextCursor); }}>{t("Next page")}</button></nav>
    </> : null}
  </section>;
}
