"use client";
import { memo, useState } from "react";
import type { LiveSessionItem } from "./SessionControls";
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

function WorkProcess({ items }: { items: LiveSessionItem[] }) {
  const t = useUiText();
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)} className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2" aria-label={t("Work process")}>
    <summary className="cursor-pointer text-xs text-white/50">{t("Work process · {count} items", { count: items.length })}</summary>
    {/* Hidden work logs can contain hundreds of Markdown blocks and images. */}
    {open ? <div className="mt-2 space-y-2 border-l border-white/15 pl-3">{items.map(message => message.role === "tool" ? <ToolSummary key={message.id} message={message} /> : <div key={message.id}>
      <MessageBody message={message} truncatedLabel={t("This message is long. View the rest in the desktop app.")} />
    </div>)}</div> : null}
  </details>;
}

export const SessionTranscript = memo(function SessionTranscript({ messages }: { messages: LiveSessionItem[] }) {
  const t = useUiText();
  const groups = new Map<string, { id: string; items: LiveSessionItem[] }>();
  const blocks: ({ message: LiveSessionItem } | { group: { id: string; items: LiveSessionItem[] } })[] = [];
  for (const message of messages) {
    if (message.role === "user" && !visibleUserText(message.content).trim() && !message.assets?.some(asset => asset.inline || asset.attached)) continue;
    if (message.role === "tool" || message.phase === "commentary") {
      const id = message.turnId || message.id;
      let group = groups.get(id);
      if (!group) { group = { id, items: [] }; groups.set(id, group); blocks.push({ group }); }
      group.items.push(message);
    } else blocks.push({ message });
  }
  return blocks.map(block => "group" in block ? <WorkProcess key={`process:${block.group.id}`} items={block.group.items} /> : <article key={block.message.id} aria-label={block.message.role === "user" ? t("You") : "Codex"} className={block.message.role === "user" ? "session-user-message" : "mr-2 rounded-lg border border-slate-500/40 bg-[#242932] px-3 py-2.5 text-slate-100"}>
    {block.message.role !== "user" || block.message.source === "voice" ? <div className="mb-1 text-[10px] font-semibold text-slate-300">{block.message.role === "user" ? t("You") : "Codex"}{block.message.source === "voice" ? ` · ${t("Voice")}` : ""}</div> : null}
    <MessageBody message={block.message} truncatedLabel={t("This message is long. View the rest in the desktop app.")} />
  </article>);
});
