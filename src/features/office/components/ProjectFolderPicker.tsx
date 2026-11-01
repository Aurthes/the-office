"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionClient } from "./SessionControls";
import { useUiText } from "@/lib/i18n/ui-language";

type Folders = { directory: string; parent: string | null; entries: string[] };
export function ProjectFolderPicker({ client, initialPath, onPick, onCancel }: {
  client: SessionClient; initialPath: string; onPick: (path: string) => void; onCancel: () => void;
}) {
  const t = useUiText();
  const [draft, setDraft] = useState(initialPath), [listing, setListing] = useState<Folders | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRef(0);
  const browse = useCallback(async (path: string) => {
    const id = ++request.current; setBusy(true); setError("");
    try {
      const result = await client.call("project.folders.list", { path: path || undefined }) as Folders;
      if (id === request.current) { setListing(result); setDraft(result.directory); }
    } catch (cause) { if (id === request.current) { setListing(null); setError(cause instanceof Error ? cause.message : String(cause)); } }
    finally { if (id === request.current) setBusy(false); }
  }, [client]);
  useEffect(() => () => { request.current++; }, []);
  useEffect(() => { void browse(initialPath); }, [browse, initialPath]);
  return <div role="group" aria-label={t("Browse host folders")} className="space-y-2 rounded border border-white/20 bg-[#152b35] p-2">
    <p className="text-xs text-white/60">{t("Folders on the Office computer")}</p>
    <div className="flex min-w-0 gap-1">
      <input aria-label={t("Folder path")} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); void browse(draft); } }} className="min-w-0 flex-1 rounded bg-black/20 px-2 py-2 text-xs" />
      <button type="button" disabled={busy} onClick={() => void browse(draft)}>{t("Go")}</button>
    </div>
    {error ? <p role="alert" className="break-words text-xs text-amber-100">{t(error)}</p> : null}
    <div className="max-h-44 overflow-auto" aria-busy={busy}>
      {busy ? <p role="status" className="text-xs">{t("Loading files…")}</p> : <>
        {listing?.parent ? <button type="button" className="block min-h-10 w-full text-left text-xs" onClick={() => void browse(listing.parent!)}>↑ {t("Parent folder")}</button> : null}
        {listing?.entries.map(name => <button type="button" key={name} className="block min-h-10 w-full truncate text-left text-xs" onClick={() => void browse(`${listing.directory.replace(/\/$/, "")}/${name}`)}>▸ {name}</button>)}
      </>}
    </div>
    <div className="flex gap-3 text-xs">
      <button type="button" disabled={busy || !listing} onClick={() => listing && onPick(listing.directory)}>{t("Use this folder")}</button>
      <button type="button" onClick={onCancel}>{t("Cancel")}</button>
    </div>
  </div>;
}
