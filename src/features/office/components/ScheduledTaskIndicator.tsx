"use client";
import { Clock3 } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";

// Scheduling is independent of an agent's current activity or attention state.
export function ScheduledTaskIndicator({ active, className = "" }: { active?: boolean; className?: string }) {
  const t = useUiText();
  return active ? <span role="img" aria-label={t("Pending scheduled task")} title={t("Pending scheduled task")}
    className={"inline-flex shrink-0 items-center justify-center rounded-full bg-[#102531] p-0.5 text-cyan-200 " + className}>
    <Clock3 size={12} aria-hidden="true" />
  </span> : null;
}
