"use client";
import { useEffect, useState, type RefObject } from "react";
import { Radar, X } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import { emptySpaceEncounter, sampleSpaceEncounter, type SpaceMotion } from "./space-activity";

type Notice = { id: string; phase: "approaching" | "passing"; seconds: number; count: number };

export function SpaceTrafficNotice({ motion, seed, paused }: { motion: RefObject<SpaceMotion>; seed: number; paused: boolean }) {
  const t = useUiText();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dismissed, setDismissed] = useState("");
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)"), sample = emptySpaceEncounter();
    const update = () => {
      sampleSpaceEncounter(motion.current.elapsed, seed, sample);
      const phase = sample.trafficStartsIn > 0 && sample.trafficStartsIn <= 6 ? "approaching" : sample.trafficCount ? "passing" : null;
      const next: Notice | null = !paused && !media.matches && !document.hidden && phase ? {
        id: `${seed}:${sample.trafficId}`, phase, count: sample.trafficSize,
        seconds: Math.ceil(phase === "approaching" ? sample.trafficStartsIn : sample.trafficEndsIn),
      } : null;
      setNotice(previous => previous?.id === next?.id && previous?.phase === next?.phase && previous?.seconds === next?.seconds ? previous : next);
    };
    update();
    const timer = window.setInterval(update, 250);
    media.addEventListener("change", update); document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(timer); media.removeEventListener("change", update); document.removeEventListener("visibilitychange", update); };
  }, [motion, seed, paused]);
  if (!notice || notice.id === dismissed) return null;
  return <aside className="space-traffic-notice" aria-label={t("Space traffic alert")} data-phase={notice.phase}>
    <div className="space-traffic-heading"><Radar size={15} /><span role="status">{t(notice.phase === "approaching" ? "Incoming space traffic" : "Fleet passing by")}</span><button type="button" aria-label={t("Dismiss traffic alert")} onClick={() => setDismissed(notice.id)}><X size={14} /></button></div>
    <div className="space-traffic-countdown"><p>{t(notice.phase === "approaching" ? "Arriving in" : "Route clears in")}<strong>{String(Math.floor(notice.seconds / 60)).padStart(2, "0")}:{String(notice.seconds % 60).padStart(2, "0")}</strong></p><span>{t("{count} vessels · Transit corridor", { count: notice.count })}</span></div>
  </aside>;
}
