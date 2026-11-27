"use client";
import { useEffect, useRef, useState } from "react";
import { useUiText } from "@/lib/i18n/ui-language";
import type { SessionClient } from "./SessionControls";
const fields = [["focus", "Current focus"], ["decisions", "Key conclusions and reasons"], ["followUp", "Responsibilities and next decisions"], ["links", "Tasks and original sources"]] as const;
type Sections = Record<typeof fields[number][0], string>;
type Saved = { id: string; revision: number; updatedAt: string | null; sections: Sections };
const empty = (): Sections => ({ focus: "", decisions: "", followUp: "", links: "" });
const equal = (a: Sections, b: Sections) => fields.every(([key]) => a[key] === b[key]);
function saved(value: unknown, id: string): Saved {
  const row = value as Saved | null;
  if (!row || row.id !== id || !Number.isSafeInteger(row.revision) || row.revision < 0 || !row.sections
    || fields.some(([key]) => typeof row.sections[key] !== "string" || row.sections[key].length > 2400)
    || Object.values(row.sections).join("").length > 6000 || new TextEncoder().encode(Object.values(row.sections).join("")).length > 18000
    || (row.revision > 0 ? typeof row.updatedAt !== "string" || !Number.isFinite(Date.parse(row.updatedAt)) : row.updatedAt !== null)) throw Error("Invalid Agent State response.");
  return row;
}
// Keying the full editor (not just its inputs) isolates drafts, in-flight saves
// and late responses when employee identity changes.
export function SessionAgentState(props: { client: SessionClient; agentId: string; gateway?: string; connected?: boolean; onSaved?: () => void }) {
  const [scope, setScope] = useState({ client: props.client, generation: 0 });
  if (scope.client !== props.client) { setScope({ client: props.client, generation: scope.generation + 1 }); return null; }
  return <StateEditor key={`${props.gateway || ""}:${props.agentId}:${scope.generation}`} {...props} />;
}
function StateEditor({ client, agentId, gateway = "", connected = true, onSaved }: { client: SessionClient; agentId: string; gateway?: string; connected?: boolean; onSaved?: () => void }) {
  const t = useUiText();
  const draftKey = `claw3d:agent-state-draft:${gateway}:${agentId}`;
  const [backupError, setBackupError] = useState(false);
  const [record, setRecord] = useState<Saved | null>(null), [draft, setDraft] = useState<Sections>(empty);
  const [editing, setEditing] = useState(false), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [mustReload, setMustReload] = useState(false), [reload, setReload] = useState(0);
  const lifetime = useRef({ active: false }), busy = useRef(false);
  const dirty = record !== null && !equal(draft, record.sections);
  const text = Object.values(draft).join("");
  const invalid = text.length > 6000 || new TextEncoder().encode(text).length > 18000;
  useEffect(() => {
    const token = { active: true }; lifetime.current = token;
    void client.call("agent.state.get", { actorId: agentId }).then(value => {
      const row = saved(value, agentId);
      if (!token.active) return;
      let restored: { revision: number; sections: Sections } | null = null;
      try {
        const value = JSON.parse(localStorage.getItem(draftKey) || "null");
        if (value && value.id === agentId && Number.isSafeInteger(value.revision) && value.revision >= 0 && value.sections
          && Object.keys(value.sections).length === fields.length && fields.every(([key]) => typeof value.sections[key] === "string" && value.sections[key].length <= 2400)) restored = value;
        if (restored && equal(restored.sections, row.sections)) { localStorage.removeItem(draftKey); restored = null; }
      } catch { setBackupError(true); }
      setRecord(row); setDraft(restored?.sections || row.sections);
      if (restored) {
        setEditing(true);
        if (restored.revision !== row.revision) {
          setMustReload(true); setError("Save not confirmed or revision changed. Your draft is kept. Copy it, then reload the saved state before retrying.");
        }
      }
    }).catch(() => { if (token.active) setError("Could not load Agent State. Try again."); })
      .finally(() => { if (token.active) setLoading(false); });
    return () => { token.active = false; };
  }, [client, agentId, draftKey, reload]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || saving) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);
  const backup = (sections: Sections) => {
    try { localStorage.setItem(draftKey, JSON.stringify({ id: agentId, revision: record!.revision, sections })); setBackupError(false); }
    catch { setBackupError(true); }
  };
  const clearBackup = (sections: Sections, revision?: number) => {
    try {
      const value = JSON.parse(localStorage.getItem(draftKey) || "null");
      if (value && (revision === undefined || value.revision === revision) && value.sections && equal(value.sections, sections)) localStorage.removeItem(draftKey);
    } catch { setBackupError(true); }
  };
  const save = async () => {
    if (!record || busy.current || loading || !connected || mustReload || !dirty || invalid) return;
    busy.current = true; setSaving(true); setError("");
    const token = lifetime.current, snapshot = { ...draft }, revision = record.revision;
    try {
      const next = saved(await client.call("agent.state.save", { actorId: agentId, revision, sections: snapshot }), agentId);
      if (next.revision !== revision + 1 || !equal(next.sections, snapshot)) throw Error("Unconfirmed save");
      if (!token.active) return;
      setRecord(next); setEditing(false);
      clearBackup(snapshot, revision);
      onSaved?.();
    } catch {
      if (token.active) { setMustReload(true); setError("Save not confirmed or revision changed. Your draft is kept. Copy it, then reload the saved state before retrying."); }
    } finally { if (token.active) { busy.current = false; setSaving(false); } }
  };
  const refresh = () => {
    if (busy.current || dirty && !window.confirm(t("Discard this draft and load saved Agent State?"))) return;
    try { localStorage.removeItem(draftKey); } catch { setBackupError(true); return; }
    setLoading(true); setRecord(null); setError(""); setEditing(false); setMustReload(false);
    setReload(value => value + 1);
  };
  return <section aria-label={t("Agent State")} className="min-h-0 flex-1 overflow-auto p-3 text-sm" data-agent-state={agentId}>
    <h3 className="font-medium">{t("Agent State")}</h3>
    <p className="my-2 text-xs opacity-70">{t("Concise shared memory for this employee. Kept across conversation changes. Separate from your Notes; state is data, not instructions.")}</p>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {editing ? <><button type="button" className="session-action-back" disabled={!connected || !dirty || saving || mustReload || invalid} onClick={() => void save()}>{t(saving ? "Saving…" : "Save Agent State")}</button>
        <button type="button" className="session-action-back" disabled={saving} onClick={() => { if (!dirty || window.confirm(t("Discard Agent State edits?"))) { clearBackup(draft); setDraft(record!.sections); setEditing(false); setError(mustReload ? "Reload saved Agent State before editing again." : ""); } }}>{t("Cancel")}</button></> : <button type="button" className="session-action-back" disabled={!record || loading || !connected || mustReload} onClick={() => setEditing(true)}>{t("Edit Agent State")}</button>}
      <button type="button" className="session-action-back" disabled={saving || loading || !connected} onClick={refresh}>{t("Reload Agent State")}</button>
    </div>
    <p role="status" className="mb-3 text-xs">{loading ? t("Loading Agent State…") : record ? <>{t("Saved revision")} {record.revision} · {record.updatedAt ? <time dateTime={record.updatedAt}>{new Date(record.updatedAt).toLocaleString()}</time> : t("Not saved yet")}{dirty ? ` · ${t("Unsaved changes")}` : ""}</> : t("Agent State unavailable")}</p>
    {backupError ? <p role="alert" className="mb-3 text-sm">{t("Local draft backup unavailable. Save before closing.")}</p> : null}
    {error ? <p role="alert" className="mb-3 text-sm">{t(error)}</p> : null}
    {record && !loading ? <>
      {!record.revision ? <p className="mb-3 text-sm">{t("No Agent State has been saved for this employee.")}</p> : null}
      {fields.map(([key, label]) => <div key={key} className="mb-4 min-w-0"><label className="mb-1 block font-medium" htmlFor={`agent-state-${agentId}-${key}`}>{t(label)}</label>
        {editing ? <textarea id={`agent-state-${agentId}-${key}`} value={draft[key]} maxLength={2400} disabled={saving} rows={key === "links" ? 2 : 4} className="w-full min-w-0 resize-y rounded border p-2 text-base leading-6" style={{ background: "var(--input)", color: "var(--foreground)", borderColor: "var(--sidebar-input-border)", fontSize: 16 }} onChange={event => { const next = { ...draft, [key]: event.target.value }; setDraft(next); backup(next); }} />
          : <p id={`agent-state-${agentId}-${key}`} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-6">{record.sections[key] || "—"}</p>}
      </div>)}
      {editing ? <p role={invalid ? "alert" : undefined} className="text-xs">{t("Keep only current essentials. Up to 2,400 characters per section; 6,000 characters and 18,000 UTF-8 bytes in total.")} {text.length}/6,000</p> : null}
    </> : null}
  </section>;
}
