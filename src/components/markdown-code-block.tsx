"use client";

import { Children, isValidElement, useEffect, useRef, useState, useSyncExternalStore, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { Check, CircleAlert, Copy } from "lucide-react";
import type { Components } from "react-markdown";
import { renderMermaidSvg } from "@/lib/text/render-mermaid";
import { safeMermaidSource } from "@/lib/text/mermaid-markdown";
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

let diagramId = 0;
const noSubscription = () => () => {};
const rootDark = () => document.documentElement.classList.contains("dark");
const serverDark = () => false;
function observeTheme(changed: () => void) {
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function MarkdownCodeBlock({ children, className }: ComponentPropsWithoutRef<"pre">) {
  const t = useUiText();
  const code = Children.toArray(children).find(child => isValidElement(child) && child.type === "code");
  const props = isValidElement<{ className?: string; children?: ReactNode; "data-mermaid-closed"?: string }>(code) ? code.props : null;
  const source = typeof props?.children === "string" ? props.children.replace(/\n$/, "") : "";
  const diagram = Boolean(props?.className?.split(/\s+/).some(name => name.toLowerCase() === "language-mermaid"));
  const eligible = diagram && props?.["data-mermaid-closed"] === "true" && safeMermaidSource(source);
  const dark = useSyncExternalStore(eligible ? observeTheme : noSubscription, rootDark, serverDark);
  const key = eligible ? `${dark}:${source}` : "";
  const [image, setImage] = useState<{ key: string; url?: string; failed?: boolean } | null>(null);
  useEffect(() => {
    if (!key) return;
    let cancelled = false, url: string | undefined;
    void renderMermaidSvg(`chat-diagram-${++diagramId}`, source, dark).then(svg => {
      if (cancelled) return;
      url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      setImage({ key, url });
    }).catch(() => { if (!cancelled) setImage({ key, failed: true }); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [key, source, dark]);
  const ready = image?.key === key && Boolean(image.url);
  const pre = useRef<HTMLPreElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const label = t(status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : "Copy code");

  const copy = async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      // Markdown adds a display newline; copying it can submit terminal input.
      await copyText((pre.current?.textContent ?? "").replace(/\n$/, ""));
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
    {ready ? <div className="markdown-diagram">
      {/* Locally generated SVG stays an inert image, never arbitrary chat DOM. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image!.url} alt={t("Diagram")} onError={() => setImage({ key, failed: true })} />
    </div> : null}
    <pre hidden={ready} className={className} ref={pre}>{children}</pre>
    {!ready && diagram && image?.key === key && image.failed ? <span className="markdown-diagram-error" role="status">{t("Could not render diagram. Source shown.")}</span> : null}
  </div>;
}

export const markdownCodeComponents: Components = { pre: MarkdownCodeBlock };
