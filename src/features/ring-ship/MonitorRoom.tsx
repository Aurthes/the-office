"use client";

import { Html } from "@react-three/drei";
import { ExternalLink } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import type { ShipCabin, ShipLayout } from "./layout";
import { monitorScreenPose } from "./monitor-room-geometry";

export function MonitorRoomScreen({ layout, cabin, onOpen }: { layout: ShipLayout; cabin: ShipCabin; onOpen: () => void }) {
  const t = useUiText(), screen = monitorScreenPose(layout, cabin);
  return <Html transform position={[screen.point.x, 1.9, screen.point.z]} rotation={[0, screen.angle, 0]} distanceFactor={4} zIndexRange={[12, 11]}>
    <button type="button" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onOpen(); }}
      aria-label={t("Open Grafana strategy dashboard")} style={{ width: screen.width * 100, height: 165 }}
      className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-[#71d3c8]/70 bg-[#102a36] text-[#d8f5ec] shadow-[0_0_24px_#71d3c830] transition-colors hover:bg-[#174454] focus-visible:outline-4 focus-visible:outline-amber-200">
      <span className="text-[13px] uppercase tracking-[.3em] text-[#71d3c8]">{t("STRATEGY PERFORMANCE")}</span>
      <span className="text-3xl font-semibold tracking-[.15em]">GRAFANA</span>
      <span className="flex items-center gap-2 text-sm">{t("Open dashboard")} <ExternalLink size={16} /></span>
    </button>
  </Html>;
}
