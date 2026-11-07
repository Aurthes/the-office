"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Lightbulb, RefreshCw, X } from "lucide-react";
import { ChatMarkdown } from "@/components/chat-markdown";
import { useUiText } from "@/lib/i18n/ui-language";
import { TEASER_STATUS_LABELS, type Teaser, type TeaserStatus } from "@/lib/office/teasers";
import "./scheduled-tasks.css";
import "./teaser-board.css";

export function TeaserDashboard({ onClose }: { onClose: () => void }) {
  const t = useUiText(), dialog = useRef<HTMLDialogElement>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [teasers, setTeasers] = useState<Teaser[]>([]);
  const [filter, setFilter] = useState<"all" | TeaserStatus>("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState(0);
  useEffect(() => { const frame = requestAnimationFrame(() => setPortal(document.body)); return () => cancelAnimationFrame(frame); }, []);
  useEffect(() => {
    const node = dialog.current;
    if (!portal || !node) return;
    node.showModal();
    return () => node.close();
  }, [portal]);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const response = await fetch("/api/office/teasers", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("The teaser board could not be loaded.");
        const result = await response.json() as { teasers: Teaser[] };
        if (!Array.isArray(result.teasers)) throw new Error("The teaser board could not be loaded.");
        if (!controller.signal.aborted) { setTeasers(result.teasers); setError(""); }
      } catch {
        if (!controller.signal.aborted) setError("The teaser board could not be loaded.");
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    document.addEventListener("visibilitychange", load);
    window.addEventListener("focus", load);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", load); window.removeEventListener("focus", load); };
  }, [request]);
  if (!portal) return null;
  const finished = teasers.filter(row => row.status === "finished").length;
  const rows = filter === "all" ? teasers : teasers.filter(row => row.status === filter);
  return createPortal(<dialog ref={dialog} className="schedules-dialog teaser-dialog" aria-labelledby="teaser-title"
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="schedules-frame">
      <header className="schedules-header"><span><Lightbulb size={19} /><strong id="teaser-title">{t("Teaser board")}</strong></span>
        <button type="button" aria-label={t("Refresh teasers")} disabled={loading} onClick={() => { setLoading(true); setRequest(value => value + 1); }}><RefreshCw size={15} /></button>
        <button type="button" aria-label={t("Close teaser board")} onClick={onClose}><X size={19} /></button>
      </header>
      <div className="schedules-content">
        <div className="teaser-intro"><div><span className="schedules-eyebrow">{t("Break room")}</span><h1>{t("Take a brain break")}</h1><p>{t("Small challenges. Fresh perspectives. Share the idea that made it click.")}</p></div>
          <div className="teaser-progress" aria-label={t("Teasers finished")}><CheckCircle2 size={20} /><strong>{finished}<span> / {teasers.length}</span></strong><small>{t("Finished")}</small></div>
        </div>
        <div className="teaser-filters" role="group" aria-label={t("Teaser status")}>
          {(["all", "open", "in_progress", "finished"] as const).map(status => <button type="button" key={status} aria-pressed={filter === status} onClick={() => setFilter(status)}>
            {t(status === "all" ? "All" : TEASER_STATUS_LABELS[status])}{" "}<span>{status === "all" ? teasers.length : teasers.filter(row => row.status === status).length}</span>
          </button>)}
        </div>
        {error ? <p role="alert" className="schedules-error">{t(error)} {t("Use Refresh to try again.")}</p> : null}
        {loading && !teasers.length ? <p role="status" className="schedules-empty">{t("Loading teasers…")}</p> : null}
        {!loading && !error && !rows.length ? <div className="schedules-empty"><Lightbulb size={32} /><h3>{t(teasers.length ? "No teasers with this status." : "The next good question belongs here.")}</h3><p>{t("Ask teaser to drop a challenge on the board.")}</p></div> : null}
        <div className="teaser-list">{rows.map(row => <article key={row.id} className="teaser-card" data-teaser-id={row.id} data-status={row.status}>
          <header><span className="schedule-status" data-status={row.status}>{t(TEASER_STATUS_LABELS[row.status])}</span><small>{row.author} · {new Date(row.updatedAt).toLocaleDateString()}</small></header>
          <h2>{row.title}</h2><div className="teaser-markdown"><ChatMarkdown>{row.prompt}</ChatMarkdown></div>
          {row.status === "finished" ? <details className="teaser-solution"><summary>{t("View answer & key idea")}</summary>
            <h3>{t("Key idea")}</h3><div className="teaser-markdown"><ChatMarkdown>{row.summary}</ChatMarkdown></div>
            <h3>{t("Answer")}</h3><div className="teaser-markdown"><ChatMarkdown>{row.answer}</ChatMarkdown></div>
          </details> : null}
        </article>)}</div>
      </div>
      <footer className="schedules-footer">{t("Finished teasers keep their answer and a short explanation of the key idea.")}</footer>
    </div>
  </dialog>, portal);
}
