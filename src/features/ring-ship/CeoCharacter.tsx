"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, useCursor } from "@react-three/drei";
import * as THREE from "three";
import type { AgentAvatarProfile } from "@/lib/avatars/profile";
import { CEO_ID } from "@/lib/office/organization";
import { AGENT_SCALE } from "@/features/retro-office/core/constants";
import { cabinAngle, shipPoint, type ShipLayout } from "./layout";
import type { ShipObject } from "./shipObjects";
import { useDuckFigure } from "./useDuckFigure";
import "./organization.css";

export function CeoCharacter({ layout, profile, enabled, onSelect, onReady }: { layout: ShipLayout; profile: AgentAvatarProfile; enabled: boolean; onSelect: (object: ShipObject) => void; onReady?: (object: ShipObject | null) => void }) {
  const figure = useDuckFigure(profile.duck), group = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false), { gl } = useThree();
  useCursor(enabled && hovered, "pointer", "auto", gl.domElement);
  const cabin = layout.cabins.find(value => value.kind === "monitor") || layout.cabins[0];
  const point = useMemo(() => shipPoint(layout.rings[cabin.ring].radius + 2.25, cabinAngle(layout, cabin.slot) - 1.45 / layout.rings[cabin.ring].radius), [layout, cabin]);
  const record = useMemo<ShipObject>(() => ({ id: CEO_ID, kind: "ceo", cabinId: cabin.id, cabinName: cabin.name, deck: 0,
    bounds: new THREE.Box3(), parts: [], npc: { name: "CEO", activity: "Overseeing department heads" } }), [cabin]);
  useLayoutEffect(() => { if (group.current) { group.current.updateMatrixWorld(true); record.bounds.setFromObject(group.current); onReady?.(record); } return () => onReady?.(null); }, [record, figure, point, onReady]);
  const animation = useRef(figure);
  useLayoutEffect(() => { animation.current = figure; }, [figure]);
  useFrame(state => { animation.current.body.rotation.y = Math.sin(state.clock.elapsedTime * .5) * .06; });
  const select = () => { if (enabled) onSelect(record); };
  return <group ref={group} name="office-ceo" position={[point.x, .08, point.z]} rotation={[0, cabinAngle(layout, cabin.slot) + Math.PI, 0]}
    onPointerOver={event => { event.stopPropagation(); if (event.pointerType === "mouse") setHovered(true); }} onPointerOut={() => setHovered(false)}
    onClick={event => { event.stopPropagation(); if (event.delta < 6) select(); }}>
    <primitive object={figure.root} scale={AGENT_SCALE} dispose={null} />
    <Html center position={[0, .88 * AGENT_SCALE, 0]} zIndexRange={[15, 14]} style={{ pointerEvents: "none" }}><button type="button" className="ceo-nameplate" data-hovered={enabled && hovered} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} disabled={!enabled} onClick={event => { event.stopPropagation(); select(); }}>CEO</button></Html>
  </group>;
}
