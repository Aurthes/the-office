"use client";
import { useEffect, useState } from "react";
import { useUiText } from "@/lib/i18n/ui-language";

// Only this small status ticks; streaming messages and the composer stay still.
export function SessionRunTimer({ startedAt }: { startedAt: number }) {
  const t = useUiText();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const time = hours ? `${hours}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return <span role="timer" aria-label={t("Elapsed time")} aria-live="off" className="tabular-nums">{t("Running · {time}", { time })}</span>;
}
