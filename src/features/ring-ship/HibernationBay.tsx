import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { RenderAgent } from "@/features/retro-office/core/types";
import { Builder, disposeShipGeometry } from "./geometry";
import type { MovingAgent } from "./crewMotion";
import type { ShipCabin, ShipLayout } from "./layout";
import { HIBERNATION, HIBERNATION_CAPACITY, hibernationPod } from "./hibernationLayout";
import { sleepLid } from "./hibernationMotion";

function Capsule({ layout, cabin, index, lookupRef, onOpen, interactive }: {
  layout: ShipLayout; cabin: ShipCabin; index: number; lookupRef: RefObject<Map<string, RenderAgent>>;
  onOpen: (id: string) => void; interactive: boolean;
}) {
  const lid = useRef<THREE.Group>(null), lamp = useRef<THREE.MeshStandardMaterial>(null);
  const occupant = useRef<string | null>(null);
  const pod = hibernationPod(layout, cabin, index);
  useFrame((_, delta) => {
    const agent = [...lookupRef.current.values()].find(value => {
      const state = (value as MovingAgent).hibernation;
      return state?.cabinId === cabin.id && state.pod === index && state.phase !== "returning";
    }) as MovingAgent | undefined;
    occupant.current = agent?.id ?? null;
    const sleep = agent?.hibernation;
    if (lid.current) {
      const target = -sleepLid(sleep) * 1.15;
      // A task pops the lid immediately; the slower close follows boarding.
      lid.current.rotation.x = sleep?.phase === "waking" ? target
        : THREE.MathUtils.damp(lid.current.rotation.x, target, 9, Math.min(delta, .1));
      lid.current.userData.phase = sleep?.phase ?? "empty";
      lid.current.userData.agentId = agent?.id ?? null;
    }
    if (lamp.current) {
      const color = sleep?.phase === "sleeping" ? "#9fc3ff" : sleep ? "#f1c26b" : "#64c6b5";
      lamp.current.color.set(color); lamp.current.emissive.set(color);
    }
  });
  return <group position={[pod.center.x, 0, pod.center.z]} rotation={[0, pod.facing, 0]} name={`hibernation-pod:${cabin.id}:${index}`}
    onClick={event => { if (interactive && occupant.current) { event.stopPropagation(); onOpen(occupant.current); } }}>
    <group ref={lid} position={[0, HIBERNATION.bedHeight, -HIBERNATION.length / 2]} rotation={[-1.15, 0, 0]} name={`hibernation-lid:${index}`}>
      <mesh position={[0, 0, HIBERNATION.length / 2]} scale={[HIBERNATION.width / 2, .83, HIBERNATION.length / 2]}>
        <sphereGeometry args={[1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial color="#a8c8e1" transparent opacity={.3} roughness={.2} metalness={.15} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, .05, 0]}><boxGeometry args={[1.2, .1, .12]} /><meshStandardMaterial color="#aabdc8" metalness={.5} roughness={.45} /></mesh>
    </group>
    <mesh position={[0, .35, HIBERNATION.length / 2 + .015]}>
      <boxGeometry args={[.55, .07, .025]} /><meshStandardMaterial ref={lamp} color="#64c6b5" emissive="#64c6b5" emissiveIntensity={.65} />
    </mesh>
  </group>;
}

export function HibernationBay({ layout, cabin, lookupRef, onOpen, interactive }: {
  layout: ShipLayout; cabin: ShipCabin; lookupRef: RefObject<Map<string, RenderAgent>>; onOpen: (id: string) => void; interactive: boolean;
}) {
  const base = useMemo(() => {
    const b = new Builder({}), matrix = new THREE.Matrix4();
    const box = (pod: ReturnType<typeof hibernationPod>, size: [number, number, number], y: number, z: number, color: string, radius: number) => {
      const position = new THREE.Vector3(pod.center.x + Math.sin(pod.facing) * z, y, pod.center.z + Math.cos(pod.facing) * z);
      matrix.compose(position, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pod.facing), new THREE.Vector3(1, 1, 1));
      b.add(new RoundedBoxGeometry(...size, 2, radius), color, matrix);
    };
    for (let index = 0; index < HIBERNATION_CAPACITY; index++) {
      const pod = hibernationPod(layout, cabin, index);
      box(pod, [HIBERNATION.width, .55, HIBERNATION.length], .34, 0, "#d5dee2", .22);
      box(pod, [1.2, .1, 1.98], .61, 0, "#63788c", .045);
      box(pod, [.9, .12, .32], .7, -.72, "#d3d9e7", .05);
      box(pod, [1.1, .13, 1.85], .13, 0, "#30495b", .05);
    }
    return b.finish();
  }, [layout, cabin]);
  useEffect(() => () => disposeShipGeometry(base), [base]);
  return <group name={`hibernation-bay:${cabin.id}`}>
    <primitive object={base} dispose={null} />
    {Array.from({ length: HIBERNATION_CAPACITY }, (_, index) => <Capsule key={index} layout={layout} cabin={cabin} index={index} lookupRef={lookupRef} onOpen={onOpen} interactive={interactive} />)}
  </group>;
}
