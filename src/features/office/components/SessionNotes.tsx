"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Save, Send } from "lucide-react";
import type { InterfaceAgent } from "@/lib/office/agent-interface";
import { useUiText } from "@/lib/i18n/ui-language";
import type { SessionClient } from "./SessionControls";
import { sendSessionMessage, SessionSendError } from "./sessionSend";

type Note = { id: string; text: string; revision: number; updatedAt: string | null };
function readNote(value: unknown, id: string): Note {
  const row = (value as { note?: Note } | null)?.note;
  if (!row || row.id !== id || typeof row.text !== "string" || row.text.length > 64000 || !Number.isSafeInteger(row.revision) || row.revision < 0) throw Error("Invalid notes");
  return row;
}
export function SessionNotes({ client, threadId, gateway, agents = [], connected = true }: {
  client: SessionClient; threadId: string; gateway: string; agents?: readonly InterfaceAgent[]; connected?: boolean;
}) {
  const t = useUiText();
  const [note, setNote] = useState<Note | null>(null), [text, setText] = useState("");
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [conflict, setConflict] = useState(false);
  const [error, setError] = useState(""), [backupError, setBackupError] = useState(false), [reload, setReload] = useState(0);
  const [selection, setSelection] = useState({ start: 0, end: 0 }), [targetId, setTargetId] = useState(threadId);
  const [delivery, setDelivery] = useState<{ status: "sending" | "accepted" | "failed" | "unknown"; name: string; outcome?: string } | null>(null);
  const busy = useRef(false), latestText = useRef("");
  const url = `/api/office/agents/${encodeURIComponent(threadId)}/notes`;
  const draftKey = `claw3d:notes-draft:${gateway}:${threadId}`;
  const dirty = !!note && text !== note.text;
  const selected = text.slice(selection.start, selection.end);
  const oversized = new TextEncoder().encode(selected).length > 32000;
  const targets = agents.filter(agent => !agent.archived);
  const target = targets.find(agent => agent.id === targetId);
  const available = connected && target && !target.needsInput && ["idle", "running"].includes(target.status || "");
  const backup = (value: string, revision: number) => {
    try { localStorage.setItem(draftKey, JSON.stringify({ text: value, revision })); setBackupError(false); }
    catch { setBackupError(true); }
  };
  useEffect(() => {
    const controller = new AbortController();
    void fetch(url, { credentials: "same-origin", cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw Error("Could not load notes. Try again.");
      const next = readNote(await response.json(), threadId);
      if (controller.signal.aborted) return;
      let draft: { text?: unknown; revision?: unknown } | null = null;
      try { draft = JSON.parse(localStorage.getItem(draftKey) || "null"); } catch { /* Server copy remains available. */ }
      if (draft?.text === next.text) { try { localStorage.removeItem(draftKey); } catch { setBackupError(true); } }
      const restore = draft && typeof draft.text === "string" && draft.text.length <= 64000 && Number.isSafeInteger(draft.revision) && draft.text !== next.text;
      latestText.current = restore ? draft!.text as string : next.text;
      setNote(next); setText(latestText.current);
      setConflict(Boolean(restore && draft!.revision !== next.revision)); setError("");
    }).catch(() => { if (!controller.signal.aborted) setError("Could not load notes. Try again."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, threadId, draftKey, reload]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || busy.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const save = async () => {
    if (!note || busy.current || loading || !dirty || conflict) return;
    busy.current = true; setSaving(true); setError("");
    const snapshot = text;
    try {
      const response = await fetch(url, { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: snapshot, revision: note.revision }) });
      if (response.status === 409) { setConflict(true); return; }
      if (!response.ok) throw Error("Could not save notes. Your draft is kept.");
      const next = readNote(await response.json(), threadId);
      if (next.text !== snapshot || next.revision <= note.revision) throw Error("Could not confirm the save. Reload saved notes before trying again.");
      setNote(next); try {
        const draft = JSON.parse(localStorage.getItem(draftKey) || "null");
        const current = latestText.current;
        if (draft?.text === current && draft.revision === note.revision) {
          if (current === snapshot) localStorage.removeItem(draftKey);
          else localStorage.setItem(draftKey, JSON.stringify({ text: current, revision: next.revision }));
          setBackupError(false);
        }
      } catch { setBackupError(true); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save notes. Your draft is kept."); }
    finally { busy.current = false; setSaving(false); }
  };
  const autosave = useEffectEvent(() => { void save(); });
  useEffect(() => {
    if (loading || !dirty || conflict) return;
    const timer = window.setInterval(() => autosave(), 10_000);
    return () => window.clearInterval(timer);
  }, [loading, dirty, conflict, draftKey]);
  const send = async () => {
    if (!available || !target || !selected.trim() || oversized || busy.current || delivery?.status === "unknown") return;
    // Freeze the text and UUID before any await. No composer drafts/references
    // or attachments are borrowed from either the source or recipient chat.
    const message = selected, recipient = { id: target.id, name: target.name };
    busy.current = true; setDelivery({ status: "sending", name: recipient.name });
    try {
      const receipt = await sendSessionMessage(client, recipient.id, { requestId: crypto.randomUUID(), message, references: [], attachments: [] });
      setDelivery({ status: "accepted", name: recipient.name, outcome: receipt.status });
    } catch (cause) {
      setDelivery({ status: cause instanceof SessionSendError ? cause.delivery : "unknown", name: recipient.name });
    } finally { busy.current = false; }
  };
  const refresh = () => {
    if (busy.current || dirty && !window.confirm(t("Discard this draft and load saved notes?"))) return;
    try { localStorage.removeItem(draftKey); } catch { setError("Could not clear the local draft. Copy it before reloading."); return; }
    setLoading(true); setSelection({ start: 0, end: 0 }); setReload(value => value + 1);
  };
  return <section className="session-notes flex min-h-0 flex-1 flex-col gap-3 p-3" aria-label={t("Agent notes")}>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="session-action-back" disabled={!dirty || loading || saving || conflict || delivery?.status === "sending"} onClick={() => void save()}><Save size={15} />{t(saving ? "Saving…" : "Save notes")}</button>
      <button type="button" className="session-action-back" disabled={saving || delivery?.status === "sending"} onClick={refresh}>{t("Reload saved notes")}</button>
      <span role="status" className="text-xs">{t(loading ? "Loading notes…" : !note ? "Notes unavailable" : dirty ? "Unsaved changes" : "Saved · synced across devices")}</span>
    </div>
    {error ? <p role="alert" className="text-sm">{t(error)}</p> : null}
    {conflict ? <p role="alert" className="text-sm">{t("Notes changed on another device. Your draft is kept. Copy it before loading the saved version.")}</p> : null}
    {backupError ? <p role="alert" className="text-sm">{t("Local draft backup unavailable. Save before closing.")}</p> : null}
    <textarea aria-label={t("Notes text")} className="min-h-40 min-w-0 flex-1 resize-none rounded-lg border p-3 text-base leading-6" style={{ fontSize: 16, background: "var(--input)", color: "var(--foreground)", borderColor: "var(--sidebar-input-border)" }} maxLength={64000} value={text} disabled={loading || !note}
      onChange={event => { const value = event.target.value; latestText.current = value; setText(value); setSelection({ start: event.target.selectionStart, end: event.target.selectionEnd }); if (note) { if (value === note.text && !saving) { try { localStorage.removeItem(draftKey); } catch { setBackupError(true); } } else backup(value, note.revision); } }}
      onSelect={event => setSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })} />
    <p className="text-xs">{t("Edits save every 10 seconds. Reload to get changes from another device.")}</p>
    <p className="text-xs">{t("Select text above, choose an agent, then send only that selection.")}</p>
    <div className="flex flex-wrap gap-2">
      <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">{t("Send to")}<select aria-label={t("Send notes to agent")} className="min-h-10 min-w-0 flex-1 rounded border px-2" style={{ background: "var(--surface-2)", color: "var(--foreground)" }} value={targetId} disabled={delivery?.status === "sending"} onChange={event => setTargetId(event.target.value)}>
        <option value="">{t("Choose an agent")}</option>{targets.map(agent => <option key={agent.id} value={agent.id}>{agent.name}{targets.filter(item => item.name === agent.name).length > 1 ? ` · ${agent.id.slice(0, 8)}` : ""}</option>)}
      </select></label>
      <button type="button" className="session-action-back" disabled={!available || !selected.trim() || oversized || saving || delivery?.status === "sending" || delivery?.status === "unknown"} onClick={() => void send()}><Send size={15} />{t(delivery?.status === "sending" ? "Sending…" : "Send selection")}</button>
    </div>
    {target && !available ? <p className="text-sm">{t("This agent is unavailable or needs a question answered. Nothing will be sent.")}</p> : null}
    {oversized ? <p role="alert" className="text-sm">{t("Selection exceeds 32,000 UTF-8 bytes. Select a smaller section.")}</p> : null}
    {delivery ? <p role="status" className="text-sm">{delivery.status === "accepted" ? `${t(delivery.outcome === "steered" ? "Sent as a follow-up to" : "Sent to")} ${delivery.name}` : delivery.status === "unknown" ? t("Delivery unconfirmed. Check the recipient chat before sending again. Your notes are kept.") : delivery.status === "failed" ? t("Nothing was sent. Your notes are kept.") : `${t("Sending to")} ${delivery.name}`}</p> : null}
  </section>;
}
