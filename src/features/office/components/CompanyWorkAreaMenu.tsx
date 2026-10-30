"use client";
import { useRef, type ReactNode } from "react";
import { useUiText } from "@/lib/i18n/ui-language";

export function CompanyWorkAreaMenu({ areas, activeId, sessionCount, open, onOpenChange, onSelect, actions, description = "Shared area: work · rest · wander" }: {
  areas: { id: string; name: string; agentIds: readonly string[]; countLabel?: string }[];
  activeId: string; sessionCount: number; open: boolean;
  onOpenChange: (open: boolean) => void; onSelect: (id: string) => void; actions?: ReactNode;
  description?: string;
}) {
  const t = useUiText();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const close = () => { onOpenChange(false); toggleRef.current?.focus({ preventScroll: true }); };
  const activeName = areas.find(area => area.id === activeId)?.name || t("Whole company");
  return <section className="office-company-menu absolute left-3 top-3 z-20 md:top-28" data-open={open} aria-label={t("Company work areas")} onKeyDown={event => {
    if (event.key === "Escape") close();
  }}>
    <button type="button" ref={toggleRef} className="office-company-toggle" aria-label={open ? t("Collapse work areas") : t("Expand work areas")} aria-expanded={open} aria-controls="company-workarea-panel" onClick={() => onOpenChange(!open)}>
      <span className="min-w-0 truncate">{t("Work areas ·")} {activeName}</span><span aria-hidden="true">{open ? "▴" : "▾"}</span>
    </button>
    <div id="company-workarea-panel" className="office-company-panel rounded-xl border border-emerald-200/20 bg-[#0d1b22]/95 p-3 shadow-lg backdrop-blur-sm">
      <div className="office-company-panel-heading"><span>{t("Company work areas")}</span><button type="button" aria-label={t("Close work area panel")} onClick={close}>✕</button></div>
      <label className="office-company-label mb-1 hidden text-[10px] tracking-widest text-emerald-200/70 md:block" htmlFor="company-area">{t("Company work areas")}</label>
      <select id="company-area" aria-label={t("Go to work area")} value={activeId} onChange={event => { onSelect(event.target.value); close(); }} className="w-full min-w-0 rounded-md border border-white/15 bg-[#152b35] px-2 py-2 text-xs text-white">
        <option value="">{t("Whole company · {count} sessions", { count: sessionCount })}</option>
        {areas.map(area => <option key={area.id} value={area.id}>{area.name}{area.countLabel ?? ` · ${area.agentIds.length}`}</option>)}
      </select>
      <div className="office-company-description mt-2 hidden text-[10px] text-white/50 md:block">{t(description)}</div>
      {actions}
    </div>
  </section>;
}
