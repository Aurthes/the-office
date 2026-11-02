import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { normalizeDuckAppearance, type DuckAppearance } from "@/lib/avatars/duck";
import { createDuckCrewFigure } from "./duckCrewFigure";
import type { KirbyState } from "./kirbyMotion";

function paintFace(canvas: HTMLCanvasElement, phase: KirbyState["phase"], time: number) {
  const context = canvas.getContext("2d")!, size = canvas.width;
  context.save(); context.clearRect(0, 0, size, size); context.scale(size, size);
  // Match the authored face UVs, whose image is upside down.
  context.translate(0, 1); context.scale(1, -1);
  context.fillStyle = "#f598b0"; context.fillRect(0, 0, 1, 1);
  const blink = time % 3.7 < .13, eyesY = .37;
  for (const x of [.415, .635]) {
    context.fillStyle = "#171521"; context.beginPath(); context.ellipse(x, eyesY, .055, blink ? .012 : .15, 0, 0, Math.PI * 2); context.fill();
    if (!blink) {
      context.fillStyle = "#176ca4"; context.beginPath(); context.ellipse(x, eyesY + .07, .037, .055, 0, 0, Math.PI * 2); context.fill();
      context.fillStyle = "white"; context.beginPath(); context.ellipse(x - .008, eyesY - .065, .029, .052, 0, 0, Math.PI * 2); context.fill();
    }
  }
  for (const x of [.27, .78]) { context.fillStyle = "#ed6e91"; context.beginPath(); context.ellipse(x, .5, .075, .04, 0, 0, Math.PI * 2); context.fill(); }
  const open = phase === "inhale" || phase === "spit";
  context.fillStyle = "#461a33"; context.strokeStyle = "#8f3458"; context.lineWidth = .012;
  context.beginPath();
  if (open) {
    context.ellipse(.525, .66, phase === "inhale" ? .13 : .10, phase === "inhale" ? .17 : .115, 0, 0, Math.PI * 2); context.fill();
    context.fillStyle = "#c65c82"; context.beginPath(); context.ellipse(.525, .75, .07, .025, 0, 0, Math.PI * 2); context.fill();
  } else if (phase === "holding") {
    context.moveTo(.48, .65); context.quadraticCurveTo(.525, .62, .57, .65); context.stroke();
  } else {
    context.moveTo(.48, .63); context.quadraticCurveTo(.525, .70, .57, .63); context.stroke();
  }
  context.restore();
}

// Keep the downloaded Kirby mesh and skeleton. Only this instance's materials,
// face texture and procedural poses change; cached source assets stay untouched.
export function createKirbyFigure(source: GLTF, makeCanvas = () => document.createElement("canvas")) {
  const scene = clone(source.scene), root = new THREE.Group(), pose = new THREE.Group(), normalized = new THREE.Group();
  scene.updateMatrixWorld(true);
  const sourceBounds = new THREE.Box3().setFromObject(scene), center = sourceBounds.getCenter(new THREE.Vector3());
  const scale = 1.2 / sourceBounds.getSize(new THREE.Vector3()).y;
  normalized.scale.setScalar(scale); normalized.position.set(-center.x * scale, -sourceBounds.min.y * scale, -center.z * scale);
  root.add(pose); pose.add(normalized); normalized.add(scene);
  const canvas = makeCanvas(); canvas.width = canvas.height = 256;
  const faceTexture = new THREE.CanvasTexture(canvas); faceTexture.flipY = false; faceTexture.colorSpace = THREE.SRGBColorSpace;
  const bodyColor = { value: new THREE.Color("#f598b0") }, feetColor = { value: new THREE.Color("#c83a65") }, copied = { value: 0 };
  const materials = new Set<THREE.MeshStandardMaterial>(), skeletons = new Set<THREE.Skeleton>();
  const bones: Array<{ bone: THREE.Bone; quaternion: THREE.Quaternion }> = [];
  scene.traverse(node => {
    if (node instanceof THREE.Bone) bones.push({ bone: node, quaternion: node.quaternion.clone() });
    if (!(node instanceof THREE.Mesh)) return;
    if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton);
    node.castShadow = node.receiveShadow = true;
    const material = (node.material as THREE.MeshStandardMaterial).clone();
    const footJoints = node instanceof THREE.SkinnedMesh ? node.skeleton.bones.flatMap((bone, index) => /Foot/.test(bone.name) ? [index] : []) : [];
    const footWeight = footJoints.map(index => `dot(vec4(1.0) - step(vec4(0.5), abs(skinIndex - vec4(${index.toFixed(1)}))), skinWeight)`).join(" + ") || "0.0";
    if (material.name === "Kirby-Face") material.map = faceTexture;
    material.roughness = .86; material.metalness = 0;
    material.onBeforeCompile = shader => {
      shader.uniforms.kirbyBody = bodyColor; shader.uniforms.kirbyFeet = feetColor; shader.uniforms.kirbyCopied = copied;
      shader.vertexShader = "varying float vKirbyFoot;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <skinbase_vertex>", `#include <skinbase_vertex>
        vKirbyFoot = 0.0;
        #ifdef USE_SKINNING
          vKirbyFoot = ${footWeight};
        #endif`);
      shader.fragmentShader = "uniform vec3 kirbyBody; uniform vec3 kirbyFeet; uniform float kirbyCopied; varying float vKirbyFoot;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
        float pinkSkin = step(0.04, diffuseColor.r) * step(diffuseColor.g * 1.08, diffuseColor.r) * step(diffuseColor.g * 1.08, diffuseColor.b);
        vec3 copiedColor = mix(kirbyBody, kirbyFeet, clamp(vKirbyFoot, 0.0, 1.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, copiedColor, pinkSkin * kirbyCopied);`);
    };
    material.customProgramCacheKey = () => `kirby-crew-copy-v2:${footJoints.join(",")}`;
    materials.add(material); node.material = material;
  });
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root).expandByScalar(.06);
  // A box diagonal includes empty corners around the outstretched arms. Use
  // the occupied footprint, with room for the inflated pose and clearance.
  skeletons.forEach(skeleton => skeleton.update());
  let footprint = 0;
  const vertex = new THREE.Vector3();
  scene.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    for (let i = 0; i < node.geometry.getAttribute("position").count; i++) {
      node.getVertexPosition(i, vertex); node.localToWorld(vertex);
      footprint = Math.max(footprint, Math.hypot(vertex.x, vertex.z));
    }
  });
  const radius = footprint * 1.13 + .06;
  let equipment: ReturnType<typeof createDuckCrewFigure> | null = null, appearanceKey = "", faceTick = "";
  const setAppearance = (appearance: DuckAppearance | null) => {
    const key = appearance ? JSON.stringify(appearance) : "";
    if (key === appearanceKey) return;
    appearanceKey = key;
    if (equipment) { root.remove(equipment.root); equipment.dispose(); equipment = null; }
    copied.value = appearance ? 1 : 0;
    if (!appearance) return;
    const style = normalizeDuckAppearance(appearance);
    bodyColor.value.set(style.featherColor); feetColor.value.set(style.footColor || style.billColor);
    // Reuse the employee's actual hats, glasses, uniform and backpack geometry.
    equipment = createDuckCrewFigure(style);
    equipment.root.traverse(node => {
      if (node instanceof THREE.Mesh) node.visible = (node.material as THREE.Material).name === "crew-equipment";
    });
    equipment.root.scale.set(3.1, 1.8, 4.0);
    const face = equipment.root.getObjectByName("face"); if (face) face.scale.z = .75;
    equipment.root.name = "kirby-copied-equipment"; root.add(equipment.root);
  };
  return { root, bounds, radius, bodyColor, copied,
    animate(state: KirbyState, time: number) {
      const actor = state.actor, walking = actor.route.length > 0 || state.phase === "approach";
      const holding = state.phase === "holding", inhaling = state.phase === "inhale", spitting = state.phase === "spit";
      setAppearance((holding || spitting) && state.victim ? state.victim.appearance : null);
      const step = Math.sin(time * 10), playful = state.phase === "wander" && !walking;
      const hop = playful && actor.action === "stretch" ? Math.max(0, Math.sin(actor.time * 5)) * .16 : 0;
      pose.position.y = hop + (walking ? Math.abs(step) * .045 : 0);
      pose.rotation.z = walking ? step * .065 : holding ? Math.sin(time * 13) * .045 : Math.sin(time * 2) * .035;
      pose.rotation.y = playful && actor.action === "groom" ? Math.sin(actor.time * 1.8) * .75 : 0;
      const inflate = holding ? .13 + Math.sin(time * 11) * .015 : inhaling ? .07 : spitting ? -.06 : 0;
      pose.scale.set(1 + inflate, 1 - inflate * .25, 1 + inflate);
      for (const { bone, quaternion } of bones) {
        bone.quaternion.copy(quaternion);
        if (/Foot/.test(bone.name) && walking) bone.rotateX(step * (bone.name.includes("R") ? 1 : -1) * .22);
        if (/Arm/.test(bone.name)) bone.rotateZ(inhaling ? -.18 : holding ? Math.sin(time * 9) * .09 : playful ? Math.sin(time * 3) * .22 : step * .12);
      }
      const tick = `${state.phase}:${Math.floor(time * 10)}`;
      if (faceTick !== tick) { paintFace(canvas, state.phase, time); faceTexture.needsUpdate = true; faceTick = tick; }
    },
    dispose() { equipment?.dispose(); faceTexture.dispose(); materials.forEach(material => material.dispose()); skeletons.forEach(skeleton => skeleton.dispose()); },
  };
}
