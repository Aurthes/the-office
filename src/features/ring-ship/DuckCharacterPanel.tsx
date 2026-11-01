"use client";
import { useRef, useState } from "react";
import { ArrowLeft, ArrowRightLeft, Check, RotateCcw, Shuffle } from "lucide-react";
import { createDefaultAgentAvatarProfile, type AgentAvatarProfile } from "@/lib/avatars/profile";
import { DEFAULT_DUCK_APPEARANCE, normalizeDuckAppearance, createDuckAppearanceFromSeed } from "@/lib/avatars/duck";
import { useUiText } from "@/lib/i18n/ui-language";
import type { SessionInspection } from "@/features/office/components/ExistingSessionPanel";
import { randomUUID } from "@/lib/uuid";
import { DuckAppearanceEditor } from "./DuckAppearanceEditor";
import { DuckCharacterPreview } from "./DuckCharacterPreview";
import type { CompanyProject } from "@/features/retro-office/core/companyLayout";
import "./duck-character.css";

export type CharacterMode = "view" | "edit" | "rename" | "reassign";

function ReassignCharacter({ info, projects, onReassign, onDone }: {
  info: SessionInspection; projects: CompanyProject[]; onReassign: (projectId: string) => Promise<void>; onDone: () => void;
}) {
  const t = useUiText();
  const [projectId, setProjectId] = useState(info.projectId || ""), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const pending = useRef(false);
  const valid = projectId !== info.projectId && projects.some(project => project.id === projectId);
  return <form className="duck-character-rename" aria-label={t("Reassign")} onSubmit={event => {
    event.preventDefault();
    if (pending.current || !valid) return;
    pending.current = true; setSaving(true); setError("");
    void onReassign(projectId).then(onDone).catch(cause => setError(cause instanceof Error ? cause.message : t("Could not reassign. Please retry.")))
      .finally(() => { pending.current = false; setSaving(false); });
  }}>
    <label>{t("Project")}<select aria-label={t("Reassign to project")} value={projectId} disabled={saving} onChange={event => setProjectId(event.target.value)}>
      {!projects.some(project => project.id === projectId) ? <option value="" disabled>{t("Choose a project")}</option> : null}
      {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
    </select></label>
    <p className="duck-character-hint">{t("Changes the project. Keeps this chat, history and working folder.")}</p>
    {error ? <p role="alert" className="duck-character-error">{t(error)}</p> : null}
    <div className="duck-character-actions"><button type="button" disabled={saving} onClick={onDone}>{t("Cancel")}</button><button type="submit" className="duck-character-primary" disabled={saving || !valid}>{t(saving ? "Reassigning…" : "Confirm reassignment")}</button></div>
  </form>;
}

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

export function DuckCharacterPanel({ info, profile, status, model, onSave, mode, onModeChange, onRename, onReassign, projects = [] }: {
  info: SessionInspection; profile?: AgentAvatarProfile | null; status: string; model?: string | null;
  onSave: (profile: AgentAvatarProfile) => Promise<void>;
  mode: CharacterMode; onModeChange: (mode: CharacterMode) => void;
  onRename?: (name: string) => Promise<void>;
  onReassign?: (projectId: string) => Promise<void>;
  projects?: CompanyProject[];
}) {
  const t = useUiText();
  const editing = mode === "edit";
  const [view, setView] = useState<"body" | "face" | "top" | "back">("body");
  const [draft, setDraft] = useState(() => normalizeDuckAppearance(profile?.duck));
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const savingRef = useRef(false);
  const appearance = editing ? draft : normalizeDuckAppearance(profile?.duck);
  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError("");
    try {
      await onSave({ ...(profile || createDefaultAgentAvatarProfile(info.id)), duck: normalizeDuckAppearance(draft) });
      onModeChange("view");
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save character. Please retry.")); }
    finally { savingRef.current = false; setSaving(false); }
  };
  return <div className="duck-character-panel" data-character-mode={mode}>
    <div className="duck-character-stage">
      <div className="duck-character-eyebrow">{t("CREW DOSSIER")}</div>
      <div className="duck-character-preview" aria-label={t("Character preview")}><DuckCharacterPreview appearance={appearance} face={view === "face"} top={view === "top"} back={view === "back"} /></div>
      <div className="duck-character-view-switch"><button aria-pressed={view === "body"} onClick={() => setView("body")}>{t("Full body")}</button><button aria-pressed={view === "face"} onClick={() => setView("face")}>{t("Face")}</button><button aria-pressed={view === "back"} onClick={() => setView("back")}>{t("Back view")}</button><button aria-pressed={view === "top"} onClick={() => setView("top")}>{t("Top view")}</button></div>
      <p className="duck-character-hint">{t("Drag to rotate · Scroll or pinch to zoom")}</p>
    </div>
    <div className="duck-character-details">
      <div className="duck-character-eyebrow">{t(editing ? "APPEARANCE" : "CREW MEMBER")}</div>
      <h3>{info.name}</h3>
      <div className="duck-character-status"><span data-working={status === "running"} />{t(status === "running" ? "Working" : status === "error" ? "Error" : status === "needsInput" ? "Needs your input" : "Idle")}</div>
      {editing ? <>
        <button type="button" className="duck-character-shuffle" disabled={saving} onClick={() => setDraft(createDuckAppearanceFromSeed(randomUUID()))}><Shuffle size={14} />{t("Randomize character")}</button>
        <DuckAppearanceEditor value={draft} onChange={setDraft} disabled={saving} onPartChange={part => setView(part === "head" || part === "face" ? "face" : part === "tail" ? "back" : "body")} />
        {error ? <p role="alert" className="duck-character-error">{error}</p> : null}
        <div className="duck-character-actions"><button disabled={saving} onClick={() => { setDraft(normalizeDuckAppearance(profile?.duck)); onModeChange("view"); setError(""); }}><ArrowLeft size={14} />{t("Cancel")}</button>
          <button className="duck-character-primary" disabled={saving} onClick={() => void save()}><Check size={14} />{t(saving ? "Saving…" : "Save character")}</button></div>
        <button className="duck-character-reset" disabled={saving} onClick={() => setDraft({ ...DEFAULT_DUCK_APPEARANCE })}><RotateCcw size={12} />{t("Reset appearance")}</button>
      </> : mode === "rename" && onRename ? <RenameCharacter name={info.name} onRename={onRename} onDone={() => onModeChange("view")} /> : mode === "reassign" && onReassign ? <ReassignCharacter info={info} projects={projects} onReassign={onReassign} onDone={() => onModeChange("view")} /> : <>
        <dl className="duck-character-info">
          <div><dt>{t("Project")}</dt><dd>{info.project || "—"}</dd></div>
          <div><dt>{t("Model")}</dt><dd>{model || info.model || "—"}</dd></div>
          <div><dt>{t("Workspace")}</dt><dd>{info.workspace || "—"}</dd></div>
          <div><dt>{t("Session ID")}</dt><dd className="duck-character-id">{info.id}</dd></div>
        </dl>
        <div className="duck-character-actions"><button onClick={() => onModeChange("edit")}>{t("Edit character")}</button>
          {onReassign ? <button disabled={!projects.length} onClick={() => onModeChange("reassign")}><ArrowRightLeft size={14} />{t("Reassign")}</button> : null}</div>
      </>}
    </div>
  </div>;
}
