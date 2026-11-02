"use client";
import { Canvas, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, OrthographicCamera } from "@react-three/drei";
import * as THREE from "three";
import type { DuckAppearance } from "@/lib/avatars/duck";
import { useUiText } from "@/lib/i18n/ui-language";
import { useDuckFigure } from "./useDuckFigure";

function Figure({ appearance, face, top, back }: { appearance: DuckAppearance; face: boolean; top?: boolean; back?: boolean }) {
  const figure = useDuckFigure(appearance);
  const { size } = useThree();
  const view = top ? "top" : face ? "face" : back ? "back" : "body";
  const breadth = Math.max(appearance.bodyWidth, appearance.bodyDepth);
  const zoom = Math.min(size.width / ((face ? .58 * appearance.headScale : .95) * breadth), size.height / (top ? .85 * breadth : (face ? .52 : 1) * appearance.bodyHeight));
  return <>
    <OrthographicCamera key={`camera:${view}`} makeDefault position={top ? [0, 2.8, .001] : [back ? -.9 : .9, .65 * appearance.bodyHeight, back ? -2.4 : 2.4]} near={.01} far={50} zoom={zoom} />
    <primitive object={figure.root} dispose={null} />
    <mesh position={[0, .002, 0]}><cylinderGeometry args={[.28, .3, .016, 48]} /><meshStandardMaterial color="#35434b" roughness={.65} metalness={.35} /></mesh>
    <OrbitControls key={`orbit:${view}`} makeDefault enablePan={false} enableDamping={false} minZoom={80} maxZoom={1600}
      minPolarAngle={top ? 0 : .25} maxPolarAngle={Math.PI * .7} target={[0, (face ? .51 : .35) * appearance.bodyHeight, 0]} />
  </>;
}

export function DuckCharacterPreview({ appearance, face, top, back }: { appearance: DuckAppearance; face: boolean; top?: boolean; back?: boolean }) {
  const t = useUiText();
  return <Canvas orthographic frameloop="demand" dpr={[1, 1.5]} camera={{ position: [.9, .65, 2.4], zoom: 400, near: .01, far: 50 }}
    fallback={<p role="alert">{t("3D preview requires WebGL.")}</p>}
    gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
    onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = .95; gl.domElement.dataset.characterReady = "true"; }}>
    <Environment resolution={64} frames={1} environmentIntensity={.4}>
      <Lightformer intensity={2} position={[-2, 3, 3]} scale={[3, 3, 1]} />
    </Environment>
    <hemisphereLight args={["#e6efe8", "#6c6960", 1.2]} />
    <directionalLight position={[-2, 4, 5]} intensity={2.8} color="#fff1d6" />
    <directionalLight position={[3, 1, -1]} intensity={.8} color="#afc7df" />
    <Figure appearance={appearance} face={face} top={top} back={back} />
  </Canvas>;
}
