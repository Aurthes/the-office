"use client";
import { useRef, useState } from "react";
import { ChevronRight, Lightbulb } from "lucide-react";
import { resolveAgentInterface, type AgentInterfacePreset } from "@/lib/office/agent-interface";
import { useUiText } from "@/lib/i18n/ui-language";

export function AgentInterfaceActions({ preset, onOpenBoard, placement }: {
  preset: AgentInterfacePreset; onOpenBoard?: () => void; placement: "inline" | "menu";
}) {
  const t = useUiText();
  return resolveAgentInterface(preset).capabilities.map(capability => <button key={capability} type="button" data-interface-capability={capability}
    className={placement === "inline" ? "session-interface-inline session-action-back" : "session-interface-overflow session-action"}
    aria-label={t("Teaser board")} disabled={!onOpenBoard} onClick={event => {
      if (placement === "menu") event.currentTarget.closest("details")?.removeAttribute("open");
      onOpenBoard?.();
    }}><Lightbulb size={15} aria-hidden="true" /><span>{t("Teaser board")}</span>{placement === "menu" ? <ChevronRight size={14} aria-hidden="true" /> : null}</button>);
}

export function AgentInterfacePresetEditor({ preset, onSave }: { preset: AgentInterfacePreset; onSave: (value: AgentInterfacePreset) => Promise<void> }) {
  const t = useUiText(), [value, setValue] = useState(preset), [saving, setSaving] = useState(false), [error, setError] = useState(false), busy = useRef(false);
  const save = async () => {
    if (busy.current || value === preset) return;
    busy.current = true; setSaving(true); setError(false);
    try { await onSave(value); } catch { setError(true); }
    finally { busy.current = false; setSaving(false); }
  };
  return <div className="session-interface-preset">
    <label>{t("Interface preset")}<select aria-label={t("Interface preset")} value={value} disabled={saving} onChange={event => setValue(event.target.value as AgentInterfacePreset)}>
      <option value="standard">{t("Standard")}</option><option value="teaser">{t("Teaser")}</option>
    </select></label>
    <button type="button" disabled={saving || value === preset} onClick={() => void save()}>{t(saving ? "Saving…" : "Save interface preset")}</button>
    {error ? <p role="alert">{t("Interface preset could not be saved. Your selection is kept.")}</p> : null}
  </div>;
}
