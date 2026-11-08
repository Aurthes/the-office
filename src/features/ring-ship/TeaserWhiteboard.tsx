"use client";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import type { InterfaceAgent } from "@/lib/office/agent-interface";
import { solutionBytes, type TeaserSolution, type TeaserSolutionSender } from "@/features/office/hooks/useTeaserSolutions";
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
  target?: InterfaceAgent | null; unavailableReason?: string | null; solutionSender?: TeaserSolutionSender; onOpenSession?: (id: string) => void;
}>(function TeaserWhiteboard({ teaser, onBack, onBusyChange, target, unavailableReason, solutionSender, onOpenSession }, ref) {
  const t = useUiText();
  const [board, setBoard] = useState<Whiteboard | null>(null), [text, setText] = useState("");
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false), [saveError, setSaveError] = useState(false);
  const [conflict, setConflict] = useState(false), [saved, setSaved] = useState(false), [request, setRequest] = useState(0);
  const [sending, setSending] = useState(false), [sendError, setSendError] = useState("");
  const currentTarget = useRef(target);
  useLayoutEffect(() => { currentTarget.current = target; }, [target]);
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
  const attempt = solutionSender?.getAttempt(teaser.id);
  const unresolved = attempt?.status === "sending" || attempt?.status === "unknown";
  const alreadySent = attempt?.status === "accepted" && attempt.text === text && attempt.targetId === target?.id;
  const oversized = solutionBytes({ teaserId: teaser.id, title: teaser.title, text }) > 32000;
  const targetAvailable = !!target && !target.needsInput && ["idle", "running"].includes(target.status || "") && !!solutionSender;
  const persistSnapshot = async (value: string, revision: number, controller: AbortController) => {
    try {
      const response = await fetch(url, { method: "PUT", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: value, revision }) });
      if (response.status === 409) { if (!controller.signal.aborted) setConflict(true); return null; }
      if (!response.ok) throw Error("Save failed");
      const next = readBoard(await response.json(), teaser.id);
      if (next.text !== value || next.revision <= revision) throw Error("Save unconfirmed");
      if (controller.signal.aborted) return null;
      setBoard(next); setSaved(true); return next;
    } catch { if (!controller.signal.aborted) setSaveError(true); return null; }
  };
  const save = async (sendSolution = false) => {
    if (!board || loading || busy.current || conflict || (!sendSolution && !dirty)) return;
    const previous = solutionSender?.getAttempt(teaser.id);
    if (sendSolution && (!targetAvailable || !text.trim() || oversized || previous && (["sending", "unknown"].includes(previous.status) || previous.status === "accepted" && previous.text === text && previous.targetId === target?.id))) return;
    const snapshot: TeaserSolution | null = sendSolution && target ? { teaserId: teaser.id, title: teaser.title, text, targetId: target.id, targetName: target.name } : null;
    const value = text, revision = board.revision, controller = new AbortController();
    saveRequest.current = controller; busy.current = true; setSaving(true); setSending(sendSolution); onBusyChange(true); setSaveError(false); setSaved(false); setSendError("");
    try {
      const next = await persistSnapshot(value, revision, controller);
      if (!next || !snapshot || controller.signal.aborted) return;
      const latest = currentTarget.current;
      if (!latest || latest.id !== snapshot.targetId || latest.needsInput || !["idle", "running"].includes(latest.status || "")) throw Error("The Teaser target changed or is unavailable. Nothing was sent.");
      await solutionSender!.send(snapshot);
    } catch (cause) { if (!controller.signal.aborted) setSendError(cause instanceof Error ? cause.message : "The solution could not be sent. Your notes are kept."); }
    finally {
      busy.current = false; saveRequest.current = null;
      if (!controller.signal.aborted) { setSaving(false); setSending(false); onBusyChange(false); }
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
      <button disabled={!board || loading || saving || conflict || !dirty} onClick={() => void save(false)}><Save size={16} />{t(saving ? "Saving…" : "Save whiteboard")}</button>
      <button disabled={!board || loading || saving || conflict || !targetAvailable || !text.trim() || oversized || unresolved || alreadySent} onClick={() => void save(true)}>{t(sending ? "Saving and sending…" : "Save and send solution")}</button>
    </div>
    {!targetAvailable ? <p role="status">{t(unavailableReason || (target?.needsInput ? "Teaser needs your reply in chat before another solution." : "Teaser sending is unavailable."))}</p> : target?.status === "running" ? <p className="teaser-whiteboard-help">{t("Teaser is working. Sending now adds input to its running task (steer).")}</p> : null}
    {oversized ? <p role="alert" className="teaser-whiteboard-error">{t("The solution exceeds 32,000 UTF-8 bytes. Shorten it before sending; notes can still be saved.")}</p> : null}
    {sendError ? <p role="alert" className="teaser-whiteboard-error">{t(sendError)}</p> : null}
    {attempt ? <div className="teaser-solution-receipt" data-delivery={attempt.status}>
      <p role={attempt.status === "failed" || attempt.status === "unknown" ? "alert" : "status"}>{t(attempt.status === "sending" ? "Sending solution…" : attempt.status === "unknown" ? "Delivery is unconfirmed. Check Teaser chat before sending again; this will not retry automatically." : attempt.status === "failed" ? "The solution was rejected. Your notes are kept." : attempt.outcome === "steered" ? "Solution sent as additional input to the running task." : attempt.outcome === "started" ? "Solution sent. Teaser started working." : "Solution delivery confirmed in chat.")}</p>
      {onOpenSession ? <button type="button" disabled={saving} onClick={() => onOpenSession(attempt.targetId)}>{t("Open Teaser chat")}</button> : null}
    </div> : null}
    {saved && !dirty ? <p role="status">{t("Whiteboard saved.")}</p> : null}
    {saveError ? <p role="alert" className="teaser-whiteboard-error">{t("The whiteboard could not be saved. Your text is kept.")}</p> : null}
    {conflict ? <p role="alert" className="teaser-whiteboard-error">{t("This whiteboard changed elsewhere. Your text is kept. Reload before saving.")} <button disabled={saving || loading} onClick={reload}>{t("Reload whiteboard")}</button></p> : null}
    <p className="teaser-whiteboard-help">{t("Notes are saved separately for this question.")}</p>
  </section>;
});
