"use client";

import { Html } from "@react-three/drei";
import { useUiText } from "@/lib/i18n/ui-language";
import type { ShipCabin, ShipLayout } from "./layout";
import { monitorScreenPose } from "./monitor-room-geometry";
import { MonitorIllustration } from "./MonitorIllustration";

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
