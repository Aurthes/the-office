"use client";
import { useContext, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useUiText } from "@/lib/i18n/ui-language";

import { SessionPreviewContext } from "@/features/office/components/SessionPreviewContext";
import { SessionAssetPreview } from "@/features/office/components/SessionMarkdown";
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
  return <Library key={departmentId} departmentId={departmentId} />;
}
function Library({ departmentId }: { departmentId: string }) {
  const t = useUiText();
  const sidePreview = useContext(SessionPreviewContext);
  const [preview,setPreview] = useState<SessionAsset | null>(null);
  const scope=useRef<string | null>(departmentId);
  useLayoutEffect(()=>{scope.current=departmentId;return()=>{scope.current=null;};},[departmentId]);
  const [loadedScope,setLoadedScope]=useState("");
  function open(entry: Entry) {
    if(entry.kind!=="file"||!entry.previewKind)return;
    const asset:SessionAsset={source:"library:"+entry.id,name:entry.title||entry.name,kind:entry.previewKind==="html"?"html":"markdown",plainText:entry.previewKind==="text",archived:true,url:url+"/"+entry.id};
    if(sidePreview)sidePreview(asset);else setPreview(asset);
  }
  const url = "/api/office/department-library/" + encodeURIComponent(departmentId);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileInput, setFileInput] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void readJson<{ entries: Entry[] }>(url, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setEntries(result.entries); setLoadedScope(departmentId); setError(""); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [url, refresh, departmentId]);

  async function save(event: FormEvent, kind: "file" | "link") {
    event.preventDefault();
    if (busy || !entries || (kind === "file" && !file)) return;
    const target=departmentId;
    setBusy(true);
    setError("");
    try {
      const { entry } = kind === "file" && file
        ? await readJson<{ entry: Entry }>(url + "?" + new URLSearchParams({ name: file.name }), {
          method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file,
        })
        : await readJson<{ entry: Entry }>(url, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, url: link }),
        });
      if(scope.current!==target)return;
      setEntries(previous => [entry, ...(previous || []).filter(row => row.id !== entry.id)]);
      if (kind === "file") { setFile(null); setFileInput(value => value + 1); }
      else { setName(""); setLink(""); }
    } catch (cause) { if(scope.current===target)setError(cause instanceof Error ? cause.message : "Department library unavailable. Try again."); }
    finally { if(scope.current===target)setBusy(false); }
  }

  return <section className="department-library" aria-label={t("Library")}>
    {error ? <p role="alert">{t(error)}{!entries && <> <button type="button" onClick={() => setRefresh(value => value + 1)}>{t("Retry")}</button></>}</p> : null}
    {!entries && !error ? <p role="status">{t("Loading library…")}</p> : null}
    {entries && loadedScope===departmentId && <>
      <div className="department-library-forms">
        <form onSubmit={event => void save(event, "file")}>
          <label>{t("File copy (up to 20 MB)")}<input key={fileInput} type="file" required disabled={busy} onChange={event => setFile(event.target.files?.[0] || null)} /></label>
          <button disabled={busy || !file} type="submit">{t("Upload file")}</button>
        </form>
        <form onSubmit={event => void save(event, "link")}>
          <label>{t("Link address")}<input type="url" required maxLength={2048} value={link} disabled={busy} onChange={event => setLink(event.target.value)} /></label>
          <label>{t("Link name (optional)")}<input maxLength={120} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
          <button disabled={busy} type="submit">{t("Save link")}</button>
        </form>
      </div>
      {busy ? <p role="status">{t("Saving…")}</p> : null}
      {entries.length === 0 ? <p>{t("This library is empty.")}</p> : <ul>
        {entries.map(entry => <li key={entry.id}>
          {entry.kind==="file"&&entry.previewKind ? <button type="button" className="min-h-11 min-w-0 text-left break-words text-cyan-100 underline" onClick={()=>open(entry)}>{entry.title||entry.name}</button> : <strong>{entry.name}</strong>}
          {entry.kind==="file"&&<small className="w-full break-words">{entry.name} · {entry.createdAt} · {entry.id.slice(0,8)}</small>}
          {entry.kind === "link" ? <a href={entry.url} target="_blank" rel="noopener noreferrer">{t("Open external link")}</a> :
            <a href={url + "/" + entry.id} download>{t("Download")}</a>}
        </li>)}
      </ul>}
    </>}
    {preview&&<SessionAssetPreview key={preview.url} asset={preview} onClose={()=>setPreview(null)} />}
  </section>;
}
