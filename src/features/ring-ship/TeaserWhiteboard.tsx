"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import type { Teaser, TeaserWhiteboard as Whiteboard } from "@/lib/office/teasers";

export type WhiteboardHandle = { canClose: () => boolean };
function readBoard(value: unknown, id: string): Whiteboard {
  const row = (value as { whiteboard?: Whiteboard } | null)?.whiteboard;
  if (!row || row.id !== id || typeof row.text !== "string" || row.text.length > 12000 ||
      !Number.isSafeInteger(row.revision) || row.revision < 0 || !(row.updatedAt === null || typeof row.updatedAt === "string")) throw Error("Invalid whiteboard");
  return row;
}

export const TeaserWhiteboard = forwardRef<WhiteboardHandle, {
  teaser: Pick<Teaser, "id" | "title">; onBack: () => void; onBusyChange: (busy: boolean) => void;
}>(function TeaserWhiteboard({ teaser, onBack, onBusyChange }, ref) {
  const t = useUiText();
  const [board, setBoard] = useState<Whiteboard | null>(null), [text, setText] = useState("");
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false), [saveError, setSaveError] = useState(false);
  const [conflict, setConflict] = useState(false), [saved, setSaved] = useState(false), [request, setRequest] = useState(0);
  const busy = useRef(false), saveRequest = useRef<AbortController | null>(null);
  const dirty = board !== null && text !== board.text;
  const canClose = () => !busy.current && (!dirty || window.confirm(t("Discard unsaved whiteboard changes?")));
  useImperativeHandle(ref, () => ({ canClose }));
  const url = `/api/office/teasers/${encodeURIComponent(teaser.id)}/whiteboard`;
  useEffect(() => {
    const controller = new AbortController();
    void fetch(url, { credentials: "same-origin", cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw Error("Load failed");
      const next = readBoard(await response.json(), teaser.id);
      if (!controller.signal.aborted) { setBoard(next); setText(next.text); setLoadError(false); setConflict(false); setSaveError(false); setSaved(false); }
    }).catch(() => { if (!controller.signal.aborted) setLoadError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, teaser.id, request]);
  useEffect(() => () => { saveRequest.current?.abort(); }, []);
  const reload = () => {
    if (!canClose()) return;
    setLoading(true); setLoadError(false); setRequest(value => value + 1);
  };
  const save = async () => {
    if (!board || loading || busy.current || conflict || !dirty) return;
    const value = text, revision = board.revision, controller = new AbortController();
    saveRequest.current = controller; busy.current = true; setSaving(true); onBusyChange(true); setSaveError(false); setSaved(false);
    try {
      const response = await fetch(url, { method: "PUT", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: value, revision }) });
      if (response.status === 409) { if (!controller.signal.aborted) setConflict(true); return; }
      if (!response.ok) throw Error("Save failed");
      const next = readBoard(await response.json(), teaser.id);
      if (next.text !== value || next.revision <= revision) throw Error("Save unconfirmed");
      if (!controller.signal.aborted) { setBoard(next); setSaved(true); }
    } catch { if (!controller.signal.aborted) setSaveError(true); }
    finally {
      busy.current = false; saveRequest.current = null;
      if (!controller.signal.aborted) { setSaving(false); onBusyChange(false); }
    }
  };
  return <section className="teaser-whiteboard" aria-label={t("Question whiteboard")} aria-busy={loading || saving}>
    <h2>{t("Whiteboard")}</h2><p className="teaser-whiteboard-title">{teaser.title}</p>
    {loading ? <p role="status">{t("Loading whiteboard…")}</p> : null}
    {loadError ? <p role="alert" className="teaser-whiteboard-error">{t("The whiteboard could not be loaded.")} <button onClick={reload}>{t("Retry")}</button></p> : null}
    <label htmlFor={`whiteboard-${teaser.id}`}>{t("Your notes")}</label>
    <textarea id={`whiteboard-${teaser.id}`} value={text} maxLength={12000} disabled={!board || loading || saving}
      onChange={event => { setText(event.target.value); setSaved(false); }} spellCheck />
    <div className="teaser-whiteboard-actions">
      <button disabled={saving} onClick={() => { if (canClose()) onBack(); }}><ArrowLeft size={16} />{t("Back to teasers")}</button>
      <span>{text.length} / 12000</span>
      <button disabled={!board || loading || saving || conflict || !dirty} onClick={() => void save()}><Save size={16} />{t(saving ? "Saving…" : "Save whiteboard")}</button>
    </div>
    {saved && !dirty ? <p role="status">{t("Whiteboard saved.")}</p> : null}
    {saveError ? <p role="alert" className="teaser-whiteboard-error">{t("The whiteboard could not be saved. Your text is kept.")}</p> : null}
    {conflict ? <p role="alert" className="teaser-whiteboard-error">{t("This whiteboard changed elsewhere. Your text is kept. Reload before saving.")} <button disabled={saving || loading} onClick={reload}>{t("Reload whiteboard")}</button></p> : null}
    <p className="teaser-whiteboard-help">{t("Notes are saved separately for this question.")}</p>
  </section>;
});
