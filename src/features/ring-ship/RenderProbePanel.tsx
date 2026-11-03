"use client";
import { useEffect, useRef, useState } from "react";
import { _roots } from "@react-three/fiber";
import { createRenderProbe, type ProbeMode, type ProbePhase, type ProbeReport } from "./renderProbe";

const PHASE: Record<ProbePhase, string> = { normal: "记录当前画面", "animations-paused": "临时暂停动作作对照", "half-resolution": "临时降低分辨率作对照", "shadows-off": "只关闭阴影作对照", "normal-repeat": "恢复原样复测" };
export default function RenderProbe({ onShadowsChange }: { onShadowsChange: (enabled: boolean) => void }) {
  const [mode] = useState<ProbeMode>(() => new URLSearchParams(window.location.search).get("renderProbe") === "shadows" ? "shadows" : "overview");
  const [ready, setReady] = useState(false), [running, setRunning] = useState(false), [progress, setProgress] = useState(""), [error, setError] = useState("");
  const [report, setReport] = useState<ProbeReport | null>(null), [receipt, setReceipt] = useState("");
  const active = useRef<ReturnType<typeof createRenderProbe> | null>(null), alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const timer = setInterval(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-ship-ready]");
      if (canvas && _roots.has(canvas)) {
        let loaded = false;
        _roots.get(canvas)!.store.getState().scene.traverse(object => { if (object.userData.shipObjects?.some((p: { kind: string }) => p.kind === "chairDesk")) loaded = true; });
        if (loaded) { setReady(true); clearInterval(timer); }
      }
    }, 300);
    return () => { alive.current = false; clearInterval(timer); active.current?.dispose(); };
  }, []);
  async function save(value: ProbeReport) {
    const data = new FormData();
    data.append("file", new File([JSON.stringify(value, null, 2)], `office-render-profile-${value.id}.json`, { type: "application/json" }));
    const response = await fetch("/api/files/upload", { method: "POST", body: data });
    const saved = await response.json();
    if (!response.ok || typeof saved.id !== "string") throw new Error("报告上传失败；可下载报告后作为附件发送。");
    if (alive.current) setReceipt(saved.id);
  }
  async function start() {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-ship-ready]"), root = canvas && _roots.get(canvas);
    if (!root) { setError("飞船还未准备好，请稍等。"); return; }
    setRunning(true); setError(""); setReceipt(""); setReport(null);
    let probe: ReturnType<typeof createRenderProbe> | null = null;
    try {
      probe = createRenderProbe(root.store.getState, () => root.fiber.current, onShadowsChange); active.current = probe;
      const value = await probe.capture((phase, seconds) => { if (alive.current) setProgress(`${PHASE[phase]} · ${seconds} 秒`); }, 5000, mode);
      if (!alive.current) return;
      setReport(value); setProgress("正在保存报告…"); await save(value);
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "采样失败。"); }
    finally { probe?.dispose(); active.current = null; if (alive.current) { setRunning(false); setProgress(""); } }
  }
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" })), a = document.createElement("a");
    a.href = url; a.download = `office-render-profile-${report.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function close() {
    active.current?.dispose();
    const url = new URL(location.href); url.searchParams.delete("renderProbe"); location.replace(url.href);
  }
  return <aside data-render-probe data-render-probe-mode={mode} className="absolute left-2 right-2 top-16 z-[150] mx-auto max-w-sm rounded-xl border border-cyan-300/40 bg-slate-950/95 p-3 text-xs text-slate-100 shadow-xl">
    <div className="mb-2 flex items-center justify-between"><strong>{mode === "shadows" ? "阴影对照采样" : "真机渲染采样"}</strong><button onClick={close} className="rounded border border-white/20 px-2 py-1">退出诊断</button></div>
    <p className="mb-2 leading-5">{mode === "shadows" ? "先进入帧率低的视角，再开始。约 20 秒，保持视角与屏幕方向不变。依次测原样、只关阴影、恢复原样；分辨率和动作保持不变。只保存性能数据和 GPU 信息。" : "先进入帧率低的视角，再开始。约 25 秒，采样时保持视角与屏幕方向不变。会短暂暂停动作、降低分辨率，然后恢复。只保存性能数据和 GPU 信息。"}</p>
    <button disabled={!ready || running} onClick={() => void start()} className="rounded bg-cyan-700 px-3 py-2 disabled:opacity-40">{running ? progress : ready ? "开始采样并保存报告" : "等待飞船加载…"}</button>
    {error ? <p role="alert" className="mt-2 text-amber-300">{error}</p> : null}
    {receipt ? <p className="mt-2 select-all leading-5" data-render-probe-receipt={receipt}>报告已保存，回复这个编号即可：<strong>{receipt}</strong></p> : null}
    {report ? <div className="mt-2"><span>{report.mode === "shadows" ? report.phases.map(p => `${p.phase === "shadows-off" ? "关阴影" : p.phase === "normal-repeat" ? "恢复" : "原样"} ${p.fps.toFixed(1)} FPS`).join(" · ") : `原样 ${report.phases[0].fps.toFixed(1)} FPS`}</span><button onClick={download} className="ml-3 underline">下载报告</button>{!report.cameraStable ? <p className="mt-1 text-amber-300">视角发生过变化，建议保持视角再测一次。</p> : null}</div> : null}
  </aside>;
}
