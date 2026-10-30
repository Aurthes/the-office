"use client";
import { useRef, useState } from "react";
import type { SessionClient } from "./SessionControls";

export function CompanyActions({ client, projects, disabled, onCreated }: {
  client: SessionClient; projects: { id: string; name: string; rootPaths?: string[] }[];
  disabled: boolean; onCreated: (threadId?: string) => Promise<void>;
}) {
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
      setNotice(result.warning || (mode === "project" ? "Project 已创建。Codex 桌面侧栏可能尚未更新。" : "新会话已创建，发消息后开始工作。"));
      await onCreated(result.threadId);
    } catch (cause) {
      setError(created ? "已创建，名单刷新失败；请先核对已有项目和会话。" :
        `${cause instanceof Error ? cause.message : "创建失败"}；如遇连接中断或超时，请先核对创建结果再重试。`);
    } finally { submitting.current = false; setBusy(false); }
  };
  const field = "mt-1 min-h-10 w-full min-w-0 rounded border border-white/20 bg-[#152b35] px-2 text-sm text-white";
  return <div className={`office-company-actions mt-2 max-w-full text-white ${mode ? "w-72" : ""}`}>
    <div className="flex gap-2">
      <button disabled={disabled || busy} onClick={() => open("project")} className="min-h-10 rounded border border-white/20 px-2 text-xs disabled:opacity-40">+ Project</button>
      <button disabled={disabled || busy || !projects.length} onClick={() => open("session")} className="min-h-10 rounded border border-white/20 px-2 text-xs disabled:opacity-40">+ 招募 agent</button>
    </div>
    {mode ? <form role="dialog" aria-label={mode === "project" ? "创建 Project" : "招募 agent"} onSubmit={event => { event.preventDefault(); void submit(); }} className="mt-2 space-y-3 rounded border border-white/15 bg-[#0d1b22] p-3">
      <label className="block text-xs">{mode === "project" ? "Project 名称" : "Agent 名称（会话标题）"}<input aria-label="名称" autoFocus required maxLength={120} disabled={busy} value={name} onChange={event => setName(event.target.value)} className={field} /></label>
      {mode === "project" ? <label className="block text-xs">项目目录（Codex 电脑上已有的文件夹）<input aria-label="项目目录" required disabled={busy} value={workspace} onChange={event => setWorkspace(event.target.value)} placeholder="/absolute/path/to/project" className={field} /></label> :
        <label className="block text-xs">所属 Project<select aria-label="所属 Project" required disabled={busy} value={projectId} onChange={event => setProjectId(event.target.value)} className={field}>
          {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select></label>}
      <div className="flex gap-2"><button type="submit" disabled={disabled || busy} className="min-h-10 rounded bg-emerald-700 px-3 text-xs disabled:opacity-40">{busy ? "创建中…" : mode === "project" ? "创建 Project" : "招募并新建会话"}</button><button type="button" disabled={busy} onClick={() => setMode(null)} className="min-h-10 px-2 text-xs">取消</button></div>
    </form> : null}
    {error ? <p role="alert" className="mt-2 break-words text-xs text-amber-100">{error}</p> : null}
    {notice ? <p role="status" className="mt-2 text-xs text-emerald-100">{notice}</p> : null}
  </div>;
}
