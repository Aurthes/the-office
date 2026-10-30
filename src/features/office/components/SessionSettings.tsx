"use client";
import { useEffect, useState } from "react";
import type { SessionClient } from "./SessionControls";

export type ChatSettings = { model: string; effort: string | null; accessMode: string };
type Choices = { models: { id: string; name: string; efforts: string[]; defaultEffort: string }[];
  accessModes: { id: string; name: string; description?: string | null; allowed: boolean }[] };

export function SessionSettings({ client, threadId, current, disabled, active, onBusyChange }: {
  client: SessionClient; threadId: string; current: ChatSettings; disabled: boolean; active: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [choices, setChoices] = useState<Choices | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmFullAccess, setConfirmFullAccess] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stopped = false;
    void client.call("session.settings.choices", { threadId }).then(result => {
      if (!stopped) { setChoices(result as Choices); setError(""); }
    }).catch(cause => { if (!stopped) setError(cause instanceof Error ? cause.message : "读取选项失败"); });
    return () => { stopped = true; };
  }, [client, threadId, attempt]);
  const update = async (settings: Partial<ChatSettings> & { confirmFullAccess?: boolean }) => {
    if (busy || disabled) return;
    setBusy(true); onBusyChange(true); setError(""); setNotice(""); setConfirmFullAccess(false);
    try {
      await client.call("session.settings.update", { threadId, settings });
      setNotice(active ? "已保存，下一轮生效；追加消息沿用当前任务。" : "已保存，下次发送时生效。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败，请核对当前设置后再试"); }
    finally { setBusy(false); onBusyChange(false); }
  };
  const model = choices?.models.find(model => model.id === current.model);
  const access = choices?.accessModes.find(mode => mode.id === current.accessMode);
  const blocked = disabled || busy || !choices;
  const selectClass = "min-h-10 w-full min-w-0 rounded-lg border border-white/15 bg-[#172330] px-2 text-sm text-white disabled:opacity-45";
  return <div className="mb-2">
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <button aria-label="模型设置" aria-expanded={modelOpen} onClick={() => setModelOpen(!modelOpen)} className="flex min-h-10 min-w-0 max-w-full items-center gap-2 rounded-lg px-2 text-xs text-white/70 hover:bg-white/5"><span className="truncate">{model?.name || current.model}</span><span className="shrink-0 text-white/40">{current.effort || "默认"} ▾</span></button>
      <select aria-label="Select access mode" title="选择原会话的权限模式" value={current.accessMode} disabled={blocked} onChange={event => {
        if (event.target.value === ":danger-full-access" && current.accessMode !== event.target.value) setConfirmFullAccess(true);
        else void update({ accessMode: event.target.value });
      }} className="min-h-10 min-w-0 max-w-full rounded-lg bg-transparent px-2 text-xs text-white/65 disabled:opacity-45">
        {!access ? <option value={current.accessMode}>{current.accessMode === "custom" ? "Custom permissions" : current.accessMode}</option> : null}
        {choices?.accessModes.map(mode => <option key={mode.id} value={mode.id} disabled={!mode.allowed} title={mode.description || undefined}>{mode.name}</option>)}
      </select>
      {busy ? <span role="status" className="text-xs text-white/45">保存中…</span> : null}
    </div>
    {modelOpen ? <div className="mb-2 grid grid-cols-2 gap-3 rounded-xl border border-white/15 bg-[#172330] p-3">
      <label className="min-w-0 text-xs text-white/60">模型<select aria-label="选择模型" disabled={blocked} value={current.model} onChange={event => void update({ model: event.target.value })} className={selectClass}>
        {!model ? <option value={current.model}>{current.model}</option> : null}
        {choices?.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select></label>
      <label className="min-w-0 text-xs text-white/60">推理强度<select aria-label="推理强度" disabled={blocked || !model} value={current.effort || ""} onChange={event => void update({ effort: event.target.value })} className={selectClass}>
        {!current.effort || !model?.efforts.includes(current.effort) ? <option value={current.effort || ""} disabled>{current.effort || "默认"}</option> : null}
        {model?.efforts.map(effort => <option key={effort} value={effort}>{effort}</option>)}
      </select></label>
    </div> : null}
    {confirmFullAccess ? <section role="dialog" aria-label="确认 Full access" className="mb-2 rounded-xl border border-amber-300/30 bg-amber-900/15 p-3 text-xs text-amber-100">
      <p>Full access 允许 Codex 访问工作区外的文件、运行命令和联网，无需逐次审批。更改用于这条会话的后续任务。</p>
      <div className="mt-2 flex gap-2"><button disabled={disabled || busy} onClick={() => void update({ accessMode: ":danger-full-access", confirmFullAccess: true })} className="min-h-10 rounded-lg border border-amber-300/40 px-3">开启 Full access</button><button onClick={() => setConfirmFullAccess(false)} className="min-h-10 px-3 text-white/70">取消</button></div>
    </section> : null}
    {error ? <p role="alert" className="mb-2 break-words text-xs text-amber-100">{error}{!choices ? <> <button onClick={() => setAttempt(attempt + 1)} className="underline">重试选项</button></> : null}</p> : null}
    {notice ? <p role="status" className="mb-2 text-[11px] text-white/45">{notice}</p> : null}
  </div>;
}
