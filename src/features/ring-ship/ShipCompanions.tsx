"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useCursor } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { advanceCompanion, companionActivity, companionWorkPoint, COMPANION_NAMES, createCompanionState, type CompanionKind } from "./companionMotion";
import { createCompanionFigure } from "./companionFigure";
import type { ShipLayout } from "./layout";
import type { ShipObject, ShipObjectKind } from "./shipObjects";

const MODELS = {
  cat: "/office-assets/models/companions/cat.glb", dog: "/office-assets/models/companions/dog.glb",
  drone: "/office-assets/models/companions/mech-drone.glb", bartender: "/office-assets/models/companions/core-bartender.glb",
};
const HEIGHTS = { cat: .62, dog: .7, drone: 1.05, bartender: 1.35 };
const KINDS: Record<CompanionKind, ShipObjectKind> = { cat: "cat", dog: "dog", drone: "mechDrone", bartender: "robotBartender" };
const Z_AXIS = new THREE.Vector3(0, 0, 1);
type Props = { layout: ShipLayout; active: boolean; enabled: boolean; selectedId?: string; onSelect: (object: ShipObject) => void };

function WorkProps({ cup, cloth, bottle, bubbles, beam, sparks }: {
  cup: RefObject<THREE.Group | null>; cloth: RefObject<THREE.Mesh | null>; bottle: RefObject<THREE.Group | null>;
  bubbles: RefObject<THREE.Group | null>; beam: RefObject<THREE.LineSegments | null>; sparks: RefObject<THREE.Group | null>;
}) {
  return <>
    <group ref={cup} visible={false} name="bartender-working-glass">
      <mesh><cylinderGeometry args={[.048, .035, .12, 16, 1, true]} /><meshStandardMaterial color="#d7eeeb" transparent opacity={.55} roughness={.2} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, -.035, 0]} name="drink"><cylinderGeometry args={[.034, .029, .04, 16]} /><meshStandardMaterial color="#dba65b" transparent opacity={.8} roughness={.25} /></mesh>
      <mesh position={[0, -.06, 0]}><cylinderGeometry args={[.035, .035, .008, 16]} /><meshStandardMaterial color="#b0d8d1" transparent opacity={.6} /></mesh>
    </group>
    <mesh ref={cloth} visible={false} name="bartender-cleaning-cloth"><boxGeometry args={[.12, .025, .08]} /><meshStandardMaterial color="#d9e5cd" roughness={1} /></mesh>
    <group ref={bottle} visible={false} name="bartender-pouring-bottle">
      <mesh><cylinderGeometry args={[.039, .043, .18, 12]} /><meshStandardMaterial color="#3f7963" metalness={.15} roughness={.3} /></mesh>
      <mesh position={[0, .125, 0]}><cylinderGeometry args={[.017, .025, .07, 12]} /><meshStandardMaterial color="#355d50" roughness={.3} /></mesh>
      <mesh position={[0, -.01, 0]}><cylinderGeometry args={[.044, .044, .06, 12]} /><meshStandardMaterial color="#e8d8af" /></mesh>
      <mesh position={[.055, .12, 0]} name="stream"><cylinderGeometry args={[.004, .004, .2, 6]} /><meshBasicMaterial color="#e7c47d" transparent opacity={.65} /></mesh>
    </group>
    <group ref={bubbles} visible={false} name="washing-bubbles">{Array.from({ length: 5 }, (_, i) => <mesh key={i}><icosahedronGeometry args={[.012, 0]} /><meshBasicMaterial color="#d9fbff" transparent opacity={.55} /></mesh>)}</group>
    <lineSegments ref={beam} visible={false} name="maintenance-scan-beam" raycast={() => {}}><bufferGeometry><bufferAttribute attach="attributes-position" args={[new Float32Array(6), 3]} /></bufferGeometry><lineBasicMaterial color="#8aefd6" transparent opacity={.55} /></lineSegments>
    <group ref={sparks} visible={false} name="maintenance-sparks">{Array.from({ length: 5 }, (_, i) => <mesh key={i} raycast={() => {}}><icosahedronGeometry args={[.009, 0]} /><meshBasicMaterial color="#ffda8c" /></mesh>)}</group>
  </>;
}

function Companion({ kind, ...props }: Props & { kind: CompanionKind }) {
  const { layout, active, enabled, selectedId, onSelect } = props;
  const source = useLoader(GLTFLoader, MODELS[kind]);
  const figure = useMemo(() => createCompanionFigure(source, kind, HEIGHTS[kind]), [source, kind]);
  const [seed] = useState(() => crypto.getRandomValues(new Uint32Array(1))[0]);
  const state = useMemo(() => createCompanionState(kind, layout, seed), [kind, layout, seed]);
  const record = useMemo<ShipObject>(() => {
    const cabin = layout.cabins.find(c => c.id === state.cabinId)!;
    return { id: `npc:${kind}`, kind: KINDS[kind], cabinId: cabin.id, cabinName: cabin.name, deck: 0, bounds: new THREE.Box3(), parts: [], npc: { name: COMPANION_NAMES[kind], activity: companionActivity(state) } };
  }, [kind, layout, state]);
  const objectRef = useRef(record);
  const group = useRef<THREE.Group>(null), ring = useRef<THREE.Mesh>(null), sleepy = useRef<THREE.Sprite>(null);
  const cup = useRef<THREE.Group>(null), cloth = useRef<THREE.Mesh>(null), bottle = useRef<THREE.Group>(null), bubbles = useRef<THREE.Group>(null);
  const beam = useRef<THREE.LineSegments>(null), sparks = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false), { gl } = useThree();
  useCursor(enabled && hovered, "pointer", "auto", gl.domElement);
  const vectors = useMemo(() => ({ target: new THREE.Vector3(), left: new THREE.Vector3(), right: new THREE.Vector3(), inverse: new THREE.Matrix4() }), []);
  const sleepTexture = useMemo(() => {
    if (kind !== "cat" && kind !== "dog") return;
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d")!; context.font = "bold 46px system-ui"; context.fillStyle = "#d9ebf5"; context.textAlign = "center"; context.fillText("z", 32, 48);
    return new THREE.CanvasTexture(canvas);
  }, [kind]);
  useEffect(() => () => { figure.dispose(); sleepTexture?.dispose(); }, [figure, sleepTexture]);
  useFrame((_, elapsed) => {
    if (!active || !group.current) return;
    const delta = Math.min(elapsed, .05), actor = group.current, object = objectRef.current;
    advanceCompanion(state, layout, delta); figure.animate(state, delta);
    actor.position.set(state.position.x, state.y + ((kind === "drone" || kind === "bartender") ? Math.sin(state.time * 1.7) * .035 : 0), state.position.z);
    actor.rotation.y = state.facing; actor.updateMatrixWorld(true);
    object.bounds.copy(figure.bounds).applyMatrix4(actor.matrixWorld);
    const cabin = layout.cabins.find(c => c.id === state.cabinId)!;
    object.cabinId = cabin.id; object.cabinName = cabin.name; object.npc!.activity = companionActivity(state);
    actor.userData.companion = state; actor.userData.shipObject = object;
    if (ring.current) ring.current.position.y = .085 - actor.position.y;
    if (sleepy.current) { sleepy.current.visible = figure.pose.sleep > .5; sleepy.current.position.y = HEIGHTS[kind] + .18 + (state.time % 2) * .05; sleepy.current.material.opacity = figure.pose.sleep * (1 - state.time % 2 / 2); }
    if (kind === "bartender" && figure.rig) {
      vectors.inverse.copy(actor.matrixWorld).invert();
      const work = companionWorkPoint(state, layout), working = !state.route.length;
      vectors.target.set(work.x, work.y, work.z).applyMatrix4(vectors.inverse);
      const wash = working && state.action === "wash", pour = working && state.action === "pour", wipe = working && state.action === "wipe", stock = working && state.action === "inventory";
      const left = vectors.left.copy(vectors.target), right = vectors.right.copy(vectors.target);
      if (wash) { left.y += .015; right.x += Math.sin(state.time * 7) * .035; right.y += .045 + Math.cos(state.time * 7) * .03; }
      else if (pour) { right.x -= .14; right.y += .16; }
      else if (wipe) { left.set(-.2, .6, .35); }
      else if (stock) { left.set(-.25, .6, .35); right.y += .015; }
      else { left.set(-.25, .6, .35); right.set(.25, .6, .35); }
      figure.rig.pose(0, left, delta); figure.rig.pose(1, right, delta);
      if (cup.current) {
        cup.current.visible = wash || pour; cup.current.position.copy(vectors.target); cup.current.rotation.set(0, -state.facing, wash ? Math.sin(state.time * 2) * .08 : 0);
        const drink = cup.current.getObjectByName("drink")!;
        drink.scale.y = pour ? .25 + .75 * Math.min(1, state.time / state.duration) : 1;
      }
      if (cloth.current) { cloth.current.visible = wash || wipe; cloth.current.position.copy(right); cloth.current.rotation.set(0, -state.facing, wash ? Math.sin(state.time * 7) * .2 : 0); }
      if (bottle.current) {
        bottle.current.visible = pour; bottle.current.position.copy(right); bottle.current.rotation.z = -1.15 + Math.sin(state.time * 2) * .06;
        const stream = bottle.current.getObjectByName("stream")!;
        stream.position.copy(vectors.left.copy(vectors.target).sub(right).addScaledVector(THREE.Object3D.DEFAULT_UP, .11).applyAxisAngle(Z_AXIS, -bottle.current.rotation.z));
        stream.rotation.z = -bottle.current.rotation.z;
      }
      if (bubbles.current) {
        bubbles.current.visible = wash; bubbles.current.position.copy(vectors.target);
        bubbles.current.children.forEach((bubble, i) => { const phase = (state.time * .7 + i / 5) % 1; bubble.position.set(Math.sin(i * 2.4) * .065, phase * .18, Math.cos(i * 2.4) * .065); bubble.scale.setScalar(Math.sin(phase * Math.PI)); });
      }
    }
    if (kind === "drone" && beam.current && sparks.current) {
      const working = !state.route.length && ["scan", "repair"].includes(state.action), target = companionWorkPoint(state, layout);
      vectors.target.set(target.x, target.y, target.z); actor.worldToLocal(vectors.target);
      beam.current.visible = working; const attribute = beam.current.geometry.getAttribute("position");
      attribute.setXYZ(0, 0, .65, .15); attribute.setXYZ(1, vectors.target.x, vectors.target.y, vectors.target.z); attribute.needsUpdate = true;
      beam.current.geometry.computeBoundingSphere();
      sparks.current.visible = working && state.action === "repair" && Math.sin(state.time * 15) > .25; sparks.current.position.copy(vectors.target);
      sparks.current.children.forEach((spark, i) => spark.position.set(Math.sin(state.time * 13 + i) * .07, Math.abs(Math.cos(state.time * 9 + i)) * .06, Math.cos(state.time * 13 + i) * .07));
    }
  });
  return <group ref={group} name={`ship-companion:${kind}`} position={[state.position.x, state.y, state.position.z]} rotation={[0, state.facing, 0]}
    onPointerOver={enabled ? event => { if (event.pointerType === "mouse") { event.stopPropagation(); setHovered(true); } } : undefined}
    onPointerOut={() => setHovered(false)} onClick={enabled ? event => { event.stopPropagation(); if (event.delta < 6) onSelect(objectRef.current); } : undefined}>
    <primitive object={figure.normalized} dispose={null} />
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={enabled && (hovered || selectedId === `npc:${kind}`)}><ringGeometry args={[kind === "cat" || kind === "dog" ? .37 : .63, kind === "cat" || kind === "dog" ? .42 : .69, 40]} /><meshBasicMaterial color="#ffd48c" transparent opacity={.7} depthWrite={false} toneMapped={false} /></mesh>
    {(kind === "cat" || kind === "dog") ? <sprite ref={sleepy} visible={false} scale={[.16, .16, 1]}><spriteMaterial map={sleepTexture} transparent depthWrite={false} /></sprite> : null}
    {(kind === "bartender" || kind === "drone") ? <WorkProps cup={cup} cloth={cloth} bottle={bottle} bubbles={bubbles} beam={beam} sparks={sparks} /> : null}
  </group>;
}

export function ShipCompanions(props: Props) {
  return <>{(["cat", "dog", "drone", "bartender"] as const).map(kind => <Suspense key={kind} fallback={null}><Companion kind={kind} {...props} /></Suspense>)}</>;
}
