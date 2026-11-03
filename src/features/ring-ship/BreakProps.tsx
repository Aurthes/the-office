"use client";
import { useRef, type RefObject } from "react";
import { createPortal, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { createDuckCrewFigure } from "./duckCrewFigure";
import type { BreakPoseState } from "./breakPose";

export function BreakProps({ figure, stateRef }: { figure: ReturnType<typeof createDuckCrewFigure>; stateRef: RefObject<BreakPoseState> }) {
  const cup = useRef<THREE.Group>(null), biscuit = useRef<THREE.Group>(null);
  const mug = useRef<THREE.MeshStandardMaterial>(null), tag = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const { action } = stateRef.current;
    if (cup.current) {
      cup.current.visible = !!action && action !== "snack";
      cup.current.quaternion.copy(figure.wings[0].quaternion).invert();
    }
    if (biscuit.current) biscuit.current.visible = action === "snack";
    if (mug.current) mug.current.color.set(action === "tea" ? "#a9c098" : "#e7c58e");
    if (tag.current) tag.current.visible = action === "tea";
  });
  return createPortal(<group>
    <group ref={cup} name="break-mug" position={[0, -.1, .025]} visible={false}>
      <mesh><cylinderGeometry args={[.055, .043, .105, 12]} /><meshStandardMaterial ref={mug} color="#e7c58e" /></mesh>
      <mesh position={[0, .054, 0]}><cylinderGeometry args={[.045, .045, .004, 12]} /><meshStandardMaterial color="#78502d" /></mesh>
      <mesh position={[.057, 0, 0]}><torusGeometry args={[.03, .008, 5, 12]} /><meshStandardMaterial color="#e7c58e" /></mesh>
      <mesh ref={tag} position={[.025, -.012, .055]}><boxGeometry args={[.023, .033, .004]} /><meshStandardMaterial color="#eee2bd" /></mesh>
    </group>
    <group ref={biscuit} name="break-biscuit" position={[0, -.11, .025]} visible={false}>
      <mesh><boxGeometry args={[.09, .025, .09]} /><meshStandardMaterial color="#d3a161" /></mesh>
      {[-.022, .022].map(x => <mesh key={x} position={[x, .015, 0]}><sphereGeometry args={[.008, 5, 4]} /><meshStandardMaterial color="#714d35" /></mesh>)}
    </group>
  </group>, figure.wings[0]);
}
