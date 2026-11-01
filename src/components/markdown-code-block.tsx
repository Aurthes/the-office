"use client";

import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { Check, CircleAlert, Copy } from "lucide-react";
import type { Components } from "react-markdown";
import { useUiText } from "@/lib/i18n/ui-language";

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Self-hosted HTTP pages may not have the Clipboard API.
  const input = document.createElement("textarea");
  const focused = document.activeElement;
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  // Keep the fallback inside a modal dialog when one is open.
  (focused?.closest("dialog[open]") ?? document.body).append(input);
  try {
    input.select();
    if (!document.execCommand("copy")) throw new Error("Copy failed");
  } finally {
    input.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
  }
}

function MarkdownCodeBlock({ children, className }: ComponentPropsWithoutRef<"pre">) {
  const t = useUiText();
  const pre = useRef<HTMLPreElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const label = t(status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : "Copy code");

  const copy = async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      await copyText(pre.current?.textContent ?? "");
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    timer.current = setTimeout(() => setStatus("idle"), 2500);
  };

  return <div className="markdown-code-block">
    <button type="button" className="markdown-code-copy" data-status={status} aria-label={t("Copy code")} title={label} onClick={() => void copy()}>
      {status === "copied" ? <Check size={14} aria-hidden="true" /> : status === "failed" ? <CircleAlert size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      <span className="sr-only" role="status">{t(status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : "Copy")}</span>
    </button>
    <pre className={className} ref={pre}>{children}</pre>
  </div>;
}

export const markdownCodeComponents: Components = { pre: MarkdownCodeBlock };
