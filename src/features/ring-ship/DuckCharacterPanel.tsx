"use client";
import { useRef, useState } from "react";
import { ArrowLeft, Check, RotateCcw } from "lucide-react";
import { createDefaultAgentAvatarProfile, type AgentAvatarProfile } from "@/lib/avatars/profile";
import { DEFAULT_DUCK_APPEARANCE, normalizeDuckAppearance, type DuckAppearance } from "@/lib/avatars/duck";
import { useUiText } from "@/lib/i18n/ui-language";
import type { SessionInspection } from "@/features/office/components/ExistingSessionPanel";
import { DuckCharacterPreview } from "./DuckCharacterPreview";
import "./duck-character.css";

const feathers = ["#ffbb3c", "#ece9d8", "#829a99", "#b1c8b0", "#d39c91", "#aab8d4"];
const uniforms = ["#394b54", "#435842", "#97704e", "#63768e", "#773f42", "#ded9c7"];

export type CharacterMode = "view" | "edit" | "rename";

function RenameCharacter({ name, onRename, onDone }: { name: string; onRename: (name: string) => Promise<void>; onDone: () => void }) {
  const t = useUiText();
  const [draft, setDraft] = useState(name), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const pending = useRef(false);
  return <form className="duck-character-rename" onSubmit={event => {
    event.preventDefault();
    if (pending.current || !draft.trim()) return;
    pending.current = true; setSaving(true); setError("");
    void onRename(draft.trim()).then(onDone).catch(cause => setError(cause instanceof Error ? cause.message : t("Could not rename session. Please retry.")))
      .finally(() => { pending.current = false; setSaving(false); });
  }}>
    <label>{t("Session name")}<input autoFocus aria-label={t("Session name")} value={draft} maxLength={120} disabled={saving} onChange={event => setDraft(event.target.value)} /></label>
    <p className="duck-character-hint">{t("Also renames this Codex session.")}</p>
    {error ? <p role="alert" className="duck-character-error">{error}</p> : null}
    <div className="duck-character-actions"><button type="button" disabled={saving} onClick={onDone}>{t("Cancel")}</button><button type="submit" className="duck-character-primary" disabled={saving || !draft.trim() || draft.trim() === name}>{t(saving ? "Saving…" : "Save name")}</button></div>
  </form>;
}

export function DuckCharacterPanel({ info, profile, status, model, onSave, mode, onModeChange, onRename }: {
  info: SessionInspection; profile?: AgentAvatarProfile | null; status: string; model?: string | null;
  onSave: (profile: AgentAvatarProfile) => Promise<void>;
  mode: CharacterMode; onModeChange: (mode: CharacterMode) => void;
  onRename?: (name: string) => Promise<void>;
}) {
  const t = useUiText();
  const editing = mode === "edit";
  const [view, setView] = useState<"body" | "face" | "top">("body");
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
      onModeChange("view");
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save character. Please retry.")); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const choices = <K extends "headwear" | "outfit" | "billShape">(key: K, options: Array<[DuckAppearance[K], string]>) => <div className="duck-character-options">{options.map(([value, label]) => <button
    key={value} type="button" aria-pressed={draft[key] === value} onClick={() => set(key, value)}>{t(label)}</button>)}</div>;
  const colors = (key: "featherColor" | "outfitColor", values: string[]) => <div className="duck-character-swatches">{values.map(color => <button key={color} type="button"
    aria-label={`${t(key === "featherColor" ? "Feather color" : "Equipment color")} ${color}`} aria-pressed={draft[key] === color} style={{ background: color }} onClick={() => set(key, color)} />)}
    <input type="color" aria-label={t(key === "featherColor" ? "Custom feather color" : "Custom equipment color")} value={draft[key]} onChange={event => set(key, event.target.value)} /></div>;
  const proportion = (key: "bodyWidth" | "bodyDepth" | "bodyHeight" | "eyeSpacing" | "eyeHeight", label: string, min = 75, max = 130) =>
    <label className="duck-character-range">{t(label)}<output>{Math.round(draft[key] * 100)}%</output><input aria-label={t(label)} type="range" min={min} max={max} step="1" value={Math.round(draft[key] * 100)} onChange={event => set(key, Number(event.target.value) / 100)} /></label>;
  return <div className="duck-character-panel" data-character-mode={mode}>
    <div className="duck-character-stage">
      <div className="duck-character-eyebrow">{t("CREW DOSSIER")}</div>
      <div className="duck-character-preview" aria-label={t("Character preview")}><DuckCharacterPreview appearance={appearance} face={view === "face"} top={view === "top"} /></div>
      <div className="duck-character-view-switch"><button aria-pressed={view === "body"} onClick={() => setView("body")}>{t("Full body")}</button><button aria-pressed={view === "face"} onClick={() => setView("face")}>{t("Face")}</button><button aria-pressed={view === "top"} onClick={() => setView("top")}>{t("Top view")}</button></div>
      <p className="duck-character-hint">{t("Drag to rotate · Scroll or pinch to zoom")}</p>
    </div>
    <div className="duck-character-details">
      <div className="duck-character-eyebrow">{t(editing ? "APPEARANCE" : "CREW MEMBER")}</div>
      <h3>{info.name}</h3>
      <div className="duck-character-status"><span data-working={status === "running"} />{t(status === "running" ? "Working" : status === "error" ? "Error" : status === "needsInput" ? "Needs your input" : "Idle")}</div>
      {editing ? <>
        <div className="duck-character-fields">
          <fieldset disabled={saving}><legend>{t("Body proportions")}</legend>
            {proportion("bodyDepth", "Body length (front–back)")}{proportion("bodyWidth", "Body width (left–right)")}{proportion("bodyHeight", "Body height")}
          </fieldset>
          <fieldset disabled={saving}><legend>{t("Eyes")}</legend>{proportion("eyeSpacing", "Eye spacing", 70, 130)}{proportion("eyeHeight", "Eye height", 90, 110)}</fieldset>
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
        <div className="duck-character-actions"><button disabled={saving} onClick={() => { onModeChange("view"); setError(""); }}><ArrowLeft size={14} />{t("Cancel")}</button>
          <button className="duck-character-primary" disabled={saving} onClick={() => void save()}><Check size={14} />{t(saving ? "Saving…" : "Save character")}</button></div>
        <button className="duck-character-reset" disabled={saving} onClick={() => setDraft({ ...DEFAULT_DUCK_APPEARANCE })}><RotateCcw size={12} />{t("Reset appearance")}</button>
      </> : mode === "rename" && onRename ? <RenameCharacter name={info.name} onRename={onRename} onDone={() => onModeChange("view")} /> : <>
        <dl className="duck-character-info">
          <div><dt>{t("Project")}</dt><dd>{info.project || "—"}</dd></div>
          <div><dt>{t("Model")}</dt><dd>{model || info.model || "—"}</dd></div>
          <div><dt>{t("Workspace")}</dt><dd>{info.workspace || "—"}</dd></div>
          <div><dt>{t("Session ID")}</dt><dd className="duck-character-id">{info.id}</dd></div>
        </dl>
      </>}
    </div>
  </div>;
}
