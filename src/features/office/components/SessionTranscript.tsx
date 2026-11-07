"use client";
import { memo, useState } from "react";
import { GitFork } from "lucide-react";
import type { LiveSessionItem, ReplySource } from "./SessionControls";
import { SessionMarkdown } from "./SessionMarkdown";
import { useUiText } from "@/lib/i18n/ui-language";
import { visibleUserText } from "@/lib/text/codex-visible-text";

const MessageTime = memo(function MessageTime({ timestamp }: { timestamp?: number }) {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return <time className="session-message-time" dateTime={date.toISOString()} title={date.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" })}>
    {date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
  </time>;
});

const MessageBody = memo(function MessageBody({ message, truncatedLabel }: { message: LiveSessionItem; truncatedLabel: string }) {
  return <>
    <SessionMarkdown content={message.content} assets={message.assets} user={message.role === "user"} />
    {message.truncated ? <p className="mt-2 text-[10px] text-amber-200/70">{truncatedLabel}</p> : null}
    <MessageTime timestamp={message.timestamp} />
  </>;
});

const ToolSummary = memo(function ToolSummary({ message }: { message: LiveSessionItem }) {
  const t = useUiText();
  const firstLine = message.content.trimStart().split(/\r?\n/, 1)[0].replace(/\s+/g, " ");
  const summary = firstLine.length > 120 ? `${firstLine.slice(0, 119)}…` : firstLine || t("Tool");
  return <p className="flex min-w-0 items-center gap-2 text-xs text-white/55">
    <span aria-hidden="true" className="shrink-0 text-white/30">›</span>
    <span className="min-w-0 truncate font-mono">{summary}</span>
    {message.status === "inProgress" || message.status === "failed" ? <span className={`shrink-0 text-[10px] ${message.status === "failed" ? "text-rose-300" : "text-white/40"}`}>{t(message.status === "inProgress" ? " · In progress" : " · Failed")}</span> : null}
  </p>;
});

function ToolCalls({ items }: { items: LiveSessionItem[] }) {
  const t = useUiText();
  const [open, setOpen] = useState(false);
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} aria-label={t("Tool calls")}>
    <summary className="cursor-pointer text-xs text-white/45">{t("Tool calls · {count} items", { count: items.length })}</summary>
    {open ? <div className="mt-2 space-y-3">{items.map(message => <div key={message.id}>
      <ToolSummary message={message} />
      {message.content.includes("\n") || message.content.length > 120 ? <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs text-white/50">{message.content}</pre> : null}
      {message.truncated ? <p className="mt-1 text-[10px] text-amber-200/70">{t("This message is long. View the rest in the desktop app.")}</p> : null}
    </div>)}</div> : null}
  </details>;
}

function WorkProcess({ items, defaultOpen, highlightedMessageId }: { items: LiveSessionItem[]; defaultOpen: boolean; highlightedMessageId?: string }) {
  const t = useUiText();
  const [open, setOpen] = useState(defaultOpen);
  const blocks: ({ message: LiveSessionItem } | { tools: LiveSessionItem[] })[] = [];
  for (const message of items) {
    const previous = blocks.at(-1);
    if (message.role !== "tool") blocks.push({ message });
    else if (previous && "tools" in previous) previous.tools.push(message);
    else blocks.push({ tools: [message] });
  }
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2" aria-label={t("Work process")}>
    <summary className="cursor-pointer text-xs text-white/50">{t("Work process · {count} items", { count: items.length })}</summary>
    {/* Hidden work logs can contain hundreds of Markdown blocks and images. */}
    {open ? <div className="mt-2 space-y-2 border-l border-white/15 pl-3">{blocks.map(block => "tools" in block ? <ToolCalls key={block.tools[0].id} items={block.tools} /> : <div key={block.message.id} data-message-id={block.message.id} data-search-match={block.message.id === highlightedMessageId || undefined} tabIndex={block.message.id === highlightedMessageId ? -1 : undefined}>
      <MessageBody message={block.message} truncatedLabel={t("This message is long. View the rest in the desktop app.")} />
    </div>)}</div> : null}
  </details>;
}

export const SessionTranscript = memo(function SessionTranscript({ messages, activeTurnId = null, onForkFrom, forkDisabled = false, highlightedMessageId, onOpenQuestion }: { messages: LiveSessionItem[]; activeTurnId?: string | null; onForkFrom?: (lastTurnId: string) => void; forkDisabled?: boolean; highlightedMessageId?: string; onOpenQuestion?: (source: ReplySource) => void }) {
  const t = useUiText();
  const answeredTurns = new Set(messages.filter(message => message.role === "assistant" && message.phase === "final_answer").map(message => message.turnId));
  const forkPoints = new Map<string, string>();
  for (const message of messages) {
    if (message.turnId && message.turnId !== activeTurnId && message.role === "assistant" && message.source !== "voice" && message.phase !== "commentary" && message.phase !== "partial_answer") forkPoints.set(message.turnId, message.id);
  }
  const blocks: ({ message: LiveSessionItem } | { group: { id: string; turnId?: string; items: LiveSessionItem[] } })[] = [];
  for (const message of messages) {
    if (message.role === "user" && !visibleUserText(message.content).trim() && !message.assets?.some(asset => asset.inline || asset.attached)) continue;
    if (message.role === "tool" || message.phase === "commentary") {
      // Steers share a turn ID. Only adjacent work belongs in the same box,
      // otherwise new responses jump above the user message that prompted them.
      const previous = blocks.at(-1);
      if (message.turnId && previous && "group" in previous && previous.group.turnId === message.turnId) previous.group.items.push(message);
      else blocks.push({ group: { id: message.id, turnId: message.turnId, items: [message] } });
    } else blocks.push({ message });
  }
  return blocks.map(block => {
    if ("group" in block) {
      const working = block === blocks.at(-1) && block.group.turnId === activeTurnId && !answeredTurns.has(block.group.turnId);
      // Reset the default only when work starts or the official answer begins.
      const highlight = block.group.items.some(item => item.id === highlightedMessageId) ? highlightedMessageId : undefined;
      return <WorkProcess key={`process:${block.group.id}:${working}:${highlight || ""}`} items={block.group.items} defaultOpen={working || Boolean(highlight)} highlightedMessageId={highlight} />;
    }
    return <article key={block.message.id} data-message-id={block.message.id} data-search-match={block.message.id === highlightedMessageId || undefined} tabIndex={block.message.id === highlightedMessageId ? -1 : undefined} aria-label={block.message.role === "user" ? t("You") : "Codex"} className={block.message.role === "user" ? "session-user-message" : "mr-2 rounded-lg border border-slate-500/40 bg-[#242932] px-3 py-2.5 text-slate-100"}>
    {block.message.role !== "user" || block.message.source === "voice" ? <div className="mb-1 text-[10px] font-semibold text-slate-300">{block.message.role === "user" ? t("You") : "Codex"}{block.message.source === "voice" ? ` · ${t("Voice")}` : ""}</div> : null}
    {block.message.role === "assistant" && block.message.replyContext ? <div className="mb-2 space-y-1 border-l-2 border-teal-400/40 pl-2 text-xs text-slate-400" aria-label={t("Answering")}>
      {block.message.replyContext.taskTitle ? <p className="truncate" title={block.message.replyContext.taskTitle}>{t("Task")}: {block.message.replyContext.taskTitle}</p> : null}
      {block.message.replyContext.sources.map((source, index, sources) => <button type="button" key={`${source.threadId}:${source.turnId}:${source.itemId}`} disabled={!onOpenQuestion} onClick={() => onOpenQuestion?.(source)} className="block w-full truncate text-left text-teal-200/80 hover:text-teal-100 disabled:text-slate-400" title={`${t("View original question")}: ${source.excerpt}`}>{t(index === sources.length - 1 ? "Answering" : index === 0 ? "Original request" : "Related question")}: {source.excerpt}</button>)}
      {!block.message.replyContext.sources.length ? <p>{t("Original question not recorded")}</p> : null}
    </div> : null}
    <MessageBody message={block.message} truncatedLabel={t("This message is long. View the rest in the desktop app.")} />
    {onForkFrom && block.message.turnId && forkPoints.get(block.message.turnId) === block.message.id ? <button type="button" disabled={forkDisabled} onClick={() => onForkFrom(block.message.turnId!)} className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-[11px] text-slate-400 hover:bg-white/5 hover:text-teal-200 disabled:opacity-40" title={t("Keep this turn and earlier context; later messages are excluded.")}><GitFork size={13} aria-hidden="true" />{t("Fork from here")}</button> : null}
  </article>;
  });
});
