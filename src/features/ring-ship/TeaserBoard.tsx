"use client";
import { Html } from "@react-three/drei";
import { Lightbulb } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import { BREAK_ROOM, breakRoomPoint } from "./breakRoomLayout";
import { cabinAngle, type ShipCabin, type ShipLayout } from "./layout";

export function TeaserBoard({ layout, cabin, onOpen }: { layout: ShipLayout; cabin: ShipCabin; onOpen: () => void }) {
  const t = useUiText(), board = BREAK_ROOM.teaserBoard;
  const p = breakRoomPoint(layout, cabin, board.x, board.z - .09);
  return <Html transform position={[p.x, board.y, p.z]} rotation={[0, cabinAngle(layout, cabin.slot) + Math.PI, 0]} distanceFactor={4} zIndexRange={[12, 11]}>
    <button type="button" data-teaser-board aria-label={t("Open teaser board")}
      onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onOpen(); }}
      className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded border-2 border-[#d0ae75] bg-[#183832] p-2 text-[#f3dfaf] shadow-md hover:bg-[#245045] focus-visible:outline-4 focus-visible:outline-amber-200" style={{ width: 168, height: 100 }}>
      <Lightbulb size={25} strokeWidth={1.4} /><strong className="text-[11px]">{t("Teaser board")}</strong><span className="text-[9px] text-[#bfceaf]">{t("Take a brain break")}</span>
    </button>
  </Html>;
}
