"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { cabinAngle, shipPoint, type ShipCabin, type ShipLayout } from "./layout";

const MODELS = {
  cat: "/office-assets/models/companions/cat.glb",
  dog: "/office-assets/models/companions/dog.glb",
  drone: "/office-assets/models/companions/mech-drone.glb",
  bartender: "/office-assets/models/companions/core-bartender.glb",
};
type Kind = keyof typeof MODELS;

function Companion({ kind, height, position, rotation }: { kind: Kind; height: number; position: [number, number, number]; rotation: number }) {
  const source = useLoader(GLTFLoader, MODELS[kind]);
  const figure = useMemo(() => {
    const scene = clone(source.scene);
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(scene), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    const scale = height / Math.max(size.y, .01);
    const normalized = new THREE.Group();
    normalized.scale.setScalar(scale);
    normalized.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    normalized.add(scene);
    // The cached geometry, materials and textures are shared across mounts.
    scene.traverse(object => { if (object instanceof THREE.Mesh) { object.receiveShadow = true; object.castShadow = kind === "cat" || kind === "dog"; } });
    return { scene, normalized, mixer: new THREE.AnimationMixer(scene) };
  }, [source, height, kind]);
  const group = useRef<THREE.Group>(null);
  useEffect(() => {
    const clip = source.animations.find(animation => animation.name === "idle") || source.animations[0];
    if (clip) figure.mixer.clipAction(clip).play();
    return () => { figure.mixer.stopAllAction(); figure.mixer.uncacheRoot(figure.scene); };
  }, [figure, source]);
  useFrame((state, delta) => {
    figure.mixer.update(Math.min(delta, .05));
    if (group.current && (kind === "drone" || kind === "bartender")) {
      group.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 1.5 + rotation) * .045;
    }
  });
  return <group ref={group} name={`ship-companion:${kind}`} position={position} rotation={[0, rotation, 0]}>
    <primitive object={figure.normalized} dispose={null} />
  </group>;
}

function placement(layout: ShipLayout, cabin: ShipCabin, tangent: number, radial: number, y: number): [number, number, number] {
  const ring = layout.rings[cabin.ring];
  const point = shipPoint(ring.radius + radial, cabinAngle(layout, cabin.slot) + tangent / ring.radius);
  return [point.x, y, point.z];
}

export function ShipCompanions({ layout }: { layout: ShipLayout }) {
  const lounge = layout.cabins.find(cabin => cabin.kind === "lounge" && cabin.deck === 0);
  const maintenance = layout.cabins.find(cabin => cabin.kind === "maintenance" && cabin.deck === 0);
  return <Suspense fallback={null}>
    {lounge ? <>
      <Companion kind="cat" height={.62} position={placement(layout, lounge, -.85, -.25, .09)} rotation={cabinAngle(layout, lounge.slot) + 1.1} />
      <Companion kind="dog" height={.7} position={placement(layout, lounge, .9, -.15, .09)} rotation={cabinAngle(layout, lounge.slot) - 1.1} />
      <Companion kind="bartender" height={1.5} position={placement(layout, lounge, -.65, 2.25, .8)} rotation={cabinAngle(layout, lounge.slot) + Math.PI} />
    </> : null}
    {maintenance ? <Companion kind="drone" height={1.05} position={placement(layout, maintenance, 0, -.6, .65)} rotation={cabinAngle(layout, maintenance.slot)} /> : null}
  </Suspense>;
}
