"use client";
import type { LiveSessionItem } from "./SessionControls";
import { SessionMarkdown } from "./SessionMarkdown";
import { useUiText } from "@/lib/i18n/ui-language";

export function SessionTranscript({ messages }: { messages: LiveSessionItem[] }) {
  const t = useUiText();
  const groups = new Map<string, { id: string; items: LiveSessionItem[] }>();
  const blocks: ({ message: LiveSessionItem } | { group: { id: string; items: LiveSessionItem[] } })[] = [];
  for (const message of messages) {
    if (message.role === "tool" || message.phase === "commentary") {
      const id = message.turnId || message.id;
      let group = groups.get(id);
      if (!group) { group = { id, items: [] }; groups.set(id, group); blocks.push({ group }); }
      group.items.push(message);
    } else blocks.push({ message });
  }
  const body = (message: LiveSessionItem) => <>
    {message.role === "tool" ? <pre className="overflow-auto whitespace-pre-wrap break-all text-xs text-white/60">{message.content}</pre> : <SessionMarkdown content={message.content} assets={message.assets} user={message.role === "user"} />}
    {message.truncated ? <p className="mt-2 text-[10px] text-amber-200/70">{t("This message is long. View the rest in the desktop app.")}</p> : null}
  </>;
  return blocks.map(block => "group" in block ? <details key={`process:${block.group.id}`} className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2" aria-label={t("Work process")}>
    <summary className="cursor-pointer text-xs text-white/50">{t("Work process · {count} items", { count: block.group.items.length })}</summary>
    <div className="mt-3 space-y-3 border-l border-white/15 pl-3">{block.group.items.map(message => <div key={message.id}>
      {message.role === "tool" ? <p className="mb-1 text-[10px] text-white/40">{t("Tool")}{message.status === "inProgress" ? t(" · In progress") : message.status === "failed" ? t(" · Failed") : ""}</p> : null}
      {body(message)}
    </div>)}</div>
  </details> : <article key={block.message.id} className={`rounded-lg border px-3 py-2.5 ${block.message.role === "user" ? "ml-6 border-cyan-400/40 bg-[#0b5268] text-cyan-50" : "mr-2 border-slate-500/40 bg-[#242932] text-slate-100"}`}>
    <div className={`mb-1 text-[10px] font-semibold ${block.message.role === "user" ? "text-cyan-100" : "text-slate-300"}`}>{block.message.role === "user" ? t("You") : "Codex"}</div>
    {body(block.message)}
  </article>);
}
