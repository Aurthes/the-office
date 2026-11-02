"use client";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { X } from "lucide-react";
import type { SessionClient } from "./SessionControls";
import { useUiText } from "@/lib/i18n/ui-language";

type Kind = "command" | "chat" | "file" | "skill" | "app";
export type ComposerReference = { kind: Exclude<Kind, "command">; id: string; name: string };
type Option = { kind: Kind; id: string; name: string; description: string; disabled?: boolean };
type Result = { options: Option[]; available?: boolean; hint?: string };
const drafts = new Map<string, ComposerReference[]>();

export function useSessionComposer({ client, threadId, enabled, chatReferences, text, setText, input, onCommand, onOpenThread, onError }: {
  client: SessionClient; threadId: string; enabled: boolean; chatReferences: boolean; text: string; setText: (text: string) => void;
  input: RefObject<HTMLTextAreaElement | null>; onCommand: (command: string, argument: string) => void;
  onOpenThread?: (id: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useUiText();
  const [references, setReferences] = useState<ComposerReference[]>(() => drafts.get(threadId) || []);
  const updateReferences = (next: ComposerReference[]) => { if (next.length) drafts.set(threadId, next); else drafts.delete(threadId); setReferences(next); };
  const [picker, setPicker] = useState<Exclude<Kind, "command">>("chat");
  const [intent, setIntent] = useState<"reference" | "switch">("reference");
  const [caret, setCaret] = useState(text.length);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [result, setResult] = useState<(Result & { key: string; error?: string }) | null>(null);
  const [selected, setSelected] = useState(0);
  const pendingCaret = useRef<number | null>(null);
  const prefix = text.slice(0, caret);
  const slash = /^\/([a-z-]*)$/.exec(text);
  const mention = /(?:^|\s)([@$])([^\n]*)$/.exec(prefix);
  const kind: Kind | null = enabled && dismissed !== text + ":" + caret ? slash ? "command" : mention ? mention[1] === "$" ? "skill" : picker : null : null;
  const query = slash ? slash[1] : mention?.[2] || "";
  const key = kind ? `${threadId}:${kind}:${query}:${intent}` : "";
  const visible = result?.key === key ? result : null;
  const options = visible?.options || [];
  const legacy = kind === "chat" && intent === "reference" && !chatReferences;
  useEffect(() => {
    if (!kind) return;
    let stopped = false;
    const timer = setTimeout(() => {
      void client.call("session.composer.options", { threadId, kind, query }).then(value => {
        if (!stopped) { setResult({ ...value as Result, key }); setSelected(0); }
      }).catch(cause => { if (!stopped) setResult({ key, options: [], error: cause instanceof Error ? cause.message : "Could not load composer options" }); });
    }, kind === "file" ? 180 : 80);
    return () => { stopped = true; clearTimeout(timer); };
  }, [client, threadId, kind, query, key]);
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    input.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    setCaret(pendingCaret.current); pendingCaret.current = null;
  }, [text, input]);
  const replaceTrigger = (replacement: string) => {
    const start = slash ? 0 : caret - (mention ? mention[1].length + mention[2].length : 0);
    const next = text.slice(0, start) + replacement + text.slice(slash ? text.length : caret);
    pendingCaret.current = start + replacement.length; setText(next);
  };
  const choose = (option: Option) => {
    if (option.disabled || legacy) return;
    if (option.kind === "command") { onCommand(option.id, ""); return; }
    setDismissed(text + ":" + caret);
    if (option.kind === "chat" && intent === "switch") {
      void Promise.resolve().then(() => onOpenThread?.(option.id)).then(() => replaceTrigger("")).catch(cause => onError(cause instanceof Error ? cause.message : "Could not open this chat")); return;
    }
    if (references.length >= 8 && !references.some(item => item.kind === option.kind && item.id === option.id)) return;
    if (!references.some(item => item.kind === option.kind && item.id === option.id)) updateReferences([...references, { kind: option.kind, id: option.id, name: option.name }]);
    replaceTrigger(""); setPicker("chat"); setIntent("reference");
  };
  const open = (next: Exclude<Kind, "command">, mode: "reference" | "switch" = "reference") => {
    setPicker(next); setIntent(mode); setDismissed(null); pendingCaret.current = 1; setText(next === "skill" ? "$" : "@");
  };
  const handleCommand = (value: string) => {
    if (!enabled) return false;
    const command = /^\/([a-z-]+)(?:\s+([\s\S]*))?$/.exec(value.trim());
    if (!command) return false;
    setDismissed(text + ":" + caret); onCommand(command[1], command[2]?.trim() || ""); return true;
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || !kind) return false;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDismissed(text + ":" + caret); return true; }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && options.length) {
      event.preventDefault(); setSelected(old => (old + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length); return true;
    }
    if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && options.length) {
      event.preventDefault(); choose(options[selected] || options[0]); return true;
    }
    return false;
  };
  const chips = references.length ? <div aria-label={t("Message references")} className="mb-2 flex flex-wrap gap-2">{references.map(item => <span key={item.kind + item.id} className="inline-flex max-w-full items-center gap-1 rounded-lg border border-cyan-300/25 bg-cyan-900/15 pl-2 text-cyan-100">
    <span className="truncate">{item.kind === "skill" ? "$" : "@"}{item.name}</span><button type="button" aria-label={t("Remove reference {name}", { name: item.name })} onClick={() => updateReferences(references.filter(ref => ref !== item))} className="grid min-h-9 min-w-9 place-items-center"><X size={13} /></button>
  </span>)}</div> : null;
  const menu = kind ? <section aria-label={t(kind === "command" ? "Codex commands" : "Codex references")} className="mb-2 overflow-hidden rounded-xl border border-white/15 bg-[#172330] shadow-lg">
    {kind !== "command" && mention?.[1] !== "$" ? <div className="flex gap-1 border-b border-white/10 p-1" aria-label={t("Reference categories")}>{([ ["chat", intent === "switch" ? "Chats" : "Workers / chats"], ["file", "Files"], ["skill", "Skills"], ["app", "Apps"] ] as const).map(([value, label]) => <button type="button" key={value} onMouseDown={event => event.preventDefault()} onClick={() => { setPicker(value); setIntent(value === "chat" ? intent : "reference"); }} className={"min-h-9 rounded-lg px-2 text-xs " + (kind === value ? "bg-white/10 text-white" : "text-white/55")}>{t(label)}</button>)}</div> : null}
    {legacy ? <p className="p-3 text-amber-100">{t("This older chat has no Office reference tools. Start a new chat to reference existing workers.")}</p> : null}
    <div role="listbox" aria-label={t("Composer options")} className="max-h-52 overflow-y-auto">{options.map((option, index) => <button type="button" role="option" aria-selected={index === selected} aria-disabled={Boolean(option.disabled || legacy)} key={option.kind + option.id} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setSelected(index)} onClick={() => choose(option)} className={"block min-h-11 w-full px-3 py-2 text-left " + (index === selected ? "bg-cyan-500/15" : "hover:bg-white/5") + (option.disabled || legacy ? " opacity-40" : "")}>
      <span className="block truncate text-sm text-white">{option.name}</span><span className="block truncate text-[11px] text-white/50">{option.disabled ? t("Unavailable in the Office runtime") : t(option.description)}</span>
    </button>)}</div>
    {!visible ? <p role="status" className="p-3 text-white/50">{t("Loading options…")}</p> : visible.error ? <p role="alert" className="p-3 text-amber-100">{t(visible.error)}</p> : !options.length ? <p role="status" className="p-3 text-white/50">{t(visible.hint || "No matching options in this Office runtime")}</p> : null}
  </section> : null;
  return { references, chips, menu, open, handleCommand, handleKeyDown, onSelect: () => setCaret(input.current?.selectionStart ?? text.length), clear: () => { updateReferences([]); setDismissed(null); setPicker("chat"); setIntent("reference"); } };
}
