"use client";
import { memo, useState } from "react";
import type { LiveSessionItem } from "./SessionControls";
import { SessionMarkdown } from "./SessionMarkdown";
import { useUiText } from "@/lib/i18n/ui-language";
import { visibleUserText } from "@/lib/text/codex-visible-text";

const MessageBody = memo(function MessageBody({ message, truncatedLabel }: { message: LiveSessionItem; truncatedLabel: string }) {
  return <>
    {message.role === "tool" ? <pre className="overflow-auto whitespace-pre-wrap break-all text-xs text-white/60">{message.content}</pre> : <SessionMarkdown content={message.content} assets={message.assets} user={message.role === "user"} />}
    {message.truncated ? <p className="mt-2 text-[10px] text-amber-200/70">{truncatedLabel}</p> : null}
  </>;
});

function WorkProcess({ items }: { items: LiveSessionItem[] }) {
  const t = useUiText();
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)} className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2" aria-label={t("Work process")}>
    <summary className="cursor-pointer text-xs text-white/50">{t("Work process · {count} items", { count: items.length })}</summary>
    {/* Hidden work logs can contain hundreds of Markdown blocks and images. */}
    {open ? <div className="mt-3 space-y-3 border-l border-white/15 pl-3">{items.map(message => <div key={message.id}>
      {message.role === "tool" ? <p className="mb-1 text-[10px] text-white/40">{t("Tool")}{message.status === "inProgress" ? t(" · In progress") : message.status === "failed" ? t(" · Failed") : ""}</p> : null}
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
    {block.message.role !== "user" ? <div className="mb-1 text-[10px] font-semibold text-slate-300">Codex</div> : null}
    <MessageBody message={block.message} truncatedLabel={t("This message is long. View the rest in the desktop app.")} />
  </article>);
});
