"use client";
import { Html } from "@react-three/drei";
import { ListTree } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import { departmentBoardPose } from "./department-board";
import { SHARED_PROJECT_ID, type ShipCabin, type ShipLayout } from "./layout";
export function DepartmentWhiteboard({ layout, cabin, onOpen }: { layout: ShipLayout; cabin: ShipCabin; onOpen: () => void }) {
  const t = useUiText(), pose = departmentBoardPose(layout, cabin);
  return <Html transform position={[pose.point.x, 1.7, pose.point.z]} rotation={[0, pose.angle, 0]} distanceFactor={4} zIndexRange={[12, 11]}>
    <button type="button" aria-label={t("Open tasks: {department}", { department: cabin.projectId === SHARED_PROJECT_ID ? t("Open Workspace") : cabin.name })}
      onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onOpen(); }}
      className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded border-2 border-[#9cb9b3] bg-[#e1e9df] p-2 text-[#25463f] shadow-md hover:bg-white focus-visible:outline-4 focus-visible:outline-amber-200" style={{ width: 144, height: 90 }}>
      <ListTree size={23} strokeWidth={1.4} /><strong className="max-w-full truncate text-[10px]">{cabin.projectId === SHARED_PROJECT_ID ? t("Open Workspace") : cabin.name}</strong><span className="text-[9px]">{t("Tasks · People · Time")}</span>
    </button>
  </Html>;
}
