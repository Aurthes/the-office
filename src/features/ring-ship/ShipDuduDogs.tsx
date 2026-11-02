"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useCursor } from "@react-three/drei";
import * as THREE from "three";
import { companionBody, COMPANION_NAMES } from "./companionMotion";
import { crewBodies } from "./crewMotion";
import { advanceDudu, createDuduState, duduActivity } from "./duduMotion";
import { createDuduFigure, duduHeartGeometry } from "./duduFigure";
import type { ShipCompanionProps } from "./ShipCompanions";
import type { ShipObject } from "./shipObjects";

export function ShipDuduDogs({ layout, active, enabled, selectedId, onSelect, companionsRef, crewRef }: ShipCompanionProps) {
  const [seed] = useState(() => crypto.getRandomValues(new Uint32Array(1))[0]);
  const state = useMemo(() => createDuduState(layout, seed), [layout, seed]);
  const figures = useMemo(() => [createDuduFigure("dumu"), createDuduFigure("dufu")], []);
  const groups = useRef<(THREE.Group | null)[]>([]), effects = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState<string | null>(null), { gl } = useThree();
  useCursor(enabled && hovered !== null, "pointer", "auto", gl.domElement);
  const hearts = useMemo(() => {
    const group = new THREE.Group(), geometry = duduHeartGeometry();
    const material = new THREE.MeshBasicMaterial({ color: "#ff9bb8", transparent: true, opacity: .9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
    for (let i = 0; i < 3; i++) group.add(new THREE.Mesh(geometry, material));
    return { group, dispose() { geometry.dispose(); material.dispose(); } };
  }, []);
  const previous = useMemo(() => state.dogs.map(dog => ({ ...dog.position })), [state]);
  const records = useMemo<ShipObject[]>(() => state.dogs.map((dog, i) => {
    const cabin = layout.cabins.find(c => c.id === dog.cabinId)!;
    return { id: `npc:${dog.kind}`, kind: i === 0 ? "dumu" : "dufu", cabinId: cabin.id, cabinName: cabin.name, deck: 0,
      bounds: new THREE.Box3(), parts: [], npc: { name: COMPANION_NAMES[dog.kind], activity: duduActivity(state, i) } };
  }), [state, layout]);
  const objectRefs = useRef(records);
  useEffect(() => { objectRefs.current = records; }, [records]);
  useEffect(() => {
    const companions = companionsRef.current;
    for (const dog of state.dogs) companions.set(dog.kind, dog);
    return () => { for (const dog of state.dogs) companions.delete(dog.kind); };
  }, [state, companionsRef]);
  useEffect(() => () => { figures.forEach(figure => figure.dispose()); hearts.dispose(); }, [figures, hearts]);
  useFrame(({ camera }, elapsed) => {
    if (!active) return;
    const dt = Math.min(elapsed, .05);
    const bodies = [...crewBodies([...(crewRef?.current.values() || [])], layout), ...[...companionsRef.current.values()].map(companionBody)];
    advanceDudu(state, layout, dt, bodies);
    for (const [i, dog] of state.dogs.entries()) {
      const actor = groups.current[i]; if (!actor) continue;
      const moving = Math.hypot(dog.position.x - previous[i].x, dog.position.z - previous[i].z) > .0001;
      Object.assign(previous[i], dog.position);
      const duration = state.interaction === "chase" ? 5.5 : state.interaction === "cuddle" ? 4 : 3.5;
      figures[i].animate(dog, state.clock, moving, state.phase === "play" ? state.interaction : undefined, state.elapsed / duration);
      actor.position.set(dog.position.x, .09, dog.position.z); actor.rotation.y = dog.facing; actor.updateMatrixWorld(true);
      const object = objectRefs.current[i];
      object.bounds.copy(figures[i].bounds).applyMatrix4(actor.matrixWorld);
      const cabin = layout.cabins.find(c => c.id === dog.cabinId)!;
      object.cabinId = cabin.id; object.cabinName = cabin.name; object.npc!.activity = duduActivity(state, i);
      actor.userData.companion = dog; actor.userData.shipObject = object; actor.userData.duo = state;
    }
    if (effects.current) {
      effects.current.visible = state.phase === "play" && state.interaction !== "chase";
      effects.current.position.set(state.center.x, 1.05, state.center.z);
      hearts.group.children.forEach((heart, i) => {
        const phase = (state.elapsed * .65 + i / 3) % 1;
        heart.quaternion.copy(camera.quaternion); heart.position.set(Math.sin(i * 2.4) * .25, phase * .65, Math.cos(i * 2.4) * .14);
        heart.scale.setScalar(Math.sin(phase * Math.PI) * .85);
      });
    }
  }, -.25);
  return <>
    {state.dogs.map((dog, i) => <group key={dog.kind} ref={node => { groups.current[i] = node; }} name={`ship-companion:${dog.kind}`} position={[dog.position.x, .09, dog.position.z]} rotation={[0, dog.facing, 0]}
      onPointerOver={enabled ? event => { if (event.pointerType === "mouse") { event.stopPropagation(); setHovered(dog.kind); } } : undefined}
      onPointerOut={() => setHovered(null)} onClick={enabled ? event => { event.stopPropagation(); if (event.delta < 6) onSelect(objectRefs.current[i]); } : undefined}>
      <primitive object={figures[i].root} dispose={null} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.005, 0]} visible={enabled && (hovered === dog.kind || selectedId === records[i].id)}>
        <ringGeometry args={[.43, .48, 40]} /><meshBasicMaterial color={i === 0 ? "#ffbdd2" : "#ffd493"} transparent opacity={.8} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>)}
    <group ref={effects} visible={false} name="dudu-floating-hearts" raycast={() => {}}><primitive object={hearts.group} dispose={null} /></group>
  </>;
}
