"use client";
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { createPortal } from "react-dom";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SessionAsset } from "./SessionControls";
import { visibleUserText } from "@/lib/text/codex-visible-text";
import { useUiText } from "@/lib/i18n/ui-language";
export { visibleUserText };

function AssetImage({ src, name, onOpen, fullSize = false, thumbnail = false }: { src: string; name: string; onOpen: () => void; fullSize?: boolean; thumbnail?: boolean }) {
  const t = useUiText();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  return <span className={thumbnail ? "inline-flex" : "my-3 block"}>
    {failed ? <button type="button" onClick={() => { setFailed(false); setRetry(value => value + 1); }} className="rounded-lg border border-white/15 p-3 text-xs text-amber-100">{t("Image failed to load. Click to retry · {name}", { name })}</button> : <button type="button" onClick={onOpen} className={thumbnail ? "session-image-thumbnail block cursor-zoom-in" : fullSize ? "block cursor-zoom-out" : "block max-w-full cursor-zoom-in"} title={fullSize ? t("Restore image") : t("Enlarge image")}>
      {/* Authenticated dynamic files cannot use the shared Next image cache. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src + (retry ? `${src.includes("?") ? "&" : "?"}retry=${retry}` : "")} alt={name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={fullSize ? "max-w-none" : "max-h-[65dvh] max-w-full rounded-lg object-contain"} />
    </button>}
  </span>;
}

function AssetPreview({ asset, onClose }: { asset: SessionAsset; onClose: () => void }) {
  const t = useUiText();
  const dialog = useRef<HTMLDialogElement>(null);
  const [markdown, setMarkdown] = useState<{ content: string; assets: SessionAsset[] } | null>(null);
  const [error, setError] = useState("");
  const [fullSize, setFullSize] = useState(false);
  const [htmlLoading, setHtmlLoading] = useState(true);
  const [htmlSlow, setHtmlSlow] = useState(false);
  const [htmlRetry, setHtmlRetry] = useState(0);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  useEffect(() => {
    if (asset.kind !== "html" || !htmlLoading) return;
    const timer = setTimeout(() => setHtmlSlow(true), 8000);
    return () => clearTimeout(timer);
  }, [asset.kind, htmlLoading, htmlRetry]);
  const retryHtml = () => { setHtmlLoading(true); setHtmlSlow(false); setHtmlRetry(value => value + 1); };
  useEffect(() => {
    if (asset.kind !== "markdown") return;
    const controller = new AbortController();
    fetch(asset.url + "&format=json", { signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not read file");
      setMarkdown(result);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not read file"); });
    return () => controller.abort();
  }, [asset]);
  return createPortal(<dialog ref={dialog} aria-label={t("Preview {0}", { "0": asset.name })} onCancel={event => { event.preventDefault(); onClose(); }} className="fixed inset-0 m-0 flex h-dvh max-h-none w-full max-w-none flex-col overflow-hidden border-0 bg-[#111923] p-0 text-white backdrop:bg-black/70 md:inset-4 md:h-[calc(100dvh-2rem)] md:w-[calc(100vw-2rem)] md:rounded-xl md:border md:border-white/15">
    <header className="flex shrink-0 items-center gap-3 border-b border-white/15 px-4 py-2">
      <button type="button" onClick={onClose} className="min-h-11 shrink-0 rounded-lg px-3 text-sm text-cyan-100 hover:bg-white/10">{t("← Back to chat")}</button>
      <span className="min-w-0 flex-1 truncate text-sm">{asset.name}</span>
      {asset.kind === "html" ? <a href={asset.url} target="_blank" rel="noopener noreferrer" onClick={onClose} className="shrink-0 rounded-lg px-2 py-3 text-xs text-cyan-100">{t("Open separately ↗")}</a> : null}
      <a href={asset.url} download={asset.name} className="shrink-0 rounded-lg px-3 py-3 text-xs text-white/60">{t("Download")}</a>
    </header>
    {asset.kind === "html" ? <div className="relative min-h-0 flex-1">
      <iframe key={htmlRetry} src={asset.url} title={asset.name} sandbox="allow-scripts" referrerPolicy="no-referrer" onLoad={() => setHtmlLoading(false)} className="h-full w-full border-0 bg-[#111923]" />
      {htmlLoading ? <div className="absolute inset-0 flex items-center justify-center bg-[#111923] px-6 text-center">
        <div className="max-w-sm space-y-3">
          {htmlLoading ? <span aria-hidden="true" className="mx-auto block h-6 w-6 animate-spin rounded-full border-2 border-cyan-100/20 border-t-cyan-100" /> : null}
          <p role="status" className="text-sm text-cyan-50">{htmlSlow ? t("Preview is still loading. You can keep waiting.") : t("Loading HTML preview…")}</p>
          <p className="text-xs leading-5 text-white/55">{t("Large 3D previews may take a few seconds to open for the first time.")}</p>
          {htmlSlow ? <div className="flex justify-center gap-3"><button onClick={retryHtml} className="min-h-10 rounded-lg border border-white/20 px-4 text-xs">{t("Reload")}</button><a href={asset.url} target="_blank" rel="noopener noreferrer" onClick={onClose} className="min-h-10 rounded-lg bg-cyan-950 px-4 py-3 text-xs text-cyan-100">{t("Open separately ↗")}</a></div> : null}
        </div>
      </div> : null}
    </div> : <div className="min-h-0 flex-1 overflow-auto p-4 md:p-8">
      {asset.kind === "image" ? <div className={fullSize ? "min-w-max" : "flex min-h-full items-center justify-center"}><AssetImage src={asset.url} name={asset.name} fullSize={fullSize} onOpen={() => setFullSize(value => !value)} /></div>
        : error ? <p role="alert" className="text-amber-100">{t(error)}</p> : markdown ? <div className="mx-auto max-w-4xl"><SessionMarkdown content={markdown.content} assets={markdown.assets} /></div> : <p role="status">{t("Reading file…")}</p>}
    </div>}
  </dialog>, document.body);
}

const NO_ASSETS: SessionAsset[] = [];
export const SessionMarkdown = memo(function SessionMarkdown({ content, assets = NO_ASSETS, user = false }: { content: string; assets?: SessionAsset[]; user?: boolean }) {
  const t = useUiText();
  const [preview, setPreview] = useState<SessionAsset | null>(null);
  const [expanded, setExpanded] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const textId = useId();
  const find = useCallback((source: string) => assets.find(asset => asset.source === source || asset.url === source), [assets]);
  const transform = useCallback((url: string) => find(url)?.url || defaultUrlTransform(url), [find]);
  const components = useMemo<Components>(() => ({
        a: ({ href, children }) => {
          const asset = href ? find(href) : undefined;
          if (asset?.kind === "file") return <a href={asset.url} download={asset.name}>{children} ↓</a>;
          return asset ? <a href={asset.url} onClick={event => { event.preventDefault(); setPreview(asset); }} title={t("Preview {0}", { "0": asset.name })}>{children} <span className="text-[10px] opacity-60">{t("↗ Preview")}</span></a>
            : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
        },
        img: ({ src, alt }) => {
          const source = typeof src === "string" ? src : "", asset = find(source);
          return asset ? <AssetImage key={asset.url} src={asset.url} name={alt || asset.name} onOpen={() => setPreview(asset)} />
            : source && /^https?:\/\//.test(source) ? <AssetImage src={source} name={alt || t("Image")} onOpen={() => setPreview({ source, url: source, name: alt || "Image", kind: "image" })} /> : <span className="text-xs text-white/50">{alt || t("Image")}{t(" (preview unavailable; reload the session)")}</span>;
        },
  }), [find, t]);
  const text = user ? visibleUserText(content) : content;
  const collapsible = user && (text.length > 400 || text.split("\n", 9).length > 8);
  const excerpt = collapsible && !expanded ? text.trimStart().slice(0, 180).split(/\r?\n/, 4).join("\n").trimEnd() + "…" : text;
  const toggleExpanded = () => {
    setExpanded(value => !value);
    if (expanded) requestAnimationFrame(() => textRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" }));
  };
  const attachments = assets.filter(asset => asset.inline || asset.attached).map(asset => asset.kind === "image" ? <AssetImage key={asset.url} src={asset.url} name={asset.name} thumbnail={user} onOpen={() => setPreview(asset)} /> : asset.kind === "file" ? <a key={asset.url} href={asset.url} download={asset.name} className="my-2 inline-block rounded-lg border border-white/15 px-3 py-2 text-sm text-cyan-100">{asset.name}{t("↓ Download")}</a> : <button key={asset.url} type="button" onClick={() => setPreview(asset)} className="my-2 rounded-lg border border-white/15 px-3 py-2 text-sm text-cyan-100">{asset.name}{t("↗ Preview")}</button>);
  return <>
    {user && attachments.length ? <div className="session-user-attachments flex flex-wrap justify-end gap-2">{attachments}</div> : null}
    {(!user || text.trim()) ? <div ref={textRef} className={user ? `session-user-text${collapsible ? " session-user-text--collapsible" : ""}` : undefined}>
    <div id={textId} className="agent-markdown min-w-0 break-words text-base leading-relaxed [&_a]:text-sky-200 [&_a]:underline [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto">
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={transform} components={components}>{excerpt}</ReactMarkdown>
    </div>
    {collapsible ? <button type="button" className="session-message-toggle" aria-expanded={expanded} aria-controls={textId}
      aria-label={t(expanded ? "Collapse message" : "Expand message")} onClick={toggleExpanded}>
      {expanded ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
      {t(expanded ? "Show less" : "Show more")}
    </button> : null}
    </div> : null}
    {!user ? attachments : null}
    {preview ? <AssetPreview key={preview.url} asset={preview} onClose={() => setPreview(null)} /> : null}
  </>;
});
