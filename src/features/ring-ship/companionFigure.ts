import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { createBartenderRig } from "./bartenderRig";
import type { CompanionKind, CompanionState } from "./companionMotion";

export function createCompanionFigure(source: GLTF, kind: CompanionKind, height: number) {
  const scene = clone(source.scene);
  const rig = kind === "bartender" ? createBartenderRig(scene, height) : undefined;
  let normalized: THREE.Group;
  if (rig) normalized = rig.group;
  else {
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(scene), center = bounds.getCenter(new THREE.Vector3());
    const scale = height / Math.max(bounds.getSize(new THREE.Vector3()).y, .01);
    normalized = new THREE.Group(); normalized.scale.setScalar(scale);
    normalized.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale); normalized.add(scene);
    scene.traverse(object => { if (object instanceof THREE.Mesh) { object.receiveShadow = true; object.castShadow = kind === "cat" || kind === "dog"; } });
  }
  normalized.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(normalized).expandByScalar(.06), mixer = new THREE.AnimationMixer(scene);
  const actions = new Map(source.animations.map(clip => [clip.name, mixer.clipAction(clip)]));
  let current: THREE.AnimationAction | undefined, fading: THREE.AnimationAction | undefined, fadeRemaining = 0;
  const pets = ["body", "tail", "leg-back-left", "leg-back-right", "leg-front-left", "leg-front-right"].flatMap(name => { const node = scene.getObjectByName(name); return node ? [node] : []; });
  const claws = ["ArmL1_01", "ArmR1_07", "PinceR_03", "PinceL_09"].flatMap(name => { const node = scene.getObjectByName(name); return node ? [node] : []; });
  const modified = [...pets, ...claws].map(node => ({ node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() }));
  const fires: THREE.Object3D[] = []; scene.traverse(node => { if (/^Fire/.test(node.name)) fires.push(node); });
  const pose = { sleep: 0, sit: 0, stretch: 0 };
  const skeletons = new Set<THREE.Skeleton>(); scene.traverse(node => { if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton); });
  return {
    normalized, bounds, rig, pose,
    animate(state: CompanionState, delta: number) {
      // Restore the previous authored pose before applying additive gestures.
      // Constant animation tracks may otherwise leave the last gesture in place.
      for (const rest of modified) { rest.node.position.copy(rest.position); rest.node.quaternion.copy(rest.quaternion); rest.node.scale.copy(rest.scale); }
      const moving = !!state.route.length;
      const clip = kind === "drone" ? source.animations[0]?.name
        : moving ? state.action === "run" ? "run" : "walk" : state.action === "sniff" || state.action === "groom" ? "eat" : "idle";
      const next = clip ? actions.get(clip) : undefined;
      if (next !== current) {
        fading?.stop(); fading = current; fading?.fadeOut(.22);
        next?.reset().fadeIn(.22).play(); current = next; fadeRemaining = .25;
      }
      if (current) current.timeScale = moving ? state.speed / (state.action === "run" ? 1.5 : .65) : kind === "drone" && state.action === "charge" ? .15 : 1;
      mixer.update(delta);
      if (fading && (fadeRemaining -= delta) <= 0) { fading.stop(); fading = undefined; }
      for (const rest of modified) { rest.position.copy(rest.node.position); rest.quaternion.copy(rest.node.quaternion); rest.scale.copy(rest.node.scale); }
      const rate = 1 - Math.exp(-delta * 5);
      pose.sleep += ((state.action === "sleep" && !moving ? 1 : 0) - pose.sleep) * rate;
      pose.sit += ((state.action === "sit" && !moving ? 1 : 0) - pose.sit) * rate;
      pose.stretch += ((state.action === "stretch" && !moving ? Math.sin(Math.min(1, state.time / state.duration) * Math.PI) : 0) - pose.stretch) * rate;
      const body = pets.find(node => node.name === "body");
      if (body) {
        body.position.y -= pose.sleep * .22 + pose.sit * .09;
        body.rotation.x += pose.stretch * .2 - pose.sit * .2;
        body.scale.y *= 1 - .12 * pose.sleep + Math.sin(state.time * 1.7) * .015 * pose.sleep;
        body.scale.z *= 1 + pose.stretch * .13;
      }
      for (const leg of pets.filter(node => node.name.startsWith("leg-"))) {
        const front = leg.name.includes("front");
        leg.rotation.x += (front ? 1.15 : -1.15) * pose.sleep + (front ? -.55 : .15) * pose.stretch + (front ? 0 : .9) * pose.sit;
        leg.position.y -= pose.sleep * .16;
        if (front) leg.position.z += pose.stretch * .12;
      }
      const tail = pets.find(node => node.name === "tail");
      if (tail) tail.rotation.z += Math.sin(state.time * 3) * .16 * (1 - pose.sleep);
      if (kind === "drone") {
        const working = !moving && (state.action === "repair" || state.action === "scan");
        for (const [i, claw] of claws.entries()) if (working) claw.rotateX(Math.sin(state.time * (state.action === "repair" ? 5 : 1.4) + i) * .17);
        for (const fire of fires) fire.visible = state.action !== "charge" || moving;
      }
    },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(scene); rig?.dispose(); skeletons.forEach(skeleton => skeleton.dispose()); },
  };
}
