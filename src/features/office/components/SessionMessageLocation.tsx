"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import type { LiveSessionItem, SessionClient } from "./SessionControls";
import { SessionTranscript } from "./SessionTranscript";
import { SearchSnippet, type MessageSearchTarget } from "./MessageSearchResults";
import { useUiText } from "@/lib/i18n/ui-language";

type ContextPage = { threadId: string; name: string; project: string; archived: boolean; messageId: string; messages: LiveSessionItem[]; olderOffset: number | null; newerOffset: number | null };
type State = Partial<ContextPage> & { requestId: string; busy: boolean; error: string };

// A temporary read-only view keeps the live transcript, scroll, workspace and
// terminal mounted beneath it. Archived conversations use the same viewer.
export function SessionMessageLocation({ client, target, onClose, headerStart }: { client: SessionClient; target: MessageSearchTarget; onClose: () => void; headerStart?: ReactNode }) {
  const t = useUiText(), scroll = useRef<HTMLDivElement>(null), positioned = useRef("");
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const [state, setState] = useState<State>({ requestId: "", busy: false, error: "" });
  const [retry, setRetry] = useState(0);
  const current = state.requestId === target.requestId;
  useEffect(() => {
    let stopped = false;
    void client.call("session.messageContext", target).then(value => {
      const result = value as ContextPage;
      if (result.threadId !== target.threadId || !result.messages.some(item => item.id === target.messageId)) throw new Error("This message is no longer available");
      if (!stopped) { positioned.current = ""; setState({ ...result, requestId: target.requestId, busy: false, error: "" }); }
    }).catch(cause => { if (!stopped) setState({ requestId: target.requestId, busy: false, error: cause instanceof Error ? cause.message : "Could not load this message. Please retry." }); });
    return () => { stopped = true; };
  }, [client, target, retry]);
  useLayoutEffect(() => {
    const node = scroll.current;
    if (!current || !node || !state.messages) return;
    if (anchor.current) { node.scrollTop = anchor.current.top + node.scrollHeight - anchor.current.height; anchor.current = null; }
    else if (positioned.current !== target.requestId) {
      const match = [...node.querySelectorAll<HTMLElement>("[data-message-id]")].find(item => item.dataset.messageId === target.messageId);
      if (match) { match.scrollIntoView?.({ block: "center" }); match.focus({ preventScroll: true }); positioned.current = target.requestId; }
    }
  }, [current, state.messages, target]);
  const more = async (offset: number, older: boolean) => {
    if (!current || state.busy) return;
    setState(previous => ({ ...previous, busy: true, error: "" }));
    const before = older && scroll.current ? { top: scroll.current.scrollTop, height: scroll.current.scrollHeight } : null;
    try {
      const page = await client.call("session.messageContext", { ...target, offset }) as ContextPage;
      setState(previous => {
        if (previous.requestId !== target.requestId) return previous;
        const items = older ? [...page.messages, ...(previous.messages || [])] : [...(previous.messages || []), ...page.messages];
        anchor.current = before;
        return { ...previous, busy: false, messages: [...new Map(items.map(item => [item.id, item])).values()], ...(older ? { olderOffset: page.olderOffset } : { newerOffset: page.newerOffset }) };
      });
    } catch (cause) { setState(previous => previous.requestId === target.requestId ? { ...previous, busy: false, error: cause instanceof Error ? cause.message : "Could not load this message. Please retry." } : previous); }
  };
  return <section className="session-message-location absolute inset-0 z-30 flex min-h-0 min-w-0 flex-col bg-[#111b27] text-white" aria-label={t("Message location")}>
    <header className="flex shrink-0 items-center gap-2 border-b border-white/10 p-3">
      {headerStart}<div className="min-w-0 flex-1"><strong className="block truncate text-sm">{current && state.name || target.name}</strong><small className="text-white/50">{current && state.project || target.project}{(current ? state.archived : target.archived) ? ` · ${t("Archived · Read only")}` : ` · ${t(target.turnCursor ? "Message search" : "Original message")}`}</small></div>
      <button type="button" className="session-action-back" onClick={onClose}><ArrowLeft size={14} />{t("Back to conversation")}</button>
    </header>
    <p className="message-location-snippet shrink-0 border-b border-white/10 px-4 py-2 text-xs"><SearchSnippet text={target.snippet} range={target.snippetMatchRange} /></p>
    <div ref={scroll} className="min-h-0 flex-1 overflow-auto px-4 py-3 [overflow-anchor:none]">
      {!current ? <p role="status" className="text-xs text-white/50">{t("Loading message…")}</p> : <>
        {state.error ? <p role="alert" className="mb-3 text-xs text-amber-200">{t(state.error)} <button type="button" className="underline" onClick={() => setRetry(value => value + 1)}>{t("Retry")}</button></p> : null}
        <div className="mx-auto max-w-3xl space-y-3">
          {state.olderOffset !== null && state.olderOffset !== undefined ? <button type="button" className="text-xs text-cyan-200" disabled={state.busy} onClick={() => void more(state.olderOffset!, true)}>{t("Load earlier context")}</button> : null}
          <SessionTranscript messages={state.messages || []} highlightedMessageId={target.messageId} />
          {state.newerOffset !== null && state.newerOffset !== undefined ? <button type="button" className="text-xs text-cyan-200" disabled={state.busy} onClick={() => void more(state.newerOffset!, false)}>{t("Load later context")}</button> : null}
        </div>
      </>}
    </div>
  </section>;
}
