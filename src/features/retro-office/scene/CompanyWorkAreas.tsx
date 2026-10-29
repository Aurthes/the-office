"use client";
import { useEffect, useMemo, type MutableRefObject } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SCALE } from "../core/constants";
import { toWorld } from "../core/geometry";
import type { CompanyLayout, WorkArea } from "../core/companyLayout";

function AreaSign({ area }: { area: WorkArea }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024; canvas.height = 180;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#132b2b"; ctx.fillRect(0, 0, 1024, 180);
    ctx.strokeStyle = area.color; ctx.lineWidth = 8; ctx.strokeRect(4, 4, 1016, 172);
    ctx.textAlign = "center"; ctx.fillStyle = "#f3f8f5";
    ctx.font = "600 50px system-ui"; ctx.fillText(area.name, 512, 77, 950);
    ctx.fillStyle = area.color; ctx.font = "30px system-ui";
    ctx.fillText(area.id === "open-workspace" ? "SHARED DESKS / LOUNGE / ROAM" : "PROJECT WORK AREA", 512, 133);
    const value = new THREE.CanvasTexture(canvas); value.colorSpace = THREE.SRGBColorSpace;
    return value;
  }, [area.color, area.id, area.name]);
  useEffect(() => () => texture.dispose(), [texture]);
  const open = area.id === "open-workspace";
  const [x, , z] = toWorld(open ? 550 : (area.minX + area.maxX) / 2, open ? 775 : area.minY + 40);
  const width = Math.min(8.5, (area.maxX - area.minX - 40) * SCALE);
  return <mesh position={[x, 0.035, z]} rotation={[-Math.PI / 2, 0, 0]}>
    <planeGeometry args={[width, width * 180 / 1024]} />
    <meshBasicMaterial map={texture} toneMapped={false} />
  </mesh>;
}

export function CompanyWorkAreas({ layout }: { layout: CompanyLayout }) {
  return <group>{layout.areas.map(area => {
    const [x, , z] = toWorld((area.minX + area.maxX) / 2, (area.minY + area.maxY) / 2);
    return <group key={area.id}>
      <mesh position={[x, 0.012, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[(area.maxX - area.minX) * SCALE, (area.maxY - area.minY) * SCALE]} />
        <meshBasicMaterial color={area.color} transparent opacity={0.18} depthWrite={false} />
      </mesh>
      <AreaSign area={area} />
    </group>;
  })}</group>;
}

export function CompanyAreaCamera({ layout, focus, presetRef }: {
  layout: CompanyLayout; focus: { id: string; request: number };
  presetRef: MutableRefObject<{ pos: [number, number, number]; target: [number, number, number]; zoom?: number } | null>;
}) {
  const { size } = useThree();
  useEffect(() => {
    const area = layout.areas.find(a => a.id === focus.id);
    const bounds = area || { minX: 0, maxX: 1800, minY: 0, maxY: 1440 };
    const target = toWorld((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2);
    const span = (bounds.maxX - bounds.minX + bounds.maxY - bounds.minY) * SCALE;
    presetRef.current = { target, pos: [target[0] + 14, target[1] + 16, target[2] + 18],
      zoom: Math.max(4, Math.min(size.width / (span * 0.8 + 4), size.height / (span * 0.55 + 6)) * 0.9) };
  }, [layout.areas, focus, presetRef, size.width, size.height]);
  return null;
}
