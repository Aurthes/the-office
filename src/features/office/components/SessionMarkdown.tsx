"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SessionAsset } from "./SessionControls";
import { visibleUserText } from "@/lib/text/codex-visible-text";
export { visibleUserText };

function AssetImage({ src, name, onOpen, fullSize = false, thumbnail = false }: { src: string; name: string; onOpen: () => void; fullSize?: boolean; thumbnail?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  return <span className={thumbnail ? "inline-flex" : "my-3 block"}>
    {failed ? <button type="button" onClick={() => { setFailed(false); setRetry(value => value + 1); }} className="rounded-lg border border-white/15 p-3 text-xs text-amber-100">图片加载失败，点击重试 · {name}</button> : <button type="button" onClick={onOpen} className={thumbnail ? "session-image-thumbnail block cursor-zoom-in" : fullSize ? "block cursor-zoom-out" : "block max-w-full cursor-zoom-in"} title={fullSize ? "还原图片" : "放大图片"}>
      {/* Authenticated dynamic files cannot use the shared Next image cache. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src + (retry ? `${src.includes("?") ? "&" : "?"}retry=${retry}` : "")} alt={name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={fullSize ? "max-w-none" : "max-h-[65dvh] max-w-full rounded-lg object-contain"} />
    </button>}
  </span>;
}

function AssetPreview({ asset, onClose }: { asset: SessionAsset; onClose: () => void }) {
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
      if (!response.ok) throw new Error(result.error || "无法读取文件");
      setMarkdown(result);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无法读取文件"); });
    return () => controller.abort();
  }, [asset]);
  return createPortal(<dialog ref={dialog} aria-label={`预览 ${asset.name}`} onCancel={event => { event.preventDefault(); onClose(); }} className="fixed inset-0 m-0 flex h-dvh max-h-none w-full max-w-none flex-col overflow-hidden border-0 bg-[#111923] p-0 text-white backdrop:bg-black/70 md:inset-4 md:h-[calc(100dvh-2rem)] md:w-[calc(100vw-2rem)] md:rounded-xl md:border md:border-white/15">
    <header className="flex shrink-0 items-center gap-3 border-b border-white/15 px-4 py-2">
      <button type="button" onClick={onClose} className="min-h-11 shrink-0 rounded-lg px-3 text-sm text-cyan-100 hover:bg-white/10">← 返回对话</button>
      <span className="min-w-0 flex-1 truncate text-sm">{asset.name}</span>
      {asset.kind === "html" ? <a href={asset.url} target="_blank" rel="noopener noreferrer" onClick={onClose} className="shrink-0 rounded-lg px-2 py-3 text-xs text-cyan-100">单独打开 ↗</a> : null}
      <a href={asset.url} download={asset.name} className="shrink-0 rounded-lg px-3 py-3 text-xs text-white/60">下载</a>
    </header>
    {asset.kind === "html" ? <div className="relative min-h-0 flex-1">
      <iframe key={htmlRetry} src={asset.url} title={asset.name} sandbox="allow-scripts" referrerPolicy="no-referrer" onLoad={() => setHtmlLoading(false)} className="h-full w-full border-0 bg-[#111923]" />
      {htmlLoading ? <div className="absolute inset-0 flex items-center justify-center bg-[#111923] px-6 text-center">
        <div className="max-w-sm space-y-3">
          {htmlLoading ? <span aria-hidden="true" className="mx-auto block h-6 w-6 animate-spin rounded-full border-2 border-cyan-100/20 border-t-cyan-100" /> : null}
          <p role="status" className="text-sm text-cyan-50">{htmlSlow ? "预览仍在加载，可以继续等待" : "正在加载 HTML 预览…"}</p>
          <p className="text-xs leading-5 text-white/55">较大的 3D 样板首次打开可能需要几秒。</p>
          {htmlSlow ? <div className="flex justify-center gap-3"><button onClick={retryHtml} className="min-h-10 rounded-lg border border-white/20 px-4 text-xs">重新加载</button><a href={asset.url} target="_blank" rel="noopener noreferrer" onClick={onClose} className="min-h-10 rounded-lg bg-cyan-950 px-4 py-3 text-xs text-cyan-100">单独打开 ↗</a></div> : null}
        </div>
      </div> : null}
    </div> : <div className="min-h-0 flex-1 overflow-auto p-4 md:p-8">
      {asset.kind === "image" ? <div className={fullSize ? "min-w-max" : "flex min-h-full items-center justify-center"}><AssetImage src={asset.url} name={asset.name} fullSize={fullSize} onOpen={() => setFullSize(value => !value)} /></div>
        : error ? <p role="alert" className="text-amber-100">{error}</p> : markdown ? <div className="mx-auto max-w-4xl"><SessionMarkdown content={markdown.content} assets={markdown.assets} /></div> : <p role="status">读取文件…</p>}
    </div>}
  </dialog>, document.body);
}

const NO_ASSETS: SessionAsset[] = [];
export const SessionMarkdown = memo(function SessionMarkdown({ content, assets = NO_ASSETS, user = false }: { content: string; assets?: SessionAsset[]; user?: boolean }) {
  const [preview, setPreview] = useState<SessionAsset | null>(null);
  const find = useCallback((source: string) => assets.find(asset => asset.source === source || asset.url === source), [assets]);
  const transform = useCallback((url: string) => find(url)?.url || defaultUrlTransform(url), [find]);
  const components = useMemo<Components>(() => ({
        a: ({ href, children }) => {
          const asset = href ? find(href) : undefined;
          if (asset?.kind === "file") return <a href={asset.url} download={asset.name}>{children} ↓</a>;
          return asset ? <a href={asset.url} onClick={event => { event.preventDefault(); setPreview(asset); }} title={`预览 ${asset.name}`}>{children} <span className="text-[10px] opacity-60">↗ 预览</span></a>
            : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
        },
        img: ({ src, alt }) => {
          const source = typeof src === "string" ? src : "", asset = find(source);
          return asset ? <AssetImage key={asset.url} src={asset.url} name={alt || asset.name} onOpen={() => setPreview(asset)} />
            : source && /^https?:\/\//.test(source) ? <AssetImage src={source} name={alt || "图片"} onOpen={() => setPreview({ source, url: source, name: alt || "图片", kind: "image" })} /> : <span className="text-xs text-white/50">{alt || "图片"}（预览暂不可用，请刷新会话）</span>;
        },
  }), [find]);
  const text = user ? visibleUserText(content) : content;
  const attachments = assets.filter(asset => asset.inline || asset.attached).map(asset => asset.kind === "image" ? <AssetImage key={asset.url} src={asset.url} name={asset.name} thumbnail={user} onOpen={() => setPreview(asset)} /> : asset.kind === "file" ? <a key={asset.url} href={asset.url} download={asset.name} className="my-2 inline-block rounded-lg border border-white/15 px-3 py-2 text-sm text-cyan-100">{asset.name} ↓ 下载</a> : <button key={asset.url} type="button" onClick={() => setPreview(asset)} className="my-2 rounded-lg border border-white/15 px-3 py-2 text-sm text-cyan-100">{asset.name} ↗ 预览</button>);
  return <>
    {user && attachments.length ? <div className="session-user-attachments flex flex-wrap justify-end gap-2">{attachments}</div> : null}
    {(!user || text.trim()) ? <div className={user ? "session-user-text" : undefined}>
    <div className="agent-markdown min-w-0 break-words text-base leading-relaxed [&_a]:text-sky-200 [&_a]:underline [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto">
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={transform} components={components}>{text}</ReactMarkdown>
    </div>
    </div> : null}
    {!user ? attachments : null}
    {preview ? <AssetPreview key={preview.url} asset={preview} onClose={() => setPreview(null)} /> : null}
  </>;
});
