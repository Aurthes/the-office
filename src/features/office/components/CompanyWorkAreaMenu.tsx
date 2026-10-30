"use client";
import { useRef, type ReactNode } from "react";

export function CompanyWorkAreaMenu({ areas, activeId, sessionCount, open, onOpenChange, onSelect, actions }: {
  areas: { id: string; name: string; agentIds: readonly string[] }[];
  activeId: string; sessionCount: number; open: boolean;
  onOpenChange: (open: boolean) => void; onSelect: (id: string) => void; actions?: ReactNode;
}) {
  const toggleRef = useRef<HTMLButtonElement>(null);
  const close = () => { onOpenChange(false); toggleRef.current?.focus({ preventScroll: true }); };
  const activeName = areas.find(area => area.id === activeId)?.name || "全公司";
  return <section className="office-company-menu absolute left-3 top-3 z-20 md:top-28" data-open={open} aria-label="公司工区" onKeyDown={event => {
    if (event.key === "Escape") close();
  }}>
    <button type="button" ref={toggleRef} className="office-company-toggle" aria-label={open ? "收起公司工区" : "展开公司工区"} aria-expanded={open} aria-controls="company-workarea-panel" onClick={() => onOpenChange(!open)}>
      <span className="min-w-0 truncate">工区 · {activeName}</span><span aria-hidden="true">{open ? "▴" : "▾"}</span>
    </button>
    <div id="company-workarea-panel" className="office-company-panel rounded-xl border border-emerald-200/20 bg-[#0d1b22]/95 p-3 shadow-lg backdrop-blur-sm">
      <div className="office-company-panel-heading"><span>公司工区</span><button type="button" aria-label="关闭工区面板" onClick={close}>✕</button></div>
      <label className="office-company-label mb-1 hidden text-[10px] tracking-widest text-emerald-200/70 md:block" htmlFor="company-area">公司工区</label>
      <select id="company-area" aria-label="前往工区" value={activeId} onChange={event => { onSelect(event.target.value); close(); }} className="w-full min-w-0 rounded-md border border-white/15 bg-[#152b35] px-2 py-2 text-xs text-white">
        <option value="">全公司 · {sessionCount} 个会话</option>
        {areas.map(area => <option key={area.id} value={area.id}>{area.name} · {area.agentIds.length}</option>)}
      </select>
      <div className="office-company-description mt-2 hidden text-[10px] text-white/50 md:block">自由区：共享办公 · 休息 · 闲逛</div>
      {actions}
    </div>
  </section>;
}
