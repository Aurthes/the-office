"use client";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { SessionClient } from "./SessionControls";
import { useUiText } from "@/lib/i18n/ui-language";

export type ChatSettings = { model: string; effort: string | null; accessMode: string };
type Choices = { models: { id: string; name: string; efforts: string[]; defaultEffort: string }[];
  accessModes: { id: string; name: string; description?: string | null; allowed: boolean }[] };

export function SessionSettings({ client, threadId, current, disabled, active, onBusyChange, children }: {
  client: SessionClient; threadId: string; current: ChatSettings; disabled: boolean; active: boolean;
  onBusyChange: (busy: boolean) => void;
  children?: ReactNode;
}) {
  const t = useUiText();
  const [choices, setChoices] = useState<Choices | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmFullAccess, setConfirmFullAccess] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stopped = false;
    void client.call("session.settings.choices", { threadId }).then(result => {
      if (!stopped) { setChoices(result as Choices); setError(""); }
    }).catch(cause => { if (!stopped) setError(cause instanceof Error ? cause.message : "Could not load options"); });
    return () => { stopped = true; };
  }, [client, threadId, attempt]);
  const update = async (settings: Partial<ChatSettings> & { confirmFullAccess?: boolean }) => {
    if (busy || disabled) return;
    setBusy(true); onBusyChange(true); setError(""); setNotice(""); setConfirmFullAccess(false);
    try {
      await client.call("session.settings.update", { threadId, settings });
      setNotice(active ? "Saved for the next turn. Additional messages use the current task settings." : "Saved for the next message.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save. Check the current settings before retrying."); }
    finally { setBusy(false); onBusyChange(false); }
  };
  const model = choices?.models.find(model => model.id === current.model);
  const access = choices?.accessModes.find(mode => mode.id === current.accessMode);
  const blocked = disabled || busy || !choices;
  const selectClass = "min-h-10 w-full min-w-0 rounded-lg border border-white/15 bg-[#172330] px-2 text-sm text-white disabled:opacity-45";
  const triggerClass = "session-setting-trigger relative inline-flex min-h-10 min-w-0 max-w-full items-center gap-1.5 rounded-lg px-2 text-xs text-white/70 hover:bg-white/5";
  return <div className="mb-2">
    <div className="flex min-w-0 items-center gap-x-3 gap-y-1">
      <button aria-label={t("Model settings")} aria-expanded={modelOpen} onClick={() => setModelOpen(!modelOpen)} className={triggerClass}><span className="truncate">{model?.name || current.model}</span><span className="shrink-0 text-white/40">{current.effort ? t(current.effort) : t("Default")}</span><ChevronDown size={12} className="shrink-0" aria-hidden="true" /></button>
      <label className={triggerClass + (blocked ? " opacity-45" : "")}>
      <span className="truncate" aria-hidden="true">{access ? t(access.name) : current.accessMode === "custom" ? t("Custom permissions") : current.accessMode}</span><ChevronDown size={12} className="shrink-0" aria-hidden="true" />
      <select aria-label={t("Select access mode")} title={t("Select session access mode")} value={current.accessMode} disabled={blocked} onChange={event => {
        if (event.target.value === ":danger-full-access" && current.accessMode !== event.target.value) setConfirmFullAccess(true);
        else void update({ accessMode: event.target.value });
      }} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default">
        {!access ? <option value={current.accessMode}>{current.accessMode === "custom" ? t("Custom permissions") : current.accessMode}</option> : null}
        {choices?.accessModes.map(mode => <option key={mode.id} value={mode.id} disabled={!mode.allowed} title={mode.description ? t(mode.description) : undefined}>{t(mode.name)}</option>)}
      </select>
      </label>
      {busy ? <span role="status" className="text-xs text-white/45">{t("Saving…")}</span> : null}
      {children}
    </div>
    {modelOpen ? <div className="mb-2 grid grid-cols-2 gap-3 rounded-xl border border-white/15 bg-[#172330] p-3">
      <label className="min-w-0 text-xs text-white/60">{t("Model")}<select aria-label={t("Select model")} disabled={blocked} value={current.model} onChange={event => void update({ model: event.target.value })} className={selectClass}>
        {!model ? <option value={current.model}>{current.model}</option> : null}
        {choices?.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select></label>
      <label className="min-w-0 text-xs text-white/60">{t("Reasoning effort")}<select aria-label={t("Reasoning effort")} disabled={blocked || !model} value={current.effort || ""} onChange={event => void update({ effort: event.target.value })} className={selectClass}>
        {!current.effort || !model?.efforts.includes(current.effort) ? <option value={current.effort || ""} disabled>{current.effort ? t(current.effort) : t("Default")}</option> : null}
        {model?.efforts.map(effort => <option key={effort} value={effort}>{t(effort)}</option>)}
      </select></label>
    </div> : null}
    {confirmFullAccess ? <section role="dialog" aria-label={t("Confirm full access")} className="mb-2 rounded-xl border border-amber-300/30 bg-amber-900/15 p-3 text-xs text-amber-100">
      <p>{t("Full access lets Codex access files outside the workspace, run commands, and use the network without individual approvals. This applies to future tasks in this session.")}</p>
      <div className="mt-2 flex gap-2"><button disabled={disabled || busy} onClick={() => void update({ accessMode: ":danger-full-access", confirmFullAccess: true })} className="min-h-10 rounded-lg border border-amber-300/40 px-3">{t("Enable full access")}</button><button onClick={() => setConfirmFullAccess(false)} className="min-h-10 px-3 text-white/70">{t("Cancel")}</button></div>
    </section> : null}
    {error ? <p role="alert" className="mb-2 break-words text-xs text-amber-100">{t(error)}{!choices ? <> <button onClick={() => setAttempt(attempt + 1)} className="underline">{t("Retry options")}</button></> : null}</p> : null}
    {notice ? <p role="status" className="mb-2 text-[11px] text-white/45">{t(notice)}</p> : null}
  </div>;
}
