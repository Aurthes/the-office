"use client";
import { useRef, useState } from "react";
import { ArrowLeft, Check, Pencil, RotateCcw } from "lucide-react";
import { createDefaultAgentAvatarProfile, type AgentAvatarProfile } from "@/lib/avatars/profile";
import { DEFAULT_DUCK_APPEARANCE, normalizeDuckAppearance, type DuckAppearance } from "@/lib/avatars/duck";
import { useUiText } from "@/lib/i18n/ui-language";
import type { SessionInspection } from "@/features/office/components/ExistingSessionPanel";
import { DuckCharacterPreview } from "./DuckCharacterPreview";
import "./duck-character.css";

const feathers = ["#ffbb3c", "#ece9d8", "#829a99", "#b1c8b0", "#d39c91", "#aab8d4"];
const uniforms = ["#394b54", "#435842", "#97704e", "#63768e", "#773f42", "#ded9c7"];

export function DuckCharacterPanel({ info, profile, status, model, onSave }: {
  info: SessionInspection; profile?: AgentAvatarProfile | null; status: string; model?: string | null;
  onSave: (profile: AgentAvatarProfile) => Promise<void>;
}) {
  const t = useUiText();
  const [editing, setEditing] = useState(false), [face, setFace] = useState(false);
  const [draft, setDraft] = useState(() => normalizeDuckAppearance(profile?.duck));
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const savingRef = useRef(false);
  const appearance = editing ? draft : normalizeDuckAppearance(profile?.duck);
  const set = <K extends keyof DuckAppearance>(key: K, value: DuckAppearance[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError("");
    try {
      await onSave({ ...(profile || createDefaultAgentAvatarProfile(info.id)), duck: normalizeDuckAppearance(draft) });
      setEditing(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save character. Please retry.")); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const choices = <K extends "headwear" | "outfit" | "billShape">(key: K, options: Array<[DuckAppearance[K], string]>) => <div className="duck-character-options">{options.map(([value, label]) => <button
    key={value} type="button" aria-pressed={draft[key] === value} onClick={() => set(key, value)}>{t(label)}</button>)}</div>;
  const colors = (key: "featherColor" | "outfitColor", values: string[]) => <div className="duck-character-swatches">{values.map(color => <button key={color} type="button"
    aria-label={`${t(key === "featherColor" ? "Feather color" : "Equipment color")} ${color}`} aria-pressed={draft[key] === color} style={{ background: color }} onClick={() => set(key, color)} />)}
    <input type="color" aria-label={t(key === "featherColor" ? "Custom feather color" : "Custom equipment color")} value={draft[key]} onChange={event => set(key, event.target.value)} /></div>;
  return <div className="duck-character-panel" data-character-mode={editing ? "edit" : "view"}>
    <div className="duck-character-stage">
      <div className="duck-character-eyebrow">{t("CREW DOSSIER")}</div>
      <div className="duck-character-preview" aria-label={t("Character preview")}><DuckCharacterPreview appearance={appearance} face={face} /></div>
      <div className="duck-character-view-switch"><button aria-pressed={!face} onClick={() => setFace(false)}>{t("Full body")}</button><button aria-pressed={face} onClick={() => setFace(true)}>{t("Face")}</button></div>
      <p className="duck-character-hint">{t("Drag to rotate · Scroll or pinch to zoom")}</p>
    </div>
    <div className="duck-character-details">
      <div className="duck-character-eyebrow">{t(editing ? "APPEARANCE" : "CREW MEMBER")}</div>
      <h3>{info.name}</h3>
      <div className="duck-character-status"><span data-working={status === "running"} />{t(status === "running" ? "Working" : status === "error" ? "Error" : status === "needsInput" ? "Needs your input" : "Idle")}</div>
      {editing ? <>
        <div className="duck-character-fields">
          <fieldset disabled={saving}><legend>{t("Feathers")}</legend>{colors("featherColor", feathers)}</fieldset>
          <fieldset disabled={saving}><legend>{t("Bill shape")}</legend>{choices("billShape", [["classic", "Classic"], ["sculpted", "Sculpted"]])}
            <label className="duck-character-range">{t("Bill size")} <output>{Math.round(draft.billScale * 100)}%</output><input aria-label={t("Bill size")} type="range" min="70" max="140" step="1" value={Math.round(draft.billScale * 100)} onChange={event => set("billScale", Number(event.target.value) / 100)} /></label>
            <label className="duck-character-color">{t("Bill color")}<input type="color" aria-label={t("Bill color")} value={draft.billColor} onChange={event => set("billColor", event.target.value)} /></label>
          </fieldset>
          <fieldset disabled={saving}><legend>{t("Headwear")}</legend>{choices("headwear", [["none", "None"], ["cap", "Cap"], ["helmet", "Helmet"]])}</fieldset>
          <fieldset disabled={saving}><legend>{t("Outfit")}</legend>{choices("outfit", [["none", "None"], ["vest", "Utility vest"], ["jacket", "Flight jacket"]])}</fieldset>
          <fieldset disabled={saving}><legend>{t("Equipment color")}</legend>{colors("outfitColor", uniforms)}</fieldset>
        </div>
        {error ? <p role="alert" className="duck-character-error">{error}</p> : null}
        <div className="duck-character-actions"><button disabled={saving} onClick={() => { setEditing(false); setError(""); }}><ArrowLeft size={14} />{t("Cancel")}</button>
          <button className="duck-character-primary" disabled={saving} onClick={() => void save()}><Check size={14} />{t(saving ? "Saving…" : "Save character")}</button></div>
        <button className="duck-character-reset" disabled={saving} onClick={() => setDraft({ ...DEFAULT_DUCK_APPEARANCE })}><RotateCcw size={12} />{t("Reset appearance")}</button>
      </> : <>
        <dl className="duck-character-info">
          <div><dt>{t("Project")}</dt><dd>{info.project || "—"}</dd></div>
          <div><dt>{t("Model")}</dt><dd>{model || info.model || "—"}</dd></div>
          <div><dt>{t("Workspace")}</dt><dd>{info.workspace || "—"}</dd></div>
          <div><dt>{t("Session ID")}</dt><dd className="duck-character-id">{info.id}</dd></div>
        </dl>
        <button className="duck-character-primary duck-character-edit" onClick={() => { setDraft(normalizeDuckAppearance(profile?.duck)); setEditing(true); }}><Pencil size={14} />{t("Edit character")}</button>
      </>}
    </div>
  </div>;
}
