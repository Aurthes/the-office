"use client";
import { useEffect, useState } from "react";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { useUiText } from "@/lib/i18n/ui-language";
import type { PurposeBucket, PurposeSummary, UsageDetail, UsagePurpose } from "./ai-center";

export const PURPOSE_LABELS: Record<UsagePurpose, string> = { chat_work: "Chat and user work", suggestion: "Gray suggestions", automation: "Scheduled work", operational_task: "Firefighter work", collaboration_mixed: "Collaboration-triggered work", mixed: "Mixed purposes", unknown: "Unknown purpose" };
export const tokenNumber = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
export function localUsageDate(timeZone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

export function AiPurposeSummary({ summary, onSelect }: { summary: PurposeSummary; onSelect: (purpose: UsagePurpose) => void }) {
  const t = useUiText();
  const notes: Record<string, string> = { origin: "Source/question identification is embedded in main responses; its token cost cannot be separated.", context_management: "Compaction has no reliable independent response linkage; its separate cost is unknown.", dictation: "Dictation audio tokens are not measured.", realtime_voice: "Voice-call audio tokens are not measured.", external_native: "Hidden native and external-tool AI usage is not fully observed.", company_planning: "Company planning uses an unsupported legacy backend route here; no token consumption is inferred." };
  return <div className="ai-purpose-overview">
    <h2>{t("Usage by purpose")}</h2>
    <p className="ai-card-caption">{t("Shares use S = {tokens} measured tokens across all purposes in this date and filter snapshot.", { tokens: tokenNumber(summary.denominatorTokens) })}<br />{t("This is the observed subset, not all account consumption. Unknown usage is excluded from S.")}</p>
    <div className="ai-purpose-grid">{[...summary.purposes].sort((a, b) => (b.knownTokens ?? -1) - (a.knownTokens ?? -1)).map(bucket => <button type="button" className="ai-purpose-card" key={bucket.id} data-purpose={bucket.id} aria-label={t(PURPOSE_LABELS[bucket.id])} onClick={() => onSelect(bucket.id)}>
      <b>{t(PURPOSE_LABELS[bucket.id])}</b><strong>{tokenNumber(bucket.knownTokens)} <small>{t("tokens")}</small></strong>
      <span>{bucket.share == null ? "—" : `${(bucket.share * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`} · {t("{count} measured responses", { count: bucket.measuredResponses })}</span>
      <small>{t("Average {tokens} tokens / measured response", { tokens: tokenNumber(bucket.meanTokens) })}</small>
      {bucket.id === "collaboration_mixed" ? <small>{t("Includes task execution; pure coordination is not separated.")}</small> : null}
      {bucket.id === "chat_work" ? <small>{t("Includes embedded reasoning, source identification and tools.")}</small> : null}
    </button>)}</div>
    <p className="ai-card-note">{t("{count} responses have unknown purpose; {missing} observed results lack total usage.", { count: summary.unknownPurposeResponses, missing: summary.unknownUsageResults })}{summary.purposesRecordedFrom ? ` ${t("Purpose recording started {time}; older records stay unknown.", { time: new Date(summary.purposesRecordedFrom).toLocaleString() })}` : ""}</p>
    <div className="ai-purpose-unmeasured">{summary.unmeasured.map(item => <p key={item.id}><strong>—</strong> {t(notes[item.id] || "Token usage is not measured.")}</p>)}</div>
  </div>;
}

export function PurposeComponents({ bucket, denominator }: { bucket: PurposeBucket; denominator: number | null }) {
  const t = useUiText();
  const fields = [["input", "Input tokens"], ["cachedInput", "Cached input"], ["uncachedInput", "Uncached input"], ["output", "Output tokens"], ["reasoningOutput", "Reasoning output"], ["otherOutput", "Other output"]] as const;
  return <section className="ai-purpose-components" aria-label={t("Purpose composition")}>
    <h2>{t(PURPOSE_LABELS[bucket.id])}</h2>
    <p>{t("{tokens} measured tokens · {count} measured responses", { tokens: tokenNumber(bucket.knownTokens), count: bucket.measuredResponses })}</p>
    <p className="ai-card-caption">{t("The share denominator stays S = {tokens} across all purposes.", { tokens: tokenNumber(denominator) })}{bucket.id === "collaboration_mixed" ? ` ${t("Includes task execution; pure coordination is not separated.")}` : ""}</p>
    <p className="ai-card-note">{t("Selecting a purpose keeps this snapshot. Refresh to include newer records.")}</p>
    <dl className="ai-response-numbers">{fields.map(([field, name]) => <div key={field}><dt>{t(name)}</dt><dd>{tokenNumber(bucket.components[field].knownSubtotal)}</dd><small>{t("{known} reported / {unknown} unknown responses", { known: bucket.components[field].reportedRows, unknown: bucket.components[field].unknownRows })}</small></div>)}</dl>
    <p className="ai-card-note">{t("Values are known subtotals. Cache is part of input; reasoning is part of output. Missing fields are not zero.")}</p>
    <p className="ai-notice">{t("New user text, history, instructions and tool context do not have separate exact token counts in this source.")}</p>
  </section>;
}

export function AiPurposePreview({ client, refresh, onSelect }: { client: Pick<GatewayClient, "call">; refresh: number; onSelect: (date: string, purpose: UsagePurpose, snapshot: string) => void }) {
  const t = useUiText(), [value, setValue] = useState<UsageDetail | null>(null), [failed, setFailed] = useState(false);
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const date = localUsageDate(timeZone);
  useEffect(() => {
    let stopped = false, pending = false, timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (refreshSources: boolean) => {
      if (stopped || pending) return;
      pending = true;
      try {
        const result = await client.call<UsageDetail>("office.usage.detail", { date, timeZone, includeRecords: false, refresh: refreshSources });
        if (!result?.purposeSummary || result.date !== date) throw new Error("Unavailable overview");
        if (!stopped) { setValue(result); setFailed(false); clearTimeout(timer); if (result.coverage.indexing) timer = setTimeout(() => void load(false), 2000); }
      } catch { if (!stopped) setFailed(true); }
      finally { pending = false; }
    };
    void load(true);
    const interval = setInterval(() => { if (document.visibilityState === "visible") void load(false); }, 60000);
    return () => { stopped = true; clearTimeout(timer); clearInterval(interval); };
  }, [client, date, timeZone, refresh]);
  return <section className="ai-card ai-purpose-preview" aria-label={t("Today's usage by purpose")}>
    <p className="ai-card-caption">{date} · {timeZone}</p>
    {failed ? <p className="ai-notice">{t("Purpose usage is unavailable. The account chart remains available.")}</p> : value ? <>
      <AiPurposeSummary summary={value.purposeSummary} onSelect={purpose => onSelect(date, purpose, value.snapshot)} />
      {value.coverage.unavailable || value.coverage.storageLimit || value.coverage.unsupportedSources || Object.keys(value.coverage.knownGaps).length ? <p className="ai-notice">{t("Coverage has gaps; unavailable or unsupported sources are not counted as zero.")}</p> : null}
      {value.coverage.indexing ? <p role="status">{t("Indexing Office metadata in the background…")}</p> : null}
    </> : <p role="status">{t("Loading purpose usage…")}</p>}
  </section>;
}
