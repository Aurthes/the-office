"use client";
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal, useFrame, useThree } from "@react-three/fiber";
import { Html, useCursor } from "@react-three/drei";
import * as THREE from "three";
import type { AgentAvatarProfile } from "@/lib/avatars/profile";
import type { RenderAgent } from "@/features/retro-office/core/types";
import { CEO_ID } from "@/lib/office/organization";
import { AGENT_SCALE } from "@/features/retro-office/core/constants";
import type { ShipLayout } from "./layout";
import type { ShipObject } from "./shipObjects";
import { crewRadius, type CharacterBody } from "./characterCollision";
import { crewBodies } from "./crewMotion";
import { companionBody, type CompanionKind, type CompanionState } from "./companionMotion";
import { advanceCeo, ceoActivity, ceoBody, ceoHome, createCeoState } from "./ceoMotion";
import { animateCeoFigure } from "./ceoPose";
import { BreakProps } from "./BreakProps";
import type { BreakPoseState } from "./breakPose";
import { breakAction, breakSeatKey } from "./breakRoomLayout";
import { monitorChairPose } from "./monitor-room-geometry";
import { useDuckFigure } from "./useDuckFigure";
import "./organization.css";

export function CeoCharacter({ layout, profile, active, enabled, onSelect, onReady, bodyRef, crewRef, companionsRef }: {
  layout: ShipLayout; profile: AgentAvatarProfile; active: boolean; enabled: boolean; onSelect: (object: ShipObject) => void;
  onReady?: (object: ShipObject | null) => void; bodyRef: RefObject<CharacterBody | null>;
  crewRef: RefObject<Map<string, RenderAgent>>; companionsRef: RefObject<Map<CompanionKind, CompanionState>>;
}) {
  const figure = useDuckFigure(profile.duck), group = useRef<THREE.Group>(null);
  const tablet = useRef<THREE.Group>(null), cup = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false), { gl } = useThree();
  useCursor(enabled && hovered, "pointer", "auto", gl.domElement);
  const [seed] = useState(() => crypto.getRandomValues(new Uint32Array(1))[0]);
  const radius = crewRadius({ avatarProfile: profile });
  const state = useMemo(() => createCeoState(layout, seed, radius), [layout, seed, radius]);
  const home = ceoHome(layout), chair = monitorChairPose(layout, home);
  const bounds = useMemo(() => new THREE.Box3().setFromObject(figure.root).expandByScalar(.2).applyMatrix4(new THREE.Matrix4().makeScale(AGENT_SCALE, AGENT_SCALE, AGENT_SCALE)), [figure]);
  const record = useMemo<ShipObject>(() => ({ id: CEO_ID, kind: "ceo", cabinId: home.id, cabinName: home.name, deck: 0,
    bounds: new THREE.Box3(), parts: [], npc: { name: "CEO", activity: ceoActivity(state) } }), [home, state]);
  const objectRef = useRef(record);
  useLayoutEffect(() => {
    objectRef.current = record;
    const body = ceoBody(state); bodyRef.current = body;
    if (group.current) { group.current.updateMatrixWorld(true); record.bounds.copy(bounds).applyMatrix4(group.current.matrixWorld); onReady?.(record); }
    return () => { if (bodyRef.current === body) bodyRef.current = null; onReady?.(null); };
  }, [record, state, bounds, bodyRef, onReady]);
  const animation = useRef(figure);
  const breakPose = useRef<BreakPoseState>({ action: null, time: 0 });
  useLayoutEffect(() => { animation.current = figure; }, [figure]);
  useFrame((_, delta) => {
    if (!active || !group.current) return;
    const others = [...crewBodies([...crewRef.current.values()], layout), ...[...companionsRef.current.values()].map(companionBody)];
    advanceCeo(state, layout, delta, others);
    breakPose.current = { action: !state.route.length && state.breakVisit ? breakAction(state.breakVisit) : null, time: state.time };
    const props = animateCeoFigure(animation.current, state, chair.seatHeight, delta);
    const actor = group.current, object = objectRef.current; actor.position.set(state.position.x, .08, state.position.z); actor.rotation.y = state.facing;
    actor.updateMatrixWorld(true); object.bounds.copy(bounds).applyMatrix4(actor.matrixWorld);
    object.bounds.min.y += animation.current.root.position.y * AGENT_SCALE; object.bounds.max.y += animation.current.root.position.y * AGENT_SCALE;
    const cabin = layout.cabins.find(c => c.id === state.cabinId) || home;
    object.cabinId = cabin.id; object.cabinName = cabin.name; object.npc!.activity = ceoActivity(state);
    if (bodyRef.current) {
      bodyRef.current.position = state.position;
      bodyRef.current.reservedSeat = state.breakVisit ? breakSeatKey(state.breakVisit.cabinId, state.breakVisit.seat) : undefined;
    }
    actor.userData.ceo = state; actor.userData.shipObject = object;
    if (tablet.current) { tablet.current.visible = props.tablet; tablet.current.rotation.y = Math.sin(state.time * 1.5) * .04; }
    if (cup.current) {
      cup.current.visible = props.cup; cup.current.quaternion.copy(animation.current.wings[0].quaternion).invert(); cup.current.rotateZ(props.sip * .3);
    }
  });
  const select = () => { if (enabled) onSelect(objectRef.current); };
  return <group ref={group} name="office-ceo" position={[state.position.x, .08, state.position.z]} rotation={[0, state.facing, 0]}
    onPointerOver={event => { event.stopPropagation(); if (event.pointerType === "mouse") setHovered(true); }} onPointerOut={() => setHovered(false)}
    onClick={event => { event.stopPropagation(); if (event.delta < 6) select(); }}>
    <group scale={AGENT_SCALE}>
    <primitive object={figure.root} dispose={null} />
    <BreakProps figure={figure} stateRef={breakPose} />
    {createPortal(<group>
      <group ref={tablet} name="ceo-tablet" position={[-.02, .33, .22]} rotation={[.55, 0, 0]} visible={false}>
        <mesh><boxGeometry args={[.22, .16, .018]} /><meshStandardMaterial color="#263d50" roughness={.4} /></mesh>
        <mesh position={[0, 0, -.011]}><boxGeometry args={[.19, .13, .004]} /><meshBasicMaterial color="#84d8c1" /></mesh>
        <mesh position={[0, 0, .011]}><boxGeometry args={[.05, .012, .004]} /><meshStandardMaterial color="#e6c783" /></mesh>
      </group>
    </group>, figure.body)}
    {createPortal(<group ref={cup} name="ceo-coffee" position={[0, -.09, .01]} visible={false}>
        <mesh><cylinderGeometry args={[.045, .034, .085, 12]} /><meshStandardMaterial color="#efe2bd" roughness={.6} /></mesh>
        <mesh position={[0, .043, 0]}><cylinderGeometry args={[.036, .036, .003, 12]} /><meshStandardMaterial color="#55382c" /></mesh>
        <mesh position={[.045, 0, 0]}><torusGeometry args={[.024, .006, 5, 10]} /><meshStandardMaterial color="#efe2bd" /></mesh>
      </group>, figure.wings[0])}
    </group>
    <Html center position={[0, .95 * AGENT_SCALE, 0]} zIndexRange={[15, 14]} style={{ pointerEvents: "none" }}><button type="button" className="ceo-nameplate" data-hovered={enabled && hovered} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} disabled={!enabled} onClick={event => { event.stopPropagation(); select(); }}>CEO</button></Html>
  </group>;
}
