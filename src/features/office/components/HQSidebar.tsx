"use client";

import type { ReactNode } from "react";
import { useUiText } from "@/lib/i18n/ui-language";

export type HQSidebarTab =
  | "inbox"
  | "history"
  | "analytics";

type HQSidebarProps = {
  open: boolean;
  activeTab: HQSidebarTab;
  inboxCount: number;
  onToggle: () => void;
  onTabChange: (tab: HQSidebarTab) => void;

  onAddAgent?: () => void;
  onOpenCompanyBuilder?: () => void;
  inboxPanel: ReactNode;
  historyPanel: ReactNode;

  analyticsPanel: ReactNode;
};

const TAB_LABELS: Record<HQSidebarTab, string> = {
  inbox: "Inbox",
  history: "History",
  analytics: "Analytics",
};

const PRIMARY_TABS: HQSidebarTab[] = ["inbox", "history"];

export function HQSidebar({
  open,
  activeTab,
  inboxCount,
  onToggle,
  onTabChange,

  onAddAgent,
  onOpenCompanyBuilder,
  inboxPanel,
  historyPanel,

  analyticsPanel,
}: HQSidebarProps) {
  const t = useUiText();
  const analyticsOnly = activeTab === "analytics";
  const railOnly = analyticsOnly;
  const activePanel =
    activeTab === "inbox"
      ? inboxPanel
      : activeTab === "history"
        ? historyPanel
        : analyticsPanel;

  return (
    <aside className="pointer-events-none fixed inset-y-0 right-0 z-20 flex justify-end">
      <div className="pointer-events-auto mt-14 flex shrink-0 flex-col items-end gap-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="rounded-l-md border border-r-0 border-cyan-500/30 bg-[#06090d]/90 px-1.5 py-2.5 font-mono text-[10px] font-semibold tracking-[0.2em] text-cyan-300 shadow-xl backdrop-blur transition-colors hover:border-cyan-400/50 hover:text-cyan-100"
          aria-expanded={open}
          aria-label={open ? t("Collapse headquarters sidebar") : t("Open headquarters sidebar")}
        >
          <span className="block leading-none [writing-mode:vertical-rl]">
            {open ? t("COLLAPSE HQ") : t("OPEN HQ")}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            onTabChange("analytics");
            if (!open) {
              onToggle();
            }
          }}
          className={`rounded-l-md border border-r-0 px-1.5 py-2.5 font-mono text-[10px] font-semibold tracking-[0.2em] shadow-xl backdrop-blur transition-colors ${
            analyticsOnly
              ? "border-amber-400/50 bg-[#1a1206]/95 text-amber-200"
              : "border-amber-500/25 bg-[#120d06]/90 text-amber-300/80 hover:border-amber-400/45 hover:text-amber-100"
          }`}
          aria-pressed={analyticsOnly}
          aria-label={t("Open analytics sidebar")}
        >
          <span className="block leading-none [writing-mode:vertical-rl]">{t("ANALYTICS")}</span>
        </button>
      </div>

      {open ? (
        <div
          className={`pointer-events-auto flex h-full flex-col border-l border-cyan-500/20 bg-black/85 shadow-2xl backdrop-blur ${
            "w-56"
          }`}
        >
          <div className="border-b border-cyan-500/15 px-4 py-3">
            <div className="font-mono text-[10px] font-semibold tracking-[0.32em] text-cyan-300/80">
              {analyticsOnly ? t("ANALYTICS") : t("HEADQUARTERS")}
            </div>
            <div className="mt-1 font-mono text-[11px] text-white/45">
              {analyticsOnly
                ? t("Cost, budgets, and performance intelligence.")
                : t("Monitor outputs and runs.")}
            </div>
            {!railOnly && onAddAgent ? (
              <button
                type="button"
                onClick={onAddAgent}
                className="mt-3 rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-200 transition-colors hover:border-cyan-400/40 hover:text-cyan-100"
              >{t("Add Agent")}</button>
            ) : null}
            {!railOnly && onOpenCompanyBuilder ? (
              <button
                type="button"
                onClick={onOpenCompanyBuilder}
                className="mt-2 rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-200 transition-colors hover:border-emerald-400/40 hover:text-emerald-100"
              >{t("Build Company")}</button>
            ) : null}
            {railOnly ? (
              <button
                type="button"
                onClick={() => onTabChange("inbox")}
                className="mt-3 rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-200 transition-colors hover:border-cyan-400/40 hover:text-cyan-100"
              >{t("Back To HQ")}</button>
            ) : null}
          </div>

          {!railOnly ? (
            <div
              role="tablist"
              aria-label={t("Headquarters panels")}
              className="grid grid-cols-4 border-b border-cyan-500/15"
            >
              {PRIMARY_TABS.map((tab) => {
                const isActive = tab === activeTab;
                const showBadge = tab === "inbox" && inboxCount > 0;
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`hq-panel-${tab}`}
                    id={`hq-tab-${tab}`}
                    onClick={() => onTabChange(tab)}
                    className={`flex items-center justify-center gap-1 border-r border-cyan-500/10 px-2 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors last:border-r-0 ${
                      isActive
                        ? "bg-cyan-500/10 text-cyan-100"
                        : "text-white/45 hover:bg-white/5 hover:text-white/80"
                    }`}
                  >
                    <span>{t(TAB_LABELS[tab])}</span>
                    {showBadge ? (
                      <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] text-cyan-300" aria-label={t("{0} unread", { "0": inboxCount })}>
                        {inboxCount}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div
            role="tabpanel"
            id={`hq-panel-${activeTab}`}
            aria-labelledby={`hq-tab-${activeTab}`}
            className="min-h-0 flex-1 overflow-hidden"
          >
            {activePanel}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
