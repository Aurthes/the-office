"use client";
import { useState } from "react";
import { useUiText } from "@/lib/i18n/ui-language";
import { apiCostLabel, topContributors, type UsageDetail } from "./ai-center";
import { PURPOSE_LABELS, tokenNumber } from "./AiPurposeSummary";

export function AiTokenBreakdown({ value, onSelect, onRecords }: { value: UsageDetail; onSelect: (dimension: "agents" | "tasks" | "sources", id: string) => void; onRecords: () => void }) {
  const t = useUiText(), [dimension, setDimension] = useState<"agents" | "tasks" | "sources">("tasks"), [order, setOrder] = useState<"tokens" | "cost">("tokens"), [all, setAll] = useState(false);
  const b = value.breakdown;
  if (!b) return <p className="ai-notice" role="status">{t("Token breakdown is unavailable on this gateway. Refresh after updating it.")}</p>;
  const c = b.measuredComponents, n = value.purposeSummary.measuredResponses, cost = b.cost;
  const complete = (fields: (keyof typeof c)[]) => fields.every(field => c[field].unknownRows === 0 && c[field].reportedRows === n && c[field].knownSubtotal !== null);
  const part = (field: keyof typeof c, label: string) => <div key={field}><dt>{t(label)}</dt><dd>{tokenNumber(c[field].knownSubtotal)}</dd><small>{t("{known} reported / {unknown} unknown responses", { known: c[field].reportedRows, unknown: c[field].unknownRows })}</small></div>;
  return <div className="ai-token-breakdown">
    <section className="ai-breakdown-cost" aria-label={t("Standard API equivalent cost")}><h2>{t("Standard API equivalent cost")}</h2><strong>{apiCostLabel(cost)}</strong>
      <p>{t("Estimated portion only · {priced} priced / {unpriced} unpriced responses", { priced: cost.pointResponses + cost.rangeResponses, unpriced: cost.unpricedResponses })}</p>
      <p className="ai-card-caption">{t("{priced} known tokens priced; {unpriced} known tokens unpriced; {unknown} results lack total usage.", { priced: tokenNumber(cost.estimatedKnownTokens), unpriced: tokenNumber(cost.unpricedKnownTokens), unknown: cost.unknownUsageResults })}</p>
      <p className="ai-card-caption">{t("USD reference for the recorded configured model. This is not your subscription bill or quota consumption.")}</p>
      {cost.rangeResponses ? <p className="ai-card-note">{t("Cache-write quantity or retention is unverified. The range includes possible writes, not an assumed zero.")}</p> : null}
    </section>
    <section aria-label={t("Token composition")}><h2>{t("Token composition")}</h2>
      <p className="ai-card-caption">{t("Only responses with known total usage form S = {tokens}.", { tokens: tokenNumber(b.denominatorTokens) })}</p>
      {n > 0 && complete(["input", "output"]) && c.input.knownSubtotal! + c.output.knownSubtotal! === b.denominatorTokens && b.denominatorTokens! > 0 ? <div className="ai-composition-bar" aria-label={t("Input and output share")}>
        <span style={{ flex: c.input.knownSubtotal! }}>{t("Input tokens")} {(c.input.knownSubtotal! / b.denominatorTokens! * 100).toFixed(1)}%</span><span style={{ flex: c.output.knownSubtotal! }}>{t("Output tokens")} {(c.output.knownSubtotal! / b.denominatorTokens! * 100).toFixed(1)}%</span></div> : null}
      <div className="ai-composition-grid"><section><h3>{t("Input tokens")}</h3><dl className="ai-response-numbers">{part("input", "Input tokens")}{part("cachedInput", "Cached input")}{part("uncachedInput", "Uncached input")}</dl>
        <p className="ai-card-note">{t("Cached and uncached are parts of input. Uncached input may include cache writes.")}</p>
        {complete(["input", "cachedInput", "uncachedInput"]) && c.input.knownSubtotal! > 0 ? <progress aria-label={t("Cached share of input")} value={c.cachedInput.knownSubtotal!} max={c.input.knownSubtotal!} /> : null}</section>
        <section><h3>{t("Output tokens")}</h3><dl className="ai-response-numbers">{part("output", "Output tokens")}{part("reasoningOutput", "Reasoning output")}{part("otherOutput", "Other output")}</dl>
          <p className="ai-card-note">{t("Reasoning is already part of output; it is not added or charged twice.")}</p>
          {complete(["output", "reasoningOutput", "otherOutput"]) && c.output.knownSubtotal! > 0 ? <progress aria-label={t("Reasoning share of output")} value={c.reasoningOutput.knownSubtotal!} max={c.output.knownSubtotal!} /> : null}</section></div>
    </section>
    <section aria-label={t("Usage contributors")}><h2>{t("Where the observed usage went")}</h2>
      <div className="ai-breakdown-actions" role="group" aria-label={t("Group by")}>{(["tasks", "agents", "sources"] as const).map(key => <button type="button" key={key} className="ai-coupon-apply" aria-pressed={dimension === key} onClick={() => { setDimension(key); setAll(false); }}>{t(({ tasks: "Task", agents: "Office agent", sources: "Trigger source" })[key])}</button>)}
        <label>{t("Group order")}<select value={order} onChange={event => setOrder(event.target.value as typeof order)}><option value="tokens">{t("Total tokens")}</option><option value="cost">{t("API cost lower bound")}</option></select></label></div>
      <p className="ai-card-note">{t("Each view covers the same snapshot. Do not add Task, Agent and Source totals together. Overlapping cost ranges do not establish a ranking.")}</p>
      <div className="ai-contributors">{topContributors(b.contributors[dimension], order, all).map(row => <div key={row.id} className="ai-contributor"><button type="button" className="ai-contributor-name" disabled={row.id === "other"} onClick={() => onSelect(dimension, row.id)}>{row.id === "other" || row.id === "unattributed" ? t(row.name) : dimension === "sources" ? t(PURPOSE_LABELS[row.id as keyof typeof PURPOSE_LABELS] || "Unknown purpose") : row.name}</button>
        <span><b>{tokenNumber(row.knownTokens)}</b> {t("tokens")}<small>{t("{count} measured responses", { count: row.measuredResponses })} · {t("{count} unknown usage", { count: row.unknownUsageResults })}</small></span>
        <span>{apiCostLabel(row.cost)}<small>{t("{count} unpriced responses", { count: row.cost.unpricedResponses })}</small></span></div>)}</div>
      {b.contributors[dimension].length > 5 ? <button type="button" className="ai-coupon-apply" onClick={() => setAll(!all)}>{t(all ? "Show top 5" : "Show all groups")}</button> : null}
    </section>
    <p className="ai-notice">{t("Work versus communication: not collected. Trigger sources include execution and cannot prove a pure coordination cost.")}</p>
    <button type="button" className="ai-coupon-apply" onClick={onRecords}>{t("View response records")}</button>
    <details className="ai-breakdown-boundaries"><summary>{t("Coverage, pricing and measurement limits")}</summary>
      <p>{t("New user text, history, instructions and tool context do not have separate exact token counts in this source.")}</p>
      <p>{t("Cache-write zero may be a native default, not an explicit upstream zero. Costs use per-response input size before aggregation.")}</p>
      <p>{b.pricing.version} · {t("Checked {date}", { date: b.pricing.checkedAt })} · {t(b.pricing.basis)}</p>
      {b.pricing.models.map(model => <p key={model.id}>{model.id} · USD / 1M: {t("Input tokens")} {model.input}, {t("Cached input")} {model.cachedInput}, 30m {model.write30m}, 12h {model.write12h}, {t("Output tokens")} {model.output}. {t("Above {threshold} input tokens per request: input/cache ×{input}, output ×{output}.", { threshold: model.longContextThreshold, input: model.longInputMultiplier, output: model.longOutputMultiplier })}</p>)}
      <p>{t("Unknown models are not matched to aliases. External tools, storage and compute are excluded.")}</p>
      <p>{b.pricing.sources.map((url, i) => <a key={url} href={url} target="_blank" rel="noreferrer">{t("Official source")} {i + 1} </a>)}</p>
    </details>
  </div>;
}
