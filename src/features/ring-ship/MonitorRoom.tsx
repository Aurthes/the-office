"use client";

import type { PoolHost } from "@/lib/monitoring/types";
import { Html } from "@react-three/drei";
import { useUiText } from "@/lib/i18n/ui-language";
import type { ShipCabin, ShipLayout } from "./layout";
import { monitorScreenPose } from "./monitor-room-geometry";
import { CalendarClock, Server, ListTree } from "lucide-react";
import { cabinAngle, shipPoint } from "./layout";
import { serverConsoleScreenPose, machineRoomPlan, machineRoomPoint } from "./machineRoomLayout";

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

export function MonitorRoomScreen({ layout, cabin, onOpen, onOpenTasks }: { layout: ShipLayout; cabin: ShipCabin; onOpen: () => void; onOpenTasks: () => void }) {
  const t = useUiText(), screen = monitorScreenPose(layout, cabin);
  return <Html transform position={[screen.point.x, 1.9, screen.point.z]} rotation={[0, screen.angle, 0]} distanceFactor={4} zIndexRange={[12, 11]}>
    <div onPointerDown={event => event.stopPropagation()} style={{ width: screen.width * 100, height: 165 }}
      className="flex flex-col gap-2 rounded-lg border-2 border-[#71d3c8]/70 bg-[#102a36] p-3 text-[#d8f5ec] shadow-[0_0_24px_#71d3c830]">
      <span className="block text-[10px] uppercase tracking-[.3em] text-[#71d3c8]">{t("OPERATIONS CONSOLE")}</span>
      <button type="button" aria-label={t("Open task board")} onClick={event => { event.stopPropagation(); onOpenTasks(); }} className="flex flex-1 cursor-pointer items-center justify-center gap-3 rounded border border-[#71d3c8]/40 bg-[#174454] text-xs hover:bg-[#235766] focus-visible:outline-4 focus-visible:outline-amber-200"><ListTree size={26} /><span>{t("Task board")}<small className="mt-1 block text-[9px] text-[#96bcb9]">{t("All departments")}</small></span></button>
      <button type="button" aria-label={t("Open monitoring dashboard")} onClick={event => { event.stopPropagation(); onOpen(); }} className="cursor-pointer rounded border border-[#71d3c8]/25 px-2 py-1 text-[10px] text-[#8ed8bc] hover:bg-white/10">{t("Strategy performance")}</button>
    </div>
  </Html>;
}

export function ServerRoomScreen({ layout, cabin, onOpen, hosts, showLabels = false }: { layout: ShipLayout; cabin: ShipCabin; onOpen: () => void; hosts?: readonly PoolHost[]; showLabels?: boolean }) {
  const t = useUiText(), screen = serverConsoleScreenPose(layout, cabin);
  return <><group position={[screen.point.x, screen.height, screen.point.z]} rotation={[0, screen.angle, 0]}>
    <Html transform rotation={[screen.tilt, 0, 0]} distanceFactor={4} zIndexRange={[12, 11]}>
      <button type="button" aria-label={t("Open server fleet status")} title={t("Server fleet")}
        onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onOpen(); }}
        className="flex cursor-pointer flex-col items-center justify-center rounded-sm border border-blue-200/70 bg-[#102a36] text-[#9db8e9] shadow-[0_0_8px_#9db8e970] hover:bg-[#235168] focus-visible:outline-2 focus-visible:outline-amber-200" style={{ width: screen.width * 100, height: screen.screenHeight * 100 }}>
        <Server size={20} strokeWidth={1.3} /><span className="mt-1 text-[5px] uppercase tracking-wider">{t("Server fleet")}</span>
      </button>
    </Html>
  </group>
    {showLabels ? machineRoomPlan(layout, cabin, hosts).families.map(family => {
      const point = machineRoomPoint(layout, cabin, family.u, family.v);
      return <Html key={family.id} center position={[point.x, 2.95, point.z]} zIndexRange={[12, 11]} style={{ pointerEvents: "none" }}>
        <span data-server-family-label={family.id} className="whitespace-nowrap rounded border bg-[#102a36]/95 px-2 py-1 text-[10px] shadow-md" style={{ color: family.color, borderColor: family.color }}>{(family.id === "local" || family.id === "other" ? t(family.label) : family.label)} · {family.count}</span>
      </Html>;
    }) : null}
  </>;
}
