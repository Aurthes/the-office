"use client";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { SessionClient } from "./SessionControls";
import { useUiText } from "@/lib/i18n/ui-language";
import { composerMarkupIndex, encodeReference, prepareComposerMessage, referenceLabel, type ComposerReference } from "./inlineReferences";

type Kind = "command" | "chat" | "file" | "skill" | "app";
type Option = { kind: Kind; id: string; name: string; description: string; disabled?: boolean };
type Result = { options: Option[]; available?: boolean; hint?: string };

export function useSessionComposer({ client, threadId, enabled, chatReferences, text, setText, input, onCommand, onOpenThread, onError }: {
  client: SessionClient; threadId: string; enabled: boolean; chatReferences: boolean; text: string; setText: (text: string) => void;
  input: RefObject<HTMLTextAreaElement | null>; onCommand: (command: string, argument: string) => void;
  onOpenThread?: (id: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useUiText();
  const { message: plainText, references } = prepareComposerMessage(text);
  const [picker, setPicker] = useState<Exclude<Kind, "command">>("chat");
  const [intent, setIntent] = useState<"reference" | "switch">("reference");
  const [caret, setCaret] = useState(plainText.length);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [result, setResult] = useState<(Result & { key: string; error?: string }) | null>(null);
  const [selected, setSelected] = useState(0);
  const pendingCaret = useRef<number | null>(null);
  let triggerText = plainText;
  for (const reference of references) triggerText = triggerText.slice(0, reference.start) + "\ufffc".repeat(reference.end - reference.start) + triggerText.slice(reference.end);
  const prefix = triggerText.slice(0, caret);
  const slash = /^\/([a-z-]*)$/.exec(plainText);
  const mention = /(?:^|\s)([@$])([^\n@$]*)$/.exec(prefix);
  const kind: Kind | null = enabled && dismissed !== text + ":" + caret ? slash ? "command" : mention ? mention[1] === "$" ? "skill" : picker : null : null;
  const query = slash ? slash[1] : mention?.[2] || "";
  const key = kind ? `${threadId}:${kind}:${query}:${intent}` : "";
  const visible = result?.key === key ? result : null;
  const options = visible?.options || [];
  const legacy = kind === "chat" && intent === "reference" && !chatReferences;
  useEffect(() => {
    if (!kind) return;
    let stopped = false;
    // Opening a picker needs no debounce; searching within it still does.
    const timer = setTimeout(() => {
      void client.call("session.composer.options", { threadId, kind, query }).then(value => {
        if (!stopped) { setResult({ ...value as Result, key }); setSelected(0); }
      }).catch(cause => { if (!stopped) setResult({ key, options: [], error: cause instanceof Error ? cause.message : "Could not load composer options" }); });
    }, query ? kind === "file" ? 180 : 80 : 0);
    return () => { stopped = true; clearTimeout(timer); };
  }, [client, threadId, kind, query, key]);
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    input.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    setCaret(pendingCaret.current); pendingCaret.current = null;
  }, [text, input]);
  const replaceRange = (start: number, end: number, replacement: string, displayLength = replacement.length) => {
    const next = text.slice(0, composerMarkupIndex(text, start, "start")) + replacement + text.slice(composerMarkupIndex(text, end, "end"));
    pendingCaret.current = start + displayLength; setText(next);
  };
  const replaceTrigger = (replacement: string, displayLength = replacement.length) => {
    const start = slash ? 0 : caret - (mention ? mention[1].length + mention[2].length : 0);
    replaceRange(start, slash ? plainText.length : caret, replacement, displayLength);
  };
  const choose = (option: Option) => {
    if (option.disabled || legacy) return;
    if (option.kind === "command") { onCommand(option.id, ""); return; }
    setDismissed(text + ":" + caret);
    if (option.kind === "chat" && intent === "switch") {
      void Promise.resolve().then(() => onOpenThread?.(option.id)).then(() => replaceTrigger("")).catch(cause => onError(cause instanceof Error ? cause.message : "Could not open this chat")); return;
    }
    if (new Set(references.map(item => item.kind + ":" + item.id)).size >= 8 && !references.some(item => item.kind === option.kind && item.id === option.id)) return;
    const reference: ComposerReference = { kind: option.kind, id: option.id, name: option.name };
    const space = /^\s/.test(plainText.slice(caret)) ? "" : " ";
    replaceTrigger(encodeReference(reference) + space, referenceLabel(reference).length + space.length); setPicker("chat"); setIntent("reference");
  };
  const open = (next: Exclude<Kind, "command">, mode: "reference" | "switch" = "reference") => {
    setPicker(next); setIntent(mode); setDismissed(null);
    const trigger = next === "skill" ? "$" : "@";
    if (/^\//.test(plainText)) replaceRange(0, plainText.length, trigger);
    else replaceRange(input.current?.selectionStart ?? caret, input.current?.selectionEnd ?? caret, trigger);
  };
  const handleCommand = (value: string) => {
    if (!enabled) return false;
    const command = /^\/([a-z-]+)(?:\s+([\s\S]*))?$/.exec(value.trim());
    if (!command) return false;
    setDismissed(text + ":" + caret); onCommand(command[1], command[2]?.trim() || ""); return true;
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
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
  const menu = kind ? <section aria-label={t(kind === "command" ? "Codex commands" : "Codex references")} className="mb-2 overflow-hidden rounded-xl border border-white/15 bg-[#172330] shadow-lg">
    {kind !== "command" && mention?.[1] !== "$" ? <div className="flex gap-1 border-b border-white/10 p-1" aria-label={t("Reference categories")}>{([ ["chat", intent === "switch" ? "Chats" : "Workers / chats"], ["file", "Files"], ["skill", "Skills"], ["app", "Apps"] ] as const).map(([value, label]) => <button type="button" key={value} onMouseDown={event => event.preventDefault()} onClick={() => { setPicker(value); setIntent(value === "chat" ? intent : "reference"); }} className={"min-h-9 rounded-lg px-2 text-xs " + (kind === value ? "bg-white/10 text-white" : "text-white/55")}>{t(label)}</button>)}</div> : null}
    {legacy ? <p className="p-3 text-amber-100">{t("This older chat has no Office reference tools. Start a new chat to reference existing workers.")}</p> : null}
    <div role="listbox" aria-label={t("Composer options")} className="max-h-52 overflow-y-auto">{options.map((option, index) => <button type="button" role="option" aria-selected={index === selected} aria-disabled={Boolean(option.disabled || legacy)} key={option.kind + option.id} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setSelected(index)} onClick={() => choose(option)} className={"block min-h-11 w-full px-3 py-2 text-left " + (index === selected ? "bg-cyan-500/15" : "hover:bg-white/5") + (option.disabled || legacy ? " opacity-40" : "")}>
      <span className="block truncate text-sm text-white">{option.name}</span><span className="block truncate text-[11px] text-white/50">{option.disabled ? t("Unavailable in the Office runtime") : t(option.description)}</span>
    </button>)}</div>
    {!visible ? <p role="status" className="p-3 text-white/50">{t("Loading options…")}</p> : visible.error ? <p role="alert" className="p-3 text-amber-100">{t(visible.error)}</p> : !options.length ? <p role="status" className="p-3 text-white/50">{t(visible.hint || "No matching options in this Office runtime")}</p> : null}
  </section> : null;
  return { references, menu, open, replaceRange, handleCommand, handleKeyDown, onSelect: () => setCaret(input.current?.selectionStart ?? plainText.length), clear: () => { setDismissed(null); setPicker("chat"); setIntent("reference"); } };
}
