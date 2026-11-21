"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useUiText } from "@/lib/i18n/ui-language";

type Entry = { id: string; name: string; createdAt: string } & (
  { kind: "link"; url: string } | { kind: "file"; size: number }
);
async function readJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || "Department library unavailable. Try again.");
  return result;
}

export function DepartmentLibrary({ departmentId }: { departmentId: string }) {
  const t = useUiText();
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
      .then(result => { if (!controller.signal.aborted) { setEntries(result.entries); setError(""); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [url, refresh]);

  async function save(event: FormEvent, kind: "file" | "link") {
    event.preventDefault();
    if (busy || !entries || (kind === "file" && !file)) return;
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
      setEntries(previous => [entry, ...(previous || []).filter(row => row.id !== entry.id)]);
      if (kind === "file") { setFile(null); setFileInput(value => value + 1); }
      else { setName(""); setLink(""); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Department library unavailable. Try again."); }
    finally { setBusy(false); }
  }

  return <section className="department-library" aria-label={t("Library")}>
    {error ? <p role="alert">{t(error)}{!entries && <> <button type="button" onClick={() => setRefresh(value => value + 1)}>{t("Retry")}</button></>}</p> : null}
    {!entries && !error ? <p role="status">{t("Loading library…")}</p> : null}
    {entries && <>
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
          <strong>{entry.name}</strong>
          {entry.kind === "link" ? <a href={entry.url} target="_blank" rel="noopener noreferrer">{t("Open external link")}</a> :
            <a href={url + "/" + entry.id} download>{t("Download")}</a>}
        </li>)}
      </ul>}
    </>}
  </section>;
}
