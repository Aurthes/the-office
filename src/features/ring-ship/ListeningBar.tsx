"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Html, RoundedBox, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { Disc3 } from "lucide-react";
import { useUiText } from "@/lib/i18n/ui-language";
import { cabinAngle, shipPoint, type ShipCabin, type ShipLayout } from "./layout";
import "./listening-bar.css";

const BRASS = "#c6a46a";
const paths = ["wood-color", "wood-normal", "wood-roughness", "marble-color", "marble-normal", "marble-roughness"].map(name => `/office-assets/bar/${name}.jpg`);

function Surfaces({ children }: { children: (wood: THREE.MeshStandardMaterial, marble: THREE.MeshStandardMaterial) => ReactNode }) {
  const sources = useTexture(paths);
  const surfaces = useMemo(() => {
    const maps = sources.map((source, index) => {
      const map = source.clone();
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.colorSpace = index % 3 === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      map.anisotropy = 4;
      return map;
    });
    const wood = new THREE.MeshStandardMaterial({ map: maps[0], normalMap: maps[1], roughnessMap: maps[2], roughness: .7, normalScale: new THREE.Vector2(.25, .25) });
    const marble = new THREE.MeshStandardMaterial({ map: maps[3], normalMap: maps[4], roughnessMap: maps[5], roughness: .3, normalScale: new THREE.Vector2(.35, .35) });
    return { maps, wood, marble };
  }, [sources]);
  useEffect(() => () => { surfaces.maps.forEach(map => map.dispose()); surfaces.wood.dispose(); surfaces.marble.dispose(); }, [surfaces]);
  return children(surfaces.wood, surfaces.marble);
}

function Bottle({ x, color, height }: { x: number; color: string; height: number }) {
  return <group position={[x, 1.33, .16]}>
    <mesh position={[0, height / 2, 0]} castShadow><cylinderGeometry args={[.065, .075, height, 20]} /><meshPhysicalMaterial color={color} roughness={.2} metalness={.05} transparent opacity={.88} /></mesh>
    <mesh position={[0, height + .035, 0]}><cylinderGeometry args={[.029, .042, .095, 16]} /><meshStandardMaterial color={color} roughness={.2} /></mesh>
    <mesh position={[0, height + .091, 0]}><cylinderGeometry args={[.031, .031, .027, 16]} /><meshStandardMaterial color={BRASS} metalness={.7} roughness={.25} /></mesh>
    <mesh position={[0, height * .45, 0]}><cylinderGeometry args={[.076, .076, .09, 20]} /><meshStandardMaterial color="#e6d8b4" roughness={.8} /></mesh>
  </group>;
}

function Speaker({ x, wood }: { x: number; wood: THREE.MeshStandardMaterial }) {
  return <group position={[x, 1.33, .04]}>
    <RoundedBox args={[.32, .44, .27]} radius={.02} smoothness={2} position={[0, .22, 0]} material={wood} castShadow />
    <mesh position={[0, .22, -.14]}><boxGeometry args={[.275, .395, .018]} /><meshStandardMaterial color="#242523" roughness={.95} /></mesh>
    {[{ y: .16, r: .09 }, { y: .33, r: .038 }].map(({ y, r }) => <group key={y} position={[0, y, -.155]} rotation={[Math.PI / 2, 0, 0]}>
      <mesh><cylinderGeometry args={[r, r, .014, 32]} /><meshStandardMaterial color="#131715" roughness={.7} /></mesh>
      <mesh position={[0, .01, 0]}><sphereGeometry args={[r * .4, 16, 12]} /><meshStandardMaterial color="#333b38" metalness={.4} roughness={.4} /></mesh>
    </group>)}
  </group>;
}

function Turntable({ wood, onOpen }: { wood: THREE.MeshStandardMaterial; onOpen: () => void }) {
  const t = useUiText();
  const [hovered, setHovered] = useState(false);
  return <group position={[.68, 1.34, -.04]}
    onClick={event => { event.stopPropagation(); if (event.delta < 6) onOpen(); }}
    onPointerOver={event => { event.stopPropagation(); setHovered(true); }}
    onPointerOut={() => setHovered(false)}>
    <RoundedBox args={[1.15, .115, .68]} radius={.025} smoothness={3} position={[0, .08, 0]} material={wood} castShadow />
    <mesh position={[0, .145, 0]}><boxGeometry args={[1.08, .025, .615]} /><meshStandardMaterial color={hovered ? "#323d37" : "#202824"} metalness={.4} roughness={.34} /></mesh>
    {[-.46, .46].flatMap(x => [-.24, .24].map(z => <mesh key={`${x}:${z}`} position={[x, .012, z]}><cylinderGeometry args={[.045, .04, .04, 16]} /><meshStandardMaterial color="#111b19" /></mesh>))}
    <group position={[-.16, .17, 0]}>
      <mesh><cylinderGeometry args={[.28, .28, .033, 64]} /><meshStandardMaterial color="#b2bab5" metalness={.9} roughness={.22} /></mesh>
      <mesh position={[0, .02, 0]}><cylinderGeometry args={[.266, .266, .009, 64]} /><meshStandardMaterial color="#0c1210" metalness={.25} roughness={.31} /></mesh>
      {[.115, .14, .165, .19, .215, .24, .255].map(radius => <mesh key={radius} position={[0, .0255, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius - .001, radius + .001, 64]} /><meshStandardMaterial color="#3a4440" metalness={.65} roughness={.36} />
      </mesh>)}
      <mesh position={[0, .027, 0]}><cylinderGeometry args={[.079, .079, .005, 48]} /><meshStandardMaterial color="#b65b42" roughness={.75} /></mesh>
      <mesh position={[0, .039, 0]}><cylinderGeometry args={[.008, .008, .022, 16]} /><meshStandardMaterial color={BRASS} metalness={.8} roughness={.2} /></mesh>
    </group>
    <mesh position={[.35, .2, .19]}><cylinderGeometry args={[.055, .055, .085, 24]} /><meshStandardMaterial color={BRASS} metalness={.75} roughness={.2} /></mesh>
    <group position={[.35, .25, .19]} rotation={[0, -.45, 0]}>
      <mesh position={[0, 0, -.18]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.012, .012, .37, 16]} /><meshStandardMaterial color="#bfc9c3" metalness={.9} roughness={.18} /></mesh>
      <mesh position={[0, -.018, -.37]}><boxGeometry args={[.043, .032, .065]} /><meshStandardMaterial color="#b65b42" /></mesh>
      <mesh position={[0, 0, .062]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.034, .034, .085, 20]} /><meshStandardMaterial color="#77837e" metalness={.8} roughness={.3} /></mesh>
    </group>
    <mesh position={[.4, .173, -.24]}><cylinderGeometry args={[.025, .025, .025, 20]} /><meshStandardMaterial color={BRASS} metalness={.8} roughness={.2} /></mesh>
    <Html center position={[0, .65, 0]} zIndexRange={[16, 15]}>
      <button type="button" className="listening-bar-label" data-hovered={hovered} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onOpen(); }} aria-label={t("Choose a music player")}><Disc3 size={14} />{t("Music")}</button>
    </Html>
  </group>;
}

function BarModel({ onOpen }: { onOpen: () => void }) {
  return <Surfaces>{(wood, marble) => <>
    <RoundedBox args={[4.5, 1.08, .64]} radius={.045} smoothness={3} position={[0, .66, 0]} material={wood} castShadow receiveShadow />
    {/* Individual wood ribs catch the light; the counter has a rounded stone edge. */}
    {Array.from({ length: 37 }, (_, i) => <mesh key={i} position={[-2.16 + i * .12, .66, -.335]} material={wood} castShadow><boxGeometry args={[.065, .95, .035]} /></mesh>)}
    <RoundedBox args={[4.75, .13, .92]} radius={.035} smoothness={3} position={[0, 1.265, 0]} material={marble} castShadow receiveShadow />
    <mesh position={[0, 1.19, -.34]}><boxGeometry args={[4.38, .018, .018]} /><meshStandardMaterial color="#edc587" emissive="#edb46c" emissiveIntensity={.7} toneMapped={false} /></mesh>
    <mesh position={[0, .17, -.48]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.021, .021, 4.3, 16]} /><meshStandardMaterial color={BRASS} metalness={.8} roughness={.3} /></mesh>
    {[-1.9, 1.9].map(x => <mesh key={x} position={[x, .14, -.4]} rotation={[Math.PI / 3, 0, 0]}><cylinderGeometry args={[.019, .019, .25, 12]} /><meshStandardMaterial color={BRASS} metalness={.8} roughness={.3} /></mesh>)}
    {[-1.55, -.05, 1.45].map(x => <group key={x} position={[x, 0, -.9]}>
      <mesh position={[0, .105, 0]}><cylinderGeometry args={[.27, .29, .06, 32]} /><meshStandardMaterial color="#293b35" metalness={.7} roughness={.35} /></mesh>
      <mesh position={[0, .42, 0]}><cylinderGeometry args={[.035, .05, .62, 20]} /><meshStandardMaterial color={BRASS} metalness={.8} roughness={.28} /></mesh>
      <mesh position={[0, .28, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[.18, .014, 8, 32]} /><meshStandardMaterial color={BRASS} metalness={.8} roughness={.28} /></mesh>
      <mesh position={[0, .78, 0]} castShadow><cylinderGeometry args={[.27, .26, .12, 40]} /><meshStandardMaterial color="#355146" roughness={.9} /></mesh>
      <mesh position={[0, .714, 0]}><cylinderGeometry args={[.265, .265, .022, 40]} /><meshStandardMaterial color={BRASS} metalness={.7} roughness={.3} /></mesh>
    </group>)}
    <Bottle x={-1.95} height={.31} color="#315b43" /><Bottle x={-1.67} height={.25} color="#96552d" /><Bottle x={-1.4} height={.35} color="#3a665b" />
    {[-1.1, -.87].map(x => <group key={x} position={[x, 1.33, -.1]}>
      <mesh position={[0, .055, 0]}><cylinderGeometry args={[.064, .054, .11, 24, 1, true]} /><meshPhysicalMaterial color="#d4e1d4" metalness={.1} roughness={.12} transparent opacity={.5} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, .025, 0]}><cylinderGeometry args={[.052, .05, .045, 24]} /><meshStandardMaterial color="#bc8941" roughness={.2} /></mesh>
    </group>)}
    <Speaker x={-.3} wood={wood} /><Speaker x={1.65} wood={wood} />
    <Turntable wood={wood} onOpen={onOpen} />
  </>}</Surfaces>;
}

export function ListeningBar({ layout, cabin, onOpen }: { layout: ShipLayout; cabin: ShipCabin; onOpen: () => void }) {
  const angle = cabinAngle(layout, cabin.slot), point = shipPoint(layout.rings[cabin.ring].radius + 1.65, angle);
  return <group position={[point.x, 0, point.z]} rotation={[0, angle, 0]}><Suspense fallback={null}><BarModel onOpen={onOpen} /></Suspense></group>;
}
