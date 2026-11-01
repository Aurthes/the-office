"use client";
import { useRef, useState } from "react";
import type { SessionClient } from "./SessionControls";
import { useUiText } from "@/lib/i18n/ui-language";
import { OfficeCodexAccount } from "./OfficeCodexAccount";
import { ProjectFolderPicker } from "./ProjectFolderPicker";

type Project = { id: string; name: string; rootPaths?: string[] };
type Chat = { id: string; name: string; workspace: string };
export function CompanyActions({ client, projects, disabled, onCreated }: {
  client: SessionClient; projects: Project[];
  disabled: boolean; onCreated: (threadId?: string) => Promise<void>;
}) {
  const t = useUiText();
  const [mode, setMode] = useState<"project" | "edit" | "session" | null>(null);
  const [name, setName] = useState(""), [folders, setFolders] = useState<string[]>([""]);
  const [projectId, setProjectId] = useState(""), [chats, setChats] = useState<Chat[]>([]);
  const [workspaces, setWorkspaces] = useState<Record<string, string>>({});
  const [picker, setPicker] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);
  const loadProject = async (id: string) => {
    setBusy(true); setError(""); setName(""); setFolders([""]); setChats([]); setProjectId(id); setWorkspaces({});
    try {
      const result = await client.call("project.inspect", { projectId: id }) as { project: Project; sessions: Chat[] };
      setName(result.project.name); setFolders(result.project.rootPaths || []); setChats(result.sessions);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const open = (next: "project" | "edit" | "session") => {
    setMode(next); setName(""); setFolders([""]); setPicker(null); setError(""); setNotice(""); setChats([]); setWorkspaces({});
    setProjectId(projects[0]?.id || "");
    if (next === "edit" && projects[0]) void loadProject(projects[0].id);
  };
  const affected = mode === "edit" ? chats.filter(chat => !folders.includes(chat.workspace)) : [];
  const submit = async () => {
    if (!mode || disabled || busy || submitting.current || picker !== null) return;
    submitting.current = true; setBusy(true); setError(""); setNotice("");
    let saved = false;
    try {
      const result = await client.call(mode === "project" ? "project.create" : mode === "edit" ? "project.update" : "session.create", {
        name, ...(mode === "session" ? { projectId: projectId || null, ...(!projectId ? { workspace: folders[0] } : {}) } : { rootPaths: folders, ...(mode === "edit" ? { projectId, workspaces } : {}) }), requestId: crypto.randomUUID(),
      }) as { threadId?: string; warning?: string };
      saved = true; setMode(null);
      setNotice(result.warning || (mode === "project" ? "Office project created." : mode === "edit" ? "Project updated. Folder changes apply to new turns and new terminals." : "Session created. Send a message to start working."));
      await onCreated(result.threadId);
    } catch (cause) {
      setError(saved ? "Saved, but the roster could not refresh. Check existing projects and sessions first." :
        (cause instanceof Error ? cause.message : "Creation failed"));
    } finally { submitting.current = false; setBusy(false); }
  };
  const field = "mt-1 min-h-10 w-full min-w-0 rounded border border-white/20 bg-[#152b35] px-2 text-sm text-white";
  const label = mode === "edit" ? "Edit project" : mode === "project" ? "Create project" : "Recruit agent";
  const locked = busy || picker !== null;
  return <div className={`office-company-actions mt-2 max-w-full text-white ${mode ? "w-80" : ""}`}>
    <OfficeCodexAccount client={client} />
    <div className="flex flex-wrap gap-2">
      <button disabled={disabled || busy} onClick={() => open("project")} className="min-h-10 rounded border border-white/20 px-2 text-xs disabled:opacity-40">{t("+ Project")}</button>
      <button disabled={disabled || busy || !projects.length} onClick={() => open("edit")} className="min-h-10 rounded border border-white/20 px-2 text-xs disabled:opacity-40">{t("Edit project")}</button>
      <button disabled={disabled || busy} onClick={() => open("session")} className="min-h-10 rounded border border-white/20 px-2 text-xs disabled:opacity-40">{t("+ Recruit agent")}</button>
    </div>
    {mode ? <form role="dialog" aria-label={t(label)} onSubmit={event => { event.preventDefault(); void submit(); }} className="mt-2 max-h-[65vh] space-y-3 overflow-y-auto rounded border border-white/15 bg-[#0d1b22] p-3">
      {mode !== "project" ? <label className="block text-xs">{t("Project")}<select aria-label={t("Project")} required={mode === "edit"} disabled={locked} value={projectId} onChange={event => { setPicker(null); if (mode === "edit") void loadProject(event.target.value); else setProjectId(event.target.value); }} className={field}>
        {mode === "session" ? <option value="">{t("Open Space (no project)")}</option> : null}
        {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select></label> : null}
      <label className="block text-xs">{mode !== "session" ? t("Project name") : t("Agent name (session title)")}<input aria-label={t("Name")} autoFocus required maxLength={120} disabled={locked} value={name} onChange={event => setName(event.target.value)} className={field} /></label>
      {mode === "session" && !projectId ? <>
        <label className="block text-xs">{t("Working folder")}<input aria-label={t("Working folder")} required disabled={locked} value={folders[0]} onChange={event => setFolders([event.target.value])} className={field} /></label>
        <p className="text-xs text-white/60">{t("Choose a working folder for this agent. No project is created.")}</p>
        <button type="button" disabled={locked} onClick={() => setPicker(0)} className="min-h-9 text-xs">{t("Browse")}</button>
        {picker === 0 ? <ProjectFolderPicker client={client} initialPath={folders[0]} onPick={folder => { setFolders([folder]); setPicker(null); }} onCancel={() => setPicker(null)} /> : null}
      </> : null}
      {mode !== "session" ? <>
        <p className="text-xs text-white/60">{t("Attach existing folders. No folders are created or moved.")}</p>
        {folders.map((folder, index) => <div key={index} className="min-w-0 space-y-1 rounded border border-white/10 p-2">
          <label className="block text-xs">{t("Project folder")} {index + 1}<input aria-label={`${t("Project folder")} ${index + 1}`} required disabled={locked} value={folder} onChange={e => setFolders(value => value.map((p, i) => i === index ? e.target.value : p))} placeholder="/absolute/path/to/repo" className={field} /></label>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button type="button" disabled={locked} onClick={() => setPicker(index)} className="min-h-9">{t("Browse")}</button>
            <button type="button" disabled={locked || index === 0} onClick={() => setFolders(value => [value[index], ...value.filter((_, i) => i !== index)])} className="min-h-9">{t(index === 0 ? "Primary folder" : "Make primary")}</button>
            <button type="button" disabled={locked || folders.length === 1} onClick={() => setFolders(value => value.filter((_, i) => i !== index))} className="min-h-9">{t("Remove folder")}</button>
          </div>
        </div>)}
        {picker !== null ? <ProjectFolderPicker client={client} initialPath={folders[picker]} onPick={folder => { setFolders(value => value.map((p, i) => i === picker ? folder : p)); setPicker(null); }} onCancel={() => setPicker(null)} /> : null}
        <button type="button" disabled={locked} className="min-h-10 text-xs" onClick={() => setFolders(value => [...value, ""])}>{t("+ Add folder")}</button>
        <p className="text-xs text-white/50">{t("The primary folder is the default for new chats. Existing chats keep their working folder.")}</p>
        {affected.length ? <div className="space-y-2 rounded border border-amber-200/30 p-2">
          <p className="text-xs text-amber-100">{t("Choose a new working folder for chats using a removed folder. Stop affected tasks and terminals first.")}</p>
          {affected.map(chat => <label className="block break-words text-xs" key={chat.id}>{chat.name}<select aria-label={`${t("Working folder")}: ${chat.name}`} className={field} required disabled={locked} value={workspaces[chat.id] || ""} onChange={e => setWorkspaces(value => ({ ...value, [chat.id]: e.target.value }))}>
            <option value="">{t("Choose a working folder")}</option>
            {[...new Set(folders.filter(Boolean))].map(folder => <option key={folder} value={folder}>{folder}</option>)}
          </select></label>)}
        </div> : null}
      </> : null}
      <div className="flex gap-2"><button type="submit" disabled={disabled || locked} className="min-h-10 rounded bg-emerald-700 px-3 text-xs disabled:opacity-40">{busy ? t("Saving…") : t(mode === "project" ? "Create project" : mode === "edit" ? "Save project" : "Recruit and create session")}</button><button type="button" disabled={busy} onClick={() => { setMode(null); setPicker(null); }} className="min-h-10 px-2 text-xs">{t("Cancel")}</button></div>
    </form> : null}
    {error ? <p role="alert" className="mt-2 break-words text-xs text-amber-100">{t(error)} {t("After a connection loss or timeout, check the result before retrying.")}</p> : null}
    {notice ? <p role="status" className="mt-2 text-xs text-emerald-100">{t(notice)}</p> : null}
  </div>;
}
