"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionClient } from "./SessionControls";
import { useUiText } from "@/lib/i18n/ui-language";

type Folders = { directory: string; parent: string | null; entries: string[] };
export function ProjectFolderPicker({ client, initialPath, onPick, onCancel }: {
  client: SessionClient; initialPath: string; onPick: (path: string) => void; onCancel: () => void;
}) {
  const t = useUiText();
  const [listing, setListing] = useState<Folders | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRef(0);
  const requestedPath = useRef(initialPath);
  const browse = useCallback(async (path: string) => {
    const id = ++request.current; requestedPath.current = path; setBusy(true); setError("");
    try {
      const result = await client.call("project.folders.list", { path: path || undefined }) as Folders;
      if (id === request.current) setListing(result);
    } catch (cause) { if (id === request.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (id === request.current) setBusy(false); }
  }, [client]);
  useEffect(() => () => { request.current++; }, []);
  useEffect(() => { void browse(initialPath); }, [browse, initialPath]);
  return <div role="group" aria-label={t("Browse host folders")} className="space-y-2 rounded border border-white/20 bg-[#152b35] p-2">
    <p className="text-xs text-white/60">{t("Folders on the Office computer")}</p>
    {listing ? <p aria-label={t("Folder path")} className="break-all text-xs">{listing.directory}</p> : null}
    {error ? <div className="text-xs text-amber-100"><p role="alert" className="break-words">{t(error)}</p><button type="button" disabled={busy} className="min-h-9" onClick={() => void browse(requestedPath.current)}>{t("Retry")}</button></div> : null}
    <div className="max-h-44 overflow-auto" aria-busy={busy}>
      {busy ? <p role="status" className="text-xs">{t("Loading files…")}</p> : <>
        {listing?.parent ? <button type="button" className="block min-h-10 w-full text-left text-xs" onClick={() => void browse(listing.parent!)}>↑ {t("Parent folder")}</button> : null}
        {listing?.entries.map(name => <button type="button" key={name} className="block min-h-10 w-full truncate text-left text-xs" onClick={() => void browse(`${listing.directory.replace(/\/$/, "")}/${name}`)}>▸ {name}</button>)}
      </>}
    </div>
    <div className="flex gap-3 text-xs">
      <button type="button" disabled={busy || !listing} className="min-h-10 rounded bg-emerald-700 px-3 disabled:opacity-40" onClick={() => listing && onPick(listing.directory)}>{t("Use this folder")}</button>
      <button type="button" className="min-h-10" onClick={onCancel}>{t("Cancel")}</button>
    </div>
  </div>;
}
