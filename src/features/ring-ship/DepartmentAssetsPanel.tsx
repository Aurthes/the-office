"use client";
import { useId, useState } from "react";
import { ASSET_KINDS, ASSET_STATUSES, ASSET_LIMITS, type DepartmentAsset } from "@/lib/office/department-assets";
import { SessionMarkdown } from "@/features/office/components/SessionMarkdown";
import { useUiText } from "@/lib/i18n/ui-language";
const kindLabels = { guideline: "Guidelines", workflow: "Workflows", tool: "Tools" };
const statusLabels = { active: "Active", draft: "Draft", deprecated: "Deprecated" };
const empty = (): DepartmentAsset => ({ kind: "tool", name: "", summary: "", instructions: "", source: "", version: "", status: "draft" });
type Save = (departmentId: string, assetId: string, entry: DepartmentAsset) => Promise<void>;
function AssetCard({ id, entry, edit, deprecate, busy }: { id: string; entry: DepartmentAsset; edit?: () => void; deprecate?: () => void; busy: boolean }) {
  const t = useUiText(), [open, setOpen] = useState(false);
  return <details className="department-asset" data-asset-id={id} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><strong>{entry.name}</strong><small>{t(statusLabels[entry.status])} · {entry.version}</small></summary>
    <p>{entry.summary}</p>
    {open ? <div className="department-asset-body"><SessionMarkdown content={entry.instructions} /><p>{t("Source")}: {/^https?:\/\//.test(entry.source) ? <a href={entry.source} target="_blank" rel="noopener noreferrer">{entry.source}</a> : <code>{entry.source}</code>}</p>
      {edit ? <div className="department-actions"><button type="button" disabled={busy} onClick={edit}>{t("Edit asset")}</button>{entry.status !== "deprecated" ? <button type="button" disabled={busy} onClick={deprecate}>{t("Deprecate asset")}</button> : null}</div> : null}
    </div> : null}
  </details>;
}
export function DepartmentAssetsPanel({ departmentId, entries, save }: { departmentId: string; entries: Record<string, DepartmentAsset>; save?: Save }) {
  const t = useUiText(), formId = useId();
  const [draft, setDraft] = useState<DepartmentAsset | null>(null), [assetId, setAssetId] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const persist = async (id: string, entry: DepartmentAsset) => {
    if (busy || !save) return;
    setBusy(true); setError("");
    try { await save(departmentId, id, entry); setDraft(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save department asset.")); }
    finally { setBusy(false); }
  };
  return <section className="department-assets" aria-label={t("Department assets")}>
    <header><h2>{t("Department assets")}</h2>{save ? <button type="button" disabled={busy} onClick={() => { setAssetId(crypto.randomUUID()); setDraft(empty()); setError(""); }}>{t("Add asset")}</button> : null}</header>
    {error ? <p role="alert">{error}</p> : null}
    {draft ? <form className="department-asset-form" onSubmit={event => { event.preventDefault(); void persist(assetId, draft); }}>
      <label htmlFor={formId+"kind"}>{t("Asset type")}</label><select id={formId+"kind"} value={draft.kind} disabled={busy} onChange={event => setDraft({ ...draft, kind: event.target.value as DepartmentAsset["kind"] })}>{ASSET_KINDS.map(kind => <option key={kind} value={kind}>{t(kindLabels[kind as keyof typeof kindLabels])}</option>)}</select>
      {(["name", "summary", "instructions", "source", "version"] as const).map(field => <label key={field}>{t({ name: "Asset name", summary: "When to use", instructions: "Usage, scope and limitations", source: "Source", version: "Version" }[field])}
        {field === "instructions" || field === "summary" ? <textarea required maxLength={ASSET_LIMITS[field]} rows={field === "instructions" ? 9 : 3} value={draft[field]} disabled={busy} onChange={event => setDraft({ ...draft, [field]: event.target.value })} /> : <input required maxLength={ASSET_LIMITS[field]} value={draft[field]} disabled={busy} onChange={event => setDraft({ ...draft, [field]: event.target.value })} />}
      </label>)}
      <label htmlFor={formId+"status"}>{t("Asset status")}</label><select id={formId+"status"} value={draft.status} disabled={busy} onChange={event => setDraft({ ...draft, status: event.target.value as DepartmentAsset["status"] })}>{ASSET_STATUSES.map(status => <option key={status} value={status}>{t(statusLabels[status as keyof typeof statusLabels])}</option>)}</select>
      <div className="department-actions"><button type="button" disabled={busy} onClick={() => { setDraft(null); setError(""); }}>{t("Cancel")}</button><button type="submit" disabled={busy}>{t(busy ? "Saving…" : "Save asset")}</button></div>
    </form> : null}
    {ASSET_KINDS.map(kind => {
      const rows = Object.entries(entries).filter(([, entry]) => entry.kind === kind).sort(([a], [b]) => a.localeCompare(b));
      return <section key={kind} aria-label={t(kindLabels[kind as keyof typeof kindLabels])}><h3>{t(kindLabels[kind as keyof typeof kindLabels])} · {rows.length}</h3>
        {rows.length ? rows.map(([id, entry]) => <AssetCard key={id} id={id} entry={entry} busy={busy} edit={save ? () => { setAssetId(id); setDraft({ ...entry }); setError(""); } : undefined} deprecate={save ? () => void persist(id, { ...entry, status: "deprecated" }) : undefined} />) : <p>{t("No assets registered yet.")}</p>}
      </section>;
    })}
  </section>;
}
