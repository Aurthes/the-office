"use client";

import { Html } from "@react-three/drei";
import { useUiText } from "@/lib/i18n/ui-language";
import type { ShipCabin, ShipLayout } from "./layout";
import { monitorScreenPose } from "./monitor-room-geometry";
import { MonitorIllustration } from "./MonitorIllustration";
import { CalendarClock } from "lucide-react";
import { cabinAngle, shipPoint } from "./layout";

export function TaskRoomScreen({ layout, cabin, onOpen }: { layout: ShipLayout; cabin: ShipCabin; onOpen: () => void }) {
  const t = useUiText(), ring = layout.rings[cabin.ring];
  // Reuse the small display on the right-hand command desk.
  const angle = cabinAngle(layout, cabin.slot) + 2.65 / ring.radius, point = shipPoint(ring.radius + .26, angle);
  return <Html transform position={[point.x, 1.65, point.z]} rotation={[0, angle, 0]} distanceFactor={4} zIndexRange={[12, 11]}>
    <button type="button" aria-label={t("Open scheduled tasks")} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onOpen(); }}
      className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded border-2 border-[#e3bf86]/80 bg-[#172c36] text-[#f0d5a7] shadow-[0_0_20px_#d3ac6e40] hover:bg-[#293c44] focus-visible:outline-4 focus-visible:outline-amber-200" style={{ width: 85, height: 65 }}>
      <CalendarClock size={23} strokeWidth={1.4} /><span className="text-[9px]">{t("Scheduled tasks")}</span>
    </button>
  </Html>;
}

export function MonitorRoomScreen({ layout, cabin, onOpen }: { layout: ShipLayout; cabin: ShipCabin; onOpen: () => void }) {
  const t = useUiText(), screen = monitorScreenPose(layout, cabin);
  return <Html transform position={[screen.point.x, 1.9, screen.point.z]} rotation={[0, screen.angle, 0]} distanceFactor={4} zIndexRange={[12, 11]}>
    <button type="button" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onOpen(); }}
      aria-label={t("Open monitoring dashboard")} style={{ width: screen.width * 100, height: 165 }}
      className="cursor-pointer rounded-lg border-2 border-[#71d3c8]/70 bg-[#102a36] p-3 text-[#d8f5ec] shadow-[0_0_24px_#71d3c830] transition-colors hover:bg-[#174454] focus-visible:outline-4 focus-visible:outline-amber-200">
      <span className="block text-[10px] uppercase tracking-[.3em] text-[#71d3c8]">{t("OPERATIONS CONSOLE")}</span>
      <span className="mt-2 grid grid-cols-2 gap-3">
        <span className="rounded border border-[#71d3c8]/25 bg-black/10 px-2 text-[#8ed8bc]"><MonitorIllustration visual="chart" compact /><span className="block text-[10px]">{t("Strategy performance")}</span></span>
        <span className="rounded border border-blue-200/20 bg-black/10 px-2 text-[#9db8e9]"><MonitorIllustration visual="servers" compact /><span className="block text-[10px]">{t("Server fleet")}</span></span>
      </span>
    </button>
  </Html>;
}
