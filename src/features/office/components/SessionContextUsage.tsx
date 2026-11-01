"use client";
import { useId } from "react";
import { useUiText } from "@/lib/i18n/ui-language";

export function SessionContextUsage({ usage, above = false }: {
  usage: { last: { inputTokens: number }; modelContextWindow?: number | null };
  above?: boolean;
}) {
  const t = useUiText();
  const descriptionId = useId();
  const limit = usage.modelContextWindow;
  const percent = limit && limit > 0 ? Math.min(100, Math.max(0, usage.last.inputTokens / limit * 100)) : null;
  const tokens = `${usage.last.inputTokens.toLocaleString()} ${t("input tokens")}${limit && limit > 0 ? ` / ${limit.toLocaleString()}` : ""}`;
  const description = percent === null ? tokens : `${t("{percent}% used", { percent: Math.round(percent) })} · ${tokens}`;

  return <details className="group relative ml-auto shrink-0">
    <summary aria-label={t("Context usage")} aria-describedby={descriptionId} title={description} className="grid h-10 w-10 cursor-pointer list-none place-items-center rounded-lg text-white/60 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 [&::-webkit-details-marker]:hidden">
      <svg width="20" height="20" viewBox="0 0 20 20" role={percent === null ? "img" : "progressbar"} aria-label={t("Context usage")} aria-valuemin={percent === null ? undefined : 0} aria-valuemax={percent === null ? undefined : 100} aria-valuenow={percent === null ? undefined : Math.round(percent)} aria-valuetext={percent === null ? undefined : description}>
        <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
        {percent !== null ? <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2.5" pathLength="100" strokeDasharray={`${percent} 100`} transform="rotate(-90 10 10)" /> : null}
      </svg>
    </summary>
    <div id={descriptionId} role="tooltip" className={`absolute right-0 ${above ? "bottom-full" : "top-full"} z-10 hidden w-max max-w-[min(18rem,75vw)] rounded-lg border border-white/15 bg-[#172330] px-3 py-2 text-[11px] text-white/80 shadow-lg group-open:block`}>
      <p className="font-medium">{t("Context usage")}{percent === null ? "" : ` · ${t("{percent}% used", { percent: Math.round(percent) })}`}</p>
      <p className="mt-1 text-white/55">{tokens}</p>
    </div>
  </details>;
}
