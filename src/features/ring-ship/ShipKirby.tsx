"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useCursor } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { companionBody } from "./companionMotion";
import { crewBodies, type MovingAgent } from "./crewMotion";
import { createKirbyFigure } from "./kirbyFigure";
import { advanceKirby, createKirbyState, kirbyActivity, resetKirby } from "./kirbyMotion";
import { paintKirbyBubble } from "./kirbyBubble";
import type { ShipCompanionProps } from "./ShipCompanions";
import type { ShipObject } from "./shipObjects";

export function ShipKirby({ layout, active, enabled, selectedId, onSelect, companionsRef, crewRef, chatAgentId, ceoBodyRef }: ShipCompanionProps) {
  const source = useLoader(GLTFLoader, "/office-assets/models/companions/kirby.glb");
  const figure = useMemo(() => createKirbyFigure(source), [source]);
  const [seed] = useState(() => crypto.getRandomValues(new Uint32Array(1))[0]);
  const state = useMemo(() => {
    return createKirbyState(layout, seed, figure.radius);
  }, [figure, layout, seed]);
  const record = useMemo<ShipObject>(() => {
    const cabin = layout.cabins.find(cabin => cabin.id === state.actor.cabinId)!;
    return { id: "npc:kirby", kind: "kirby", cabinId: cabin.id, cabinName: cabin.name, deck: 0, bounds: new THREE.Box3(), parts: [], npc: { name: "Kirby", activity: kirbyActivity(state) } };
  }, [layout, state]);
  const objectRef = useRef(record);
  useEffect(() => { objectRef.current = record; }, [record]);
  const group = useRef<THREE.Group>(null), ring = useRef<THREE.Mesh>(null), bubble = useRef<THREE.Sprite>(null), wind = useRef<THREE.LineSegments>(null);
  const [hovered, setHovered] = useState(false), { gl } = useThree();
  useCursor(enabled && hovered, "pointer", "auto", gl.domElement);
  const bubbleCanvas = useMemo(() => { const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 224; return canvas; }, []);
  const bubbleTexture = useMemo(() => { const texture = new THREE.CanvasTexture(bubbleCanvas); texture.colorSpace = THREE.SRGBColorSpace; return texture; }, [bubbleCanvas]);
  const bubbleTick = useRef("");
  useEffect(() => {
    const companions = companionsRef.current; companions.set("kirby", state.actor);
    const currentCrew = () => [...(crewRef?.current.values() || [])] as MovingAgent[];
    return () => { companions.delete("kirby"); resetKirby(state, currentCrew(), performance.now()); };
  }, [companionsRef, crewRef, state]);
  useEffect(() => () => { figure.dispose(); bubbleTexture.dispose(); }, [figure, bubbleTexture]);
  useEffect(() => { if (!active && state.victim) resetKirby(state, [...(crewRef?.current.values() || [])] as MovingAgent[], performance.now()); }, [active, state, crewRef]);
  useFrame(({ clock, camera }, elapsed) => {
    if (!active || !group.current) return;
    const crew = [...(crewRef?.current.values() || [])] as MovingAgent[];
    const others = [...crewBodies(crew, layout), ...[...companionsRef.current.values()].map(companionBody), ...(ceoBodyRef?.current ? [ceoBodyRef.current] : [])];
    advanceKirby(state, crew, layout, performance.now(), elapsed, others, chatAgentId);
    const time = clock.elapsedTime, actor = group.current, object = objectRef.current;
    figure.animate(state, time);
    actor.position.set(state.actor.position.x, .09, state.actor.position.z); actor.rotation.y = state.actor.facing; actor.updateMatrixWorld(true);
    object.bounds.copy(figure.bounds).applyMatrix4(actor.matrixWorld);
    const cabin = layout.cabins.find(cabin => cabin.id === state.actor.cabinId)!;
    object.cabinId = cabin.id; object.cabinName = cabin.name; object.npc!.activity = kirbyActivity(state);
    actor.userData.companion = state.actor; actor.userData.kirby = state; actor.userData.shipObject = object;
    if (ring.current) ring.current.position.y = -.005;
    if (bubble.current) {
      bubble.current.visible = state.phase === "holding";
      if (state.phase === "holding" && state.victim) {
        const tick = `${state.victim.id}:${Math.floor(time * 10)}`;
        if (bubbleTick.current !== tick) { paintKirbyBubble(bubbleCanvas, state.victim.appearance, time); bubble.current.material.map!.needsUpdate = true; bubbleTick.current = tick; }
        const size = Math.max(1.25, Math.min(2.5, 80 / camera.zoom));
        bubble.current.scale.set(size, size * 224 / 256, 1); bubble.current.position.y = 2.1 + Math.sin(time * 8) * .035;
      }
    }
    if (wind.current) {
      wind.current.visible = state.phase === "inhale" || state.phase === "spit";
      const positions = wind.current.geometry.getAttribute("position");
      for (let i = 0; i < 12; i++) {
        const phase = (time * 1.8 + i / 12) % 1, inward = state.phase === "inhale" ? 1 - phase : phase;
        const angle = i * 2.4 + time * 4, radius = .12 + inward * .45;
        positions.setXYZ(i * 2, Math.sin(angle) * radius, .61 + Math.cos(angle) * radius * .6, .48 + inward * 2);
        positions.setXYZ(i * 2 + 1, Math.sin(angle + .18) * radius, .61 + Math.cos(angle + .18) * radius * .6, .58 + inward * 2);
      }
      positions.needsUpdate = true; wind.current.geometry.computeBoundingSphere();
    }
  }, -.5);
  return <group ref={group} name="ship-companion:kirby" position={[state.actor.position.x, .09, state.actor.position.z]} rotation={[0, state.actor.facing, 0]}
    onPointerOver={enabled ? event => { if (event.pointerType === "mouse") { event.stopPropagation(); setHovered(true); } } : undefined}
    onPointerOut={() => setHovered(false)} onClick={enabled ? event => { event.stopPropagation(); if (event.delta < 6) onSelect(objectRef.current); } : undefined}>
    <primitive object={figure.root} dispose={null} />
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={enabled && (hovered || selectedId === "npc:kirby")}><ringGeometry args={[.75, .81, 40]} /><meshBasicMaterial color="#ffb6dd" transparent opacity={.75} depthWrite={false} toneMapped={false} /></mesh>
    <sprite ref={bubble} visible={false} renderOrder={110} name="kirby-belly-bubble"><spriteMaterial map={bubbleTexture} transparent depthTest={false} depthWrite={false} toneMapped={false} /></sprite>
    <lineSegments ref={wind} visible={false} name="kirby-inhale-wind"><bufferGeometry><bufferAttribute attach="attributes-position" args={[new Float32Array(72), 3]} /></bufferGeometry><lineBasicMaterial color="#fff5fb" transparent opacity={.7} depthWrite={false} /></lineSegments>
  </group>;
}
