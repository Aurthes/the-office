"use client";
import { Html } from "@react-three/drei";
import { ListTree } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import { monitorTaskBoardPose } from "./monitor-room-geometry";
import { type ShipCabin, type ShipLayout } from "./layout";
export function TaskWhiteboard({ layout, cabin, onOpen }: { layout: ShipLayout; cabin: ShipCabin; onOpen: () => void }) {
  const t = useUiText(), pose = monitorTaskBoardPose(layout, cabin);
  return <Html transform position={[pose.point.x, 1.7, pose.point.z]} rotation={[0, pose.angle, 0]} distanceFactor={4} zIndexRange={[12, 11]}>
    <button type="button" data-task-whiteboard aria-label={t("Open task board")}
      onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onOpen(); }}
      className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded border-2 border-[#9cb9b3] bg-[#e1e9df] p-2 text-[#25463f] shadow-md hover:bg-white focus-visible:outline-4 focus-visible:outline-amber-200" style={{ width: 164, height: 100 }}>
      <ListTree size={23} strokeWidth={1.4} /><strong className="max-w-full truncate text-[10px]">{t("Task board")}</strong><span className="text-[9px]">{t("All departments")}</span>
    </button>
  </Html>;
}
