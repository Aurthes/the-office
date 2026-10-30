"use client";
import { useRef, useState } from "react";
import type { SessionClient } from "./SessionControls";
import { useUiText } from "@/lib/i18n/ui-language";

export function CompanyActions({ client, projects, disabled, onCreated }: {
  client: SessionClient; projects: { id: string; name: string; rootPaths?: string[] }[];
  disabled: boolean; onCreated: (threadId?: string) => Promise<void>;
}) {
  const t = useUiText();
  const [mode, setMode] = useState<"project" | "session" | null>(null);
  const [name, setName] = useState(""), [workspace, setWorkspace] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);
  const open = (next: "project" | "session") => {
    setMode(next); setName(""); setWorkspace(""); setError(""); setNotice("");
    setProjectId(projects[0]?.id || "");
  };
  const submit = async () => {
    if (!mode || disabled || submitting.current) return;
    submitting.current = true; setBusy(true); setError(""); setNotice("");
    let created = false;
    try {
      const result = await client.call(mode === "project" ? "project.create" : "session.create", {
        name, ...(mode === "project" ? { workspace } : { projectId }), requestId: crypto.randomUUID(),
      }) as { threadId?: string; warning?: string };
      created = true; setMode(null);
      setNotice(result.warning || (mode === "project" ? "Project created. The Codex desktop sidebar may not have updated yet." : "Session created. Send a message to start working."));
      await onCreated(result.threadId);
    } catch (cause) {
      setError(created ? "Created, but the roster could not refresh. Check existing projects and sessions first." :
        (cause instanceof Error ? cause.message : "Creation failed"));
    } finally { submitting.current = false; setBusy(false); }
  };
  const field = "mt-1 min-h-10 w-full min-w-0 rounded border border-white/20 bg-[#152b35] px-2 text-sm text-white";
  return <div className={`office-company-actions mt-2 max-w-full text-white ${mode ? "w-72" : ""}`}>
    <div className="flex gap-2">
      <button disabled={disabled || busy} onClick={() => open("project")} className="min-h-10 rounded border border-white/20 px-2 text-xs disabled:opacity-40">{t("+ Project")}</button>
      <button disabled={disabled || busy || !projects.length} onClick={() => open("session")} className="min-h-10 rounded border border-white/20 px-2 text-xs disabled:opacity-40">{t("+ Recruit agent")}</button>
    </div>
    {mode ? <form role="dialog" aria-label={mode === "project" ? t("Create project") : t("Recruit agent")} onSubmit={event => { event.preventDefault(); void submit(); }} className="mt-2 space-y-3 rounded border border-white/15 bg-[#0d1b22] p-3">
      <label className="block text-xs">{mode === "project" ? t("Project name") : t("Agent name (session title)")}<input aria-label={t("Name")} autoFocus required maxLength={120} disabled={busy} value={name} onChange={event => setName(event.target.value)} className={field} /></label>
      {mode === "project" ? <label className="block text-xs">{t("Project directory (existing folder on the Codex computer)")}<input aria-label={t("Project directory")} required disabled={busy} value={workspace} onChange={event => setWorkspace(event.target.value)} placeholder="/absolute/path/to/project" className={field} /></label> :
        <label className="block text-xs">{t("Project")}<select aria-label={t("Project")} required disabled={busy} value={projectId} onChange={event => setProjectId(event.target.value)} className={field}>
          {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select></label>}
      <div className="flex gap-2"><button type="submit" disabled={disabled || busy} className="min-h-10 rounded bg-emerald-700 px-3 text-xs disabled:opacity-40">{busy ? t("Creating…") : mode === "project" ? t("Create project") : t("Recruit and create session")}</button><button type="button" disabled={busy} onClick={() => setMode(null)} className="min-h-10 px-2 text-xs">{t("Cancel")}</button></div>
    </form> : null}
    {error ? <p role="alert" className="mt-2 break-words text-xs text-amber-100">{t(error)} {t("After a connection loss or timeout, check the result before retrying.")}</p> : null}
    {notice ? <p role="status" className="mt-2 text-xs text-emerald-100">{t(notice)}</p> : null}
  </div>;
}
