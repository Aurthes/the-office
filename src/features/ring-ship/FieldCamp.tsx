import { useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { RenderAgent } from "@/features/retro-office/core/types";
import { cabinAngle, DECK_STEP, type ShipLayout } from "./layout";
import type { MovingAgent } from "./crewMotion";

export function FieldCamp({ agentId, lookup, layout, visibleDeck }: { agentId: string; lookup: RefObject<Map<string, RenderAgent>>; layout: ShipLayout; visibleDeck: number }) {
  const ref = useRef<THREE.Group>(null), lamp = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    const actor = lookup.current.get(agentId) as MovingAgent | undefined, field = actor?.fieldwork, group = ref.current;
    if (!group) return;
    const cabin = field && layout.cabins.find(c => c.id === field.cabinId);
    group.visible = !!field && !!cabin && cabin.deck === visibleDeck && !["travelling", "returning", "lift"].includes(field.phase);
    if (!field || !cabin || !group.visible) return;
    group.position.set(field.camp.x, .08 + cabin.deck * DECK_STEP, field.camp.z);
    group.rotation.y = cabinAngle(layout, cabin.slot);
    group.scale.setScalar(field.phase === "changing" ? Math.min(1, field.time / .7) : field.phase === "packing" ? Math.max(.05, 1 - field.time / 1.8) : 1);
    if (lamp.current) lamp.current.emissiveIntensity = actor?.needsInput ? .9 : .3 + Math.sin(field.time * 3) ** 4 * .6;
  });
  return <group ref={ref} name={`field-camp:${agentId}`} visible={false}>
    {[-.62, .62].map(x => <group key={x} position={[x, 0, .46]}>
      <mesh position={[0, .018, 0]} receiveShadow><boxGeometry args={[.25, .036, .25]} /><meshStandardMaterial color="#384049" /></mesh>
      <mesh position={[0, .16, 0]} castShadow><coneGeometry args={[.1, .28, 12]} /><meshStandardMaterial color="#ef792c" /></mesh>
      <mesh position={[0, .17, 0]}><cylinderGeometry args={[.045, .061, .045, 12]} /><meshStandardMaterial color="#e9edcb" metalness={.4} roughness={.3} /></mesh>
    </group>)}
    <group position={[.46, .15, -.45]}>
      <mesh castShadow><boxGeometry args={[.48, .28, .3]} /><meshStandardMaterial color="#e57d32" roughness={.6} /></mesh>
      <mesh position={[0, .156, 0]}><torusGeometry args={[.06, .012, 5, 12, Math.PI]} /><meshStandardMaterial color="#293b43" /></mesh>
      {[-.16, .16].map(x => <mesh key={x} position={[x, 0, .155]}><boxGeometry args={[.035, .25, .014]} /><meshStandardMaterial color="#34464d" /></mesh>)}
      <mesh position={[.16, .19, 0]}><sphereGeometry args={[.033, 10, 8]} /><meshStandardMaterial ref={lamp} color="#ffd36d" emissive="#ffb940" emissiveIntensity={.6} /></mesh>
    </group>
    <group position={[-.26, 0, -.53]}>
      <mesh position={[0, .57, 0]} castShadow><boxGeometry args={[.8, .045, .43]} /><meshStandardMaterial color="#b5a78b" roughness={.8} /></mesh>
      {[-.29, .29].map(x => <mesh key={x} position={[x, .28, 0]} rotation={[0, 0, x > 0 ? -.12 : .12]}><boxGeometry args={[.035, .55, .3]} /><meshStandardMaterial color="#586c70" metalness={.5} /></mesh>)}
      <mesh position={[0, .595, 0]} rotation={[-Math.PI / 2, 0, .08]}><planeGeometry args={[.55, .33]} /><meshStandardMaterial color="#34718f" roughness={.95} /></mesh>
      {[-.12, 0, .12].map(x => <mesh key={x} position={[x, .598, 0]}><boxGeometry args={[.002, .002, .25]} /><meshStandardMaterial color="#aac8cb" /></mesh>)}
      <mesh position={[0, .599, -.08]}><boxGeometry args={[.45, .002, .003]} /><meshStandardMaterial color="#e1e9cd" /></mesh>
    </group>
  </group>;
}
