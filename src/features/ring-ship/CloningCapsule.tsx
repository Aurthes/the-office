import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { CLONING_POD, CLONING_STEPS } from "./cloningGeometry";

// The same capsule footprint as the old bed; its hinge lifts the canopy away
// from the passenger instead of swinging it through the mattress.
export function capsuleCanopyGeometry() {
  const shape = new THREE.CapsuleGeometry(.85, 1.35, 10, 32).rotateX(Math.PI / 2).scale(1, .76, 1);
  const positions = shape.getAttribute("position"), indices = shape.index!;
  const top: number[] = [];
  for (let i = 0; i < indices.count; i += 3) {
    const triangle = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
    if (triangle.every(v => positions.getY(v) >= -1e-6)) top.push(...triangle);
  }
  shape.setIndex(top); shape.translate(0, 0, -1.3); return shape;
}
function rimGeometry() {
  const points: THREE.Vector3[] = [];
  for (let side = 0; side < 2; side++) for (let i = 0; i <= 32; i++) {
    const angle = side * Math.PI + i / 32 * Math.PI;
    points.push(new THREE.Vector3(.85 * Math.cos(angle), 0, (side ? -.675 : .675) + .85 * Math.sin(angle) - 1.3));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true), 96, .035, 6, true);
}
export function CloningCapsule({ index, accent, door }: { index: number; accent: string; door: (node: THREE.Group | null) => void }) {
  const canopy = useMemo(() => capsuleCanopyGeometry(), []), rim = useMemo(() => rimGeometry(), []);
  useEffect(() => () => { canopy.dispose(); rim.dispose(); }, [canopy, rim]);
  return <>
    <mesh position={[0, .28, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, .27]}>
      <capsuleGeometry args={[CLONING_POD.width / 2, CLONING_POD.length - CLONING_POD.width, 10, 32]} />
      <meshStandardMaterial color="#405c6b" metalness={.45} roughness={.4} />
    </mesh>
    <mesh position={[0, .51, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, .09]}>
      <capsuleGeometry args={[.86, 1.35, 8, 32]} /><meshStandardMaterial color="#78909b" metalness={.55} roughness={.36} />
    </mesh>
    <mesh position={[0, .59, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, .075]}>
      <capsuleGeometry args={[.75, 1.34, 8, 32]} /><meshStandardMaterial color="#718f8b" roughness={.9} />
    </mesh>
    <mesh position={[0, .67, .65]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, .12]}>
      <capsuleGeometry args={[.4, .2, 6, 24]} /><meshStandardMaterial color="#91afa6" roughness={.95} />
    </mesh>
    {[-1, 1].map(side => <group key={side}>
      <mesh position={[side * .93, .33, 0]}><boxGeometry args={[.025, .055, 1.28]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.4} /></mesh>
      {[-.65, .65].map(z => <mesh key={z} position={[side * .58, .12, z]}><cylinderGeometry args={[.17, .22, .24, 12]} /><meshStandardMaterial color="#233a46" metalness={.4} roughness={.5} /></mesh>)}
      <mesh position={[side * .72, .71, 1.3]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.09, .09, .22, 16]} /><meshStandardMaterial color="#b3c5c9" metalness={.7} roughness={.3} /></mesh>
    </group>)}
    {CLONING_STEPS.map((step, i) => <mesh key={step.v} position={[0, step.y, step.v]}><boxGeometry args={[step.width, step.height, step.length]} /><meshStandardMaterial color={i ? "#4f6975" : "#718b95"} roughness={.7} /></mesh>)}
    <mesh position={[0, .61, -1.47]} rotation={[-.4, 0, 0]}><boxGeometry args={[.64, .16, .08]} /><meshStandardMaterial color="#183240" metalness={.4} roughness={.5} /></mesh>
    <mesh position={[0, .65, -1.51]} rotation={[-.4, 0, 0]}><boxGeometry args={[.47, .055, .015]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={.8} /></mesh>
    <group ref={door} position={[0, .72, 1.3]} name={`cloning-canopy:${index}`}>
      <mesh geometry={canopy}><meshPhysicalMaterial color="#9cdbdc" transparent opacity={.12} roughness={.12} metalness={.05} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <mesh geometry={rim}><meshStandardMaterial color="#91adb7" metalness={.65} roughness={.32} /></mesh>
      {[-.675, .675].map(z => <mesh key={z} position={[0, 0, z - 1.3]} scale={[1, .76, 1]}><torusGeometry args={[.85, .018, 6, 32, Math.PI]} /><meshStandardMaterial color="#799ca8" metalness={.6} roughness={.4} /></mesh>)}
    </group>
  </>;
}
