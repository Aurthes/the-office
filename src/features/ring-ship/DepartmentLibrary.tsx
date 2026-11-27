"use client";
import { useContext, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useUiText } from "@/lib/i18n/ui-language";

import { SessionPreviewContext } from "@/features/office/components/SessionPreviewContext";
import { SessionAssetPreview } from "@/features/office/components/SessionMarkdown";
import { LibraryContext, invalidateLibrary } from "@/features/office/components/SaveToLibrary";
import type { SessionAsset } from "@/features/office/components/SessionControls";

type Entry = { id: string; name: string; createdAt: string } & (
  { kind: "link"; url: string } | { kind: "file"; size: number; title?: string; previewKind?: "html" | "markdown" | "text" }
);
async function readJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || "Department library unavailable. Try again.");
  return result;
}

export function DepartmentLibrary({ departmentId }: { departmentId: string }) {
  const url = "/api/office/department-library/" + encodeURIComponent(departmentId);
  return <Library key={url} url={url} departmentId={departmentId} />;
}
export function CompanyLibrary() {
  return <Library url="/api/office/company-library" />;
}

function Library({ url, departmentId }: { url: string; departmentId?: string }) {
  const t = useUiText();
  const sidePreview = useContext(SessionPreviewContext);
  const library = useContext(LibraryContext);
  const [preview,setPreview] = useState<SessionAsset | null>(null);
  const scope=useRef<string | null>(url);
  useLayoutEffect(()=>{scope.current=url;return()=>{scope.current=null;};},[url]);
  const [loadedScope,setLoadedScope]=useState("");
  function open(entry: Entry) {
    if(entry.kind!=="file"||!entry.previewKind)return;
    const asset:SessionAsset={source:"library:"+entry.id,name:entry.title||entry.name,kind:entry.previewKind==="html"?"html":"markdown",plainText:entry.previewKind==="text",archived:true,url:url+"/"+entry.id};
    if(sidePreview)sidePreview(asset);else setPreview(asset);
  }
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [deleting,setDeleting]=useState<string | null>(null);
  const [notice,setNotice]=useState("");
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileInput, setFileInput] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void readJson<{ entries: Entry[] }>(url, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setEntries(result.entries); setLoadedScope(url); setError(""); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [url, refresh]);

  async function save(event: FormEvent, kind: "file" | "link") {
    event.preventDefault();
    if (busy || deleting || !entries || (kind === "file" && !file)) return;
    const target=url;
    setBusy(true);
    setError("");setNotice("");
    try {
      const { entry, alreadySaved } = kind === "file" && file
        ? await readJson<{ entry: Entry; alreadySaved?: boolean }>(url + "?" + new URLSearchParams({ name: file.name }), {
          method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file,
        })
        : await readJson<{ entry: Entry; alreadySaved?: boolean }>(url, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, url: link }),
        });
      if(scope.current!==target)return;
      setNotice(alreadySaved?"Already saved":"Saved");
      setEntries(previous => [entry, ...(previous || []).filter(row => row.id !== entry.id)]);
      if (kind === "file") { setFile(null); setFileInput(value => value + 1); }
      else { setName(""); setLink(""); }
    } catch (cause) { if(scope.current===target)setError(cause instanceof Error ? cause.message : "Department library unavailable. Try again."); }
    finally { if(scope.current===target)setBusy(false); }
  }

  async function remove(entry:Entry) {
    if(busy||deleting||!window.confirm(t("Delete this Library entry? Only its archived copy will be removed.")))return;
    const target=url;
    setDeleting(entry.id);setError("");setNotice("");
    try {
      const result=await readJson<{deleted:boolean;cleanupPending?:boolean}>(url+"/"+entry.id,{method:"DELETE"});
      if(!result.deleted)throw new Error("Could not delete entry. Try again.");
      if(scope.current!==target)return;
      setEntries(previous=>(previous||[]).filter(row=>row.id!==entry.id));
      if (departmentId) {
        if (library?.departmentId === departmentId) library.saved.clear();
        invalidateLibrary(departmentId);
      }
      if(preview?.source==="library:"+entry.id)setPreview(null);
      setNotice(result.cleanupPending?"Entry removed; stored copy cleanup is pending.":"Deleted");
    }catch(cause){if(scope.current===target)setError(cause instanceof Error?cause.message:"Could not delete entry. Try again.");}
    finally{if(scope.current===target)setDeleting(null);}
  }

  return <section className="department-library" aria-label={t("Library")}>
    {notice ? <p role="status">{t(notice)}</p> : null}
    {error ? <p role="alert">{t(error)}{!entries && <> <button type="button" onClick={() => setRefresh(value => value + 1)}>{t("Retry")}</button></>}</p> : null}
    {!entries && !error ? <p role="status">{t("Loading library…")}</p> : null}
    {entries && loadedScope===url && <>
      <div className="department-library-forms">
        <form onSubmit={event => void save(event, "file")}>
          <label>{t("File copy (up to 20 MB)")}<input key={fileInput} type="file" required disabled={busy||Boolean(deleting)} onChange={event => setFile(event.target.files?.[0] || null)} /></label>
          <button disabled={busy || Boolean(deleting) || !file} type="submit">{t("Upload file")}</button>
        </form>
        <form onSubmit={event => void save(event, "link")}>
          <label>{t("Link address")}<input type="url" required maxLength={2048} value={link} disabled={busy||Boolean(deleting)} onChange={event => setLink(event.target.value)} /></label>
          <label>{t("Link name (optional)")}<input maxLength={120} value={name} disabled={busy||Boolean(deleting)} onChange={event => setName(event.target.value)} /></label>
          <button disabled={busy||Boolean(deleting)} type="submit">{t("Save link")}</button>
        </form>
      </div>
      {busy ? <p role="status">{t("Saving…")}</p> : null}
      {entries.length === 0 ? <p>{t("This library is empty.")}</p> : <ul>
        {entries.map(entry => <li key={entry.id}>
          {entry.kind==="file"&&entry.previewKind ? <button type="button" className="min-h-11 min-w-0 text-left break-words text-cyan-100 underline" onClick={()=>open(entry)}>{entry.title||entry.name}</button> : <strong>{entry.name}</strong>}
          {entry.kind==="file"&&<small className="w-full break-words">{entry.name} · {entry.createdAt} · {entry.id.slice(0,8)}</small>}
          {entry.kind === "link" ? <a href={entry.url} target="_blank" rel="noopener noreferrer">{t("Open external link")}</a> :
            <a href={url + "/" + entry.id} download>{t("Download")}</a>}
          <button type="button" className="min-h-11 rounded border border-white/20 px-3 text-sm" disabled={busy||Boolean(deleting)} onClick={()=>void remove(entry)}>{t(deleting===entry.id?"Deleting…":"Delete")}</button>
        </li>)}
      </ul>}
    </>}
    {preview&&<SessionAssetPreview key={preview.url} asset={preview} onClose={()=>setPreview(null)} />}
  </section>;
}
