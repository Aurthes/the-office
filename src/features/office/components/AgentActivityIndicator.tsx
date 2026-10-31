"use client";
import type { AgentActivity } from "@/features/retro-office/core/agentActivity";
import { useUiText } from "@/lib/i18n/ui-language";

export function AgentActivityIndicator({ activity }: { activity: AgentActivity }) {
  const t = useUiText();
  return <span role="img" aria-label={t(activity.label)} title={t(activity.label)}
    className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-sm font-bold leading-none" style={{ color: activity.color }}>
    {activity.marker ? <span aria-hidden="true" className={activity.kind === "working" ? "motion-safe:animate-spin" : undefined} style={{ animationDuration: "3s" }}>{activity.marker}</span>
      : <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: activity.color }} />}
  </span>;
}
