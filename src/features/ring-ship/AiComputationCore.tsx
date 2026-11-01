"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useCursor } from "@react-three/drei";
import * as THREE from "three";
import { useUiText } from "@/lib/i18n/ui-language";
import type { ShipCabin, ShipLayout } from "./layout";
import { aiCorePose } from "./ai-center-geometry";

export function AiComputationCore({ layout, cabin, interactive, onOpen }: {
  layout: ShipLayout; cabin: ShipCabin; interactive: boolean; onOpen: () => void;
}) {
  const t = useUiText(), { point, angle } = aiCorePose(layout, cabin);
  const rotor = useRef<THREE.Group>(null), crystal = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const reducedMotion = useRef(false);
  useCursor(hovered && interactive);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { reducedMotion.current = media.matches; };
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useFrame(({ clock }, delta) => {
    const reduced = reducedMotion.current;
    if (rotor.current && !reduced) rotor.current.rotation.y += Math.min(delta, .05) * .22;
    if (crystal.current) {
      crystal.current.position.y = 2.05 + (reduced ? 0 : Math.sin(clock.elapsedTime * 1.3) * .07);
      if (!reduced) crystal.current.rotation.y += Math.min(delta, .05) * .16;
      (crystal.current.material as THREE.MeshStandardMaterial).emissiveIntensity = hovered ? 1.2 : .65 + (reduced ? 0 : Math.sin(clock.elapsedTime * 1.3) * .12);
    }
  });
  return <group position={[point.x, 0, point.z]} rotation={[0, angle, 0]}
    onClick={event => { if (interactive) { event.stopPropagation(); onOpen(); } }}
    onPointerOver={event => { if (interactive) { event.stopPropagation(); setHovered(true); } }} onPointerOut={() => setHovered(false)}>
    <group ref={rotor} position={[0, 2.05, 0]}>
      {[0, 1].map(index => <group key={index} rotation={[.65 + index * 1.3, 0, index * .7]}>
        <mesh><torusGeometry args={[1.16 + index * .09, .055, 8, 64]} /><meshStandardMaterial color="#395969" metalness={.75} roughness={.28} /></mesh>
        <mesh><torusGeometry args={[1.16 + index * .09, .018, 6, 64, Math.PI * 1.35]} /><meshBasicMaterial color={index ? "#b5c7ff" : "#8ff9e2"} /></mesh>
        {[0, 1, 2, 3].map(n => <mesh key={n} position={[Math.cos(n * Math.PI / 2) * (1.16 + index * .09), Math.sin(n * Math.PI / 2) * (1.16 + index * .09), 0]} rotation={[0, 0, n * Math.PI / 2]}>
          <boxGeometry args={[.16, .27, .14]} /><meshStandardMaterial color="#cadcdd" metalness={.6} roughness={.32} />
        </mesh>)}
      </group>)}
    </group>
    <mesh ref={crystal} position={[0, 2.05, 0]}>
      <octahedronGeometry args={[.78, 0]} /><meshStandardMaterial color={hovered ? "#dcfff3" : "#91e9df"} emissive="#48c8ba" emissiveIntensity={hovered ? 1.2 : .65} metalness={.3} roughness={.2} flatShading />
    </mesh>
    <mesh position={[0, 2.05, 0]}><icosahedronGeometry args={[.98, 1]} /><meshBasicMaterial color="#9aece1" wireframe transparent opacity={.16} depthWrite={false} /></mesh>
    {[.72, 3.36].map(y => <group key={y} position={[0, y, 0]}>
      <mesh><cylinderGeometry args={[.62, .72, .18, 32]} /><meshStandardMaterial color="#c6d8dd" metalness={.5} roughness={.3} /></mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[.54, .035, 8, 48]} /><meshBasicMaterial color="#83eadd" /></mesh>
    </group>)}
    <mesh position={[0, 2, 0]}><cylinderGeometry args={[.12, .12, 2.5, 16]} /><meshBasicMaterial color="#b2fff0" transparent opacity={.16} depthWrite={false} /></mesh>
    {/* Pointer target includes the gaps between rings. The menu and toolbar provide keyboard access. */}
    {interactive ? <mesh position={[0, 2, 0]} name={t("Open AI Center")}><cylinderGeometry args={[1.3, 1.3, 3, 24]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} /></mesh> : null}
  </group>;
}
