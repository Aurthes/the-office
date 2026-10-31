"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { useUiText } from "@/lib/i18n/ui-language";
import { advanceSpaceMotion, emptySpaceEncounter, emptySpaceMotion, emptySpacePose, sampleAsteroid, samplePassingShip, SPACE_ACTIVITY_BUDGET, writeSpaceDust, type SpaceMotion } from "./space-activity";

export function createSpaceActivityResources() {
  const hullParts: THREE.BufferGeometry[] = [], engineParts: THREE.BufferGeometry[] = [];
  const part = (target: THREE.BufferGeometry[], shape: THREE.BufferGeometry, color: string) => {
    const geometry = shape.toNonIndexed(); shape.dispose();
    const rgb = new THREE.Color(color), colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = rgb.r; colors[i + 1] = rgb.g; colors[i + 2] = rgb.b; }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3)); target.push(geometry);
  };
  const box = (size: [number, number, number], point: [number, number, number], color: string) => part(hullParts, new THREE.BoxGeometry(...size).translate(...point), color);
  box([1.6, 1, 6], [0, 0, 0], "#788c98");
  part(hullParts, new THREE.ConeGeometry(.85, 2, 4).rotateX(-Math.PI / 2).translate(0, 0, -3.5), "#a2b3ba");
  box([1.1, .65, 1.3], [0, .75, -.9], "#a0adb3");
  box([.85, .25, .05], [0, .8, -1.575], "#69bed7");
  box([3.8, .13, .9], [0, 0, 1.2], "#556b7c");
  for (const side of [-1, 1]) {
    box([1.4, .9, 2.8], [side * 1.45, 0, .1], "#9c9d89");
    box([.7, .8, 3.2], [side * 2.2, 0, 1.1], "#526a7b");
    part(engineParts, new THREE.ConeGeometry(.28, 2, 6).rotateX(Math.PI / 2).translate(side * 2.2, 0, 3.7), "#76d5ed");
  }
  const hull = mergeGeometries(hullParts)!, engines = mergeGeometries(engineParts)!;
  for (const geometry of [...hullParts, ...engineParts]) geometry.dispose();
  const rock = new THREE.IcosahedronGeometry(1, 0), dust = new THREE.BufferGeometry();
  dust.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SPACE_ACTIVITY_BUDGET.dust * 3), 3).setUsage(THREE.DynamicDrawUsage));
  dust.setAttribute("color", new THREE.BufferAttribute(new Float32Array(SPACE_ACTIVITY_BUDGET.dust * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const rockMaterial = new THREE.MeshStandardMaterial({ color: "#71808c", roughness: 1, metalness: .03, flatShading: true });
  const hullMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .8, metalness: .18 });
  const engineMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .65, blending: THREE.AdditiveBlending, depthWrite: false });
  const dustMaterial = new THREE.PointsMaterial({ vertexColors: true, size: 1.1, sizeAttenuation: false, transparent: true, opacity: .3, depthWrite: false });
  return {
    rock, hull, engines, dust, rockMaterial, hullMaterial, engineMaterial, dustMaterial,
    dispose() { for (const geometry of [rock, hull, engines, dust]) geometry.dispose(); for (const material of [rockMaterial, hullMaterial, engineMaterial, dustMaterial]) material.dispose(); },
  };
}

export function SpaceActivity({ radius, seed, paused, motion, caption }: { radius: number; seed: number; paused: boolean; motion: RefObject<SpaceMotion>; caption: RefObject<HTMLElement | null> }) {
  const t = useUiText(), resources = useMemo(() => createSpaceActivityResources(), []);
  const group = useRef<THREE.Group>(null), rocks = useRef<THREE.InstancedMesh>(null), ships = useRef<THREE.InstancedMesh>(null), engines = useRef<THREE.InstancedMesh>(null);
  const dust = useRef<THREE.Points>(null);
  const buffer = useMemo(() => {
    const object = new THREE.Object3D(), pose = emptySpacePose();
    return { object, pose, encounter: emptySpaceEncounter(), transform() {
      object.position.set(pose.x, pose.y, pose.z); object.rotation.set(pose.rx, pose.ry, pose.rz);
      object.scale.set(pose.sx, pose.sy, pose.sz); object.updateMatrix();
    } };
  }, []);
  const reduced = useRef(false), notice = useRef({ label: "", node: null as HTMLElement | null, translate: t });
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)"), update = () => { reduced.current = media.matches; };
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => { Object.assign(motion.current, emptySpaceMotion()); }, [seed, motion]);
  useEffect(() => {
    for (const mesh of [rocks.current, ships.current, engines.current]) mesh?.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return () => resources.dispose();
  }, [resources]);
  useFrame((_state, delta) => {
    const active = !paused && !reduced.current && !document.hidden;
    if (group.current) group.current.visible = active;
    if (!active || !rocks.current || !ships.current || !engines.current || !dust.current) return;
    const encounter = advanceSpaceMotion(motion.current, delta, seed, buffer.encounter), elapsed = motion.current.elapsed;
    const { object, pose, transform } = buffer;
    for (let i = 0; i < SPACE_ACTIVITY_BUDGET.asteroids; i++) {
      sampleAsteroid(i, elapsed, seed, radius, pose); transform(); rocks.current.setMatrixAt(i, object.matrix);
    }
    rocks.current.instanceMatrix.needsUpdate = true;
    ships.current.count = engines.current.count = encounter.trafficCount;
    for (let i = 0; i < encounter.trafficCount; i++) {
      samplePassingShip(i, encounter, radius, pose); transform(); ships.current.setMatrixAt(i, object.matrix); engines.current.setMatrixAt(i, object.matrix);
    }
    if (encounter.trafficCount) { ships.current.instanceMatrix.needsUpdate = true; engines.current.instanceMatrix.needsUpdate = true; }
    const positions = dust.current.geometry.attributes.position, colors = dust.current.geometry.attributes.color;
    writeSpaceDust(elapsed, seed, radius, positions.array as Float32Array, colors.array as Float32Array);
    positions.needsUpdate = colors.needsUpdate = true;
    if (caption.current && (notice.current.label !== encounter.label || notice.current.node !== caption.current || notice.current.translate !== t)) {
      caption.current.replaceChildren(t(encounter.label)); notice.current = { label: encounter.label, node: caption.current, translate: t };
    }
  });
  return <group ref={group} dispose={null}>
    <instancedMesh ref={rocks} args={[resources.rock, resources.rockMaterial, SPACE_ACTIVITY_BUDGET.asteroids]} frustumCulled={false} raycast={() => {}} />
    <instancedMesh ref={ships} args={[resources.hull, resources.hullMaterial, SPACE_ACTIVITY_BUDGET.ships]} frustumCulled={false} raycast={() => {}} />
    <instancedMesh ref={engines} args={[resources.engines, resources.engineMaterial, SPACE_ACTIVITY_BUDGET.ships]} frustumCulled={false} raycast={() => {}} />
    <points ref={dust} geometry={resources.dust} material={resources.dustMaterial} frustumCulled={false} raycast={() => {}} />
  </group>;
}
