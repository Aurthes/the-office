"use client";
import { useCallback, useEffect, useState } from "react";
import type { SessionClient } from "./SessionControls";
import { useUiText } from "@/lib/i18n/ui-language";

type Template = { id: string; name: string; model: string; effort: string | null; accessMode: string };
type Catalog = { templates: Template[]; defaults: Record<string, string> };
type Choices = { models: { id: string; name: string; efforts: string[]; defaultEffort: string }[]; accessModes: { id: string; name: string; allowed: boolean }[] };
const DEFAULT = "__department__", FRESH = "__fresh__";

export function RecruitmentTemplates({ client, projectId, workspace, selected, onSelect, disabled, onBusy }: {
  client: SessionClient; projectId: string | null; workspace?: string; selected: string | null | undefined;
  onSelect: (id: string | null | undefined) => void; disabled: boolean; onBusy: (busy: boolean) => void;
}) {
  const t = useUiText(), [catalog, setCatalog] = useState<Catalog>({ templates: [], defaults: {} });
  const [choices, setChoices] = useState<Choices | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [draft, setDraft] = useState<Omit<Template, "id"> & { id?: string } | null>(null);
  const [confirmFullAccess, setConfirmFullAccess] = useState(false), [attempt, setAttempt] = useState(0);
  const ready = !!projectId || !!workspace, key = projectId ?? "open-workspace";
  const load = useCallback(async () => {
    const [saved, available] = await Promise.all([client.call("recruitment.list", {}), client.call("recruitment.choices", { projectId, ...(projectId ? {} : { workspace }) })]);
    const data = saved as Catalog, options = available as Choices;
    if (!Array.isArray(data.templates) || !data.defaults || !Array.isArray(options.models) || !Array.isArray(options.accessModes)) throw new Error("Could not load recruitment templates.");
    return { data, options };
  }, [client, projectId, workspace]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    void load().then(({ data, options }) => { if (active) { setCatalog(data); setChoices(options); setError(""); } })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Could not load recruitment templates."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ready, load, attempt]);
  const mutate = async (method: string, params: object, saved: (result: unknown) => void = () => {}) => {
    if (disabled || busy) return;
    setBusy(true); onBusy(true); setError("");
    let applied = false;
    try {
      const result = await client.call(method, { ...params, requestId: crypto.randomUUID() });
      applied = true; saved(result);
      const { data, options } = await load(); setCatalog(data); setChoices(options);
    } catch (cause) { setError(applied ? "Saved, but recruitment options could not be refreshed. Reload before saving again." : cause instanceof Error ? cause.message : "Could not save recruitment template."); }
    finally { setBusy(false); onBusy(false); }
  };
  const value = selected === undefined ? DEFAULT : selected === null ? FRESH : selected;
  const selectedId = selected === undefined ? catalog.defaults[key] : selected;
  const template = catalog.templates.find(row => row.id === selectedId);
  const model = choices?.models.find(row => row.id === draft?.model), access = choices?.accessModes.find(row => row.id === draft?.accessMode);
  const locked = disabled || busy;
  const field = "mt-1 min-h-10 w-full min-w-0 rounded border border-white/20 bg-[#152b35] px-2 text-xs text-white";
  if (!ready) return <p className="text-xs text-white/60">{t("Choose a working folder to load recruitment templates.")}</p>;
  return <section className="space-y-2 rounded border border-white/15 p-2" aria-label={t("Recruitment configuration")}>
    <label className="block text-xs">{t("Recruitment template")}<select aria-label={t("Recruitment template")} value={value} disabled={locked} className={field} onChange={event => { onSelect(event.target.value === DEFAULT ? undefined : event.target.value === FRESH ? null : event.target.value); setDraft(null); setConfirmFullAccess(false); }}>
      <option value={DEFAULT}>{t("Department default")}{loading ? ` · ${t("Loading…")}` : !choices ? ` · ${t("Unavailable")}` : catalog.defaults[key] ? ` · ${catalog.templates.find(row => row.id === catalog.defaults[key])?.name || t("Unavailable")}` : ` · ${t("Fresh defaults")}`}</option>
      <option value={FRESH}>{t("Fresh defaults")}</option>
      {selected && !catalog.templates.some(row => row.id === selected) ? <option value={selected}>{t("Unavailable")}</option> : null}
      {catalog.templates.map(row => <option value={row.id} key={row.id}>{row.name}</option>)}
    </select></label>
    {template ? <p className="break-words text-xs text-white/70" aria-label={t("Template configuration")}>{template.model} · {template.effort || t("Default")} · {t(choices?.accessModes.find(row => row.id === template.accessMode)?.name || template.accessMode)}</p> : !loading && choices ? <p className="text-xs text-white/60">{t(selectedId ? "Recruitment template is unavailable. Choose another template or Fresh defaults." : "Fresh session with default settings. No conversation is copied.")}</p> : null}
    {loading ? <p role="status" className="text-xs">{t("Loading recruitment templates…")}</p> : null}
    {error ? <p role="alert" className="break-words text-xs text-amber-100">{t(error)} <button type="button" className="underline" disabled={locked} onClick={() => { setLoading(true); setAttempt(value => value + 1); }}>{t("Retry options")}</button></p> : null}
    <details><summary className="cursor-pointer text-xs">{t("Manage recruitment templates")}</summary>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <button type="button" disabled={locked || !choices?.models.length} className="min-h-9 underline" onClick={() => { const first = choices!.models[0]; setDraft({ name: "", model: first.id, effort: first.defaultEffort || null, accessMode: ":workspace" }); setConfirmFullAccess(false); }}>{t("New template")}</button>
        {template ? <><button type="button" disabled={locked} className="min-h-9 underline" onClick={() => { setDraft({ ...template }); setConfirmFullAccess(false); }}>{t("Edit template")}</button>
          <button type="button" disabled={locked} className="min-h-9 underline" onClick={() => void mutate("recruitment.delete", { id: template.id }, () => { onSelect(undefined); setDraft(null); })}>{t("Delete template")}</button>
          <button type="button" disabled={locked || catalog.defaults[key] === template.id} className="min-h-9 underline" onClick={() => void mutate("recruitment.default", { projectId, templateId: template.id })}>{t("Set department default")}</button></> : null}
        {catalog.defaults[key] ? <button type="button" disabled={locked} className="min-h-9 underline" onClick={() => void mutate("recruitment.default", { projectId, templateId: null })}>{t("Clear department default")}</button> : null}
      </div>
      {draft ? <fieldset disabled={locked} className="mt-2 min-w-0 space-y-2" onKeyDown={event => {
        // Template inputs live inside Recruit's form. Enter must not recruit an
        // employee while editing a template; Save remains a keyboard button.
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
      }}>
        <label className="block text-xs">{t("Template name")}<input aria-label={t("Template name")} maxLength={120} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} className={field} /></label>
        <label className="block text-xs">{t("Model")}<select aria-label={t("Template model")} value={draft.model} onChange={event => { const next = choices?.models.find(row => row.id === event.target.value); setDraft({ ...draft, model: event.target.value, effort: next?.defaultEffort || null }); }} className={field}>
          {!model ? <option value={draft.model}>{draft.model} ({t("Unavailable")})</option> : null}{choices?.models.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select></label>
        <label className="block text-xs">{t("Reasoning effort")}<select aria-label={t("Template effort")} value={draft.effort || ""} onChange={event => setDraft({ ...draft, effort: event.target.value || null })} className={field}>
          <option value="">{t("Default")}</option>{draft.effort && !model?.efforts.includes(draft.effort) ? <option value={draft.effort}>{draft.effort} ({t("Unavailable")})</option> : null}{model?.efforts.map(effort => <option key={effort} value={effort}>{t(effort)}</option>)}
        </select></label>
        <label className="block text-xs">{t("Permissions")}<select aria-label={t("Template access")} value={draft.accessMode} onChange={event => { setDraft({ ...draft, accessMode: event.target.value }); setConfirmFullAccess(false); }} className={field}>
          {!access ? <option value={draft.accessMode}>{draft.accessMode} ({t("Unavailable")})</option> : null}{choices?.accessModes.map(row => <option key={row.id} value={row.id} disabled={!row.allowed}>{t(row.name)}</option>)}
        </select></label>
        {draft.accessMode === ":danger-full-access" ? <label className="block text-xs text-amber-100"><input type="checkbox" aria-label={t("Confirm full access")} checked={confirmFullAccess} onChange={event => setConfirmFullAccess(event.target.checked)} /> {t("Full access lets Codex access files outside the workspace, run commands, and use the network without individual approvals. Saving this template applies that access to employees recruited with it later and their future tasks.")}</label> : null}
        <button type="button" className="min-h-10 underline" disabled={!draft.name.trim() || !model || !access?.allowed || (draft.accessMode === ":danger-full-access" && !confirmFullAccess)} onClick={() => void mutate("recruitment.save", { ...draft, projectId, ...(projectId ? {} : { workspace }), confirmFullAccess }, result => { onSelect((result as { template: Template }).template.id); setDraft(null); })}>{t("Save template")}</button>
        <button type="button" className="ml-3 min-h-10" onClick={() => setDraft(null)}>{t("Cancel")}</button>
      </fieldset> : null}
    </details>
  </section>;
}
