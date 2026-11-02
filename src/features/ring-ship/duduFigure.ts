import * as THREE from "three";
import type { CompanionState } from "./companionMotion";
import type { DuduInteraction, DuduKind } from "./duduMotion";

export function createDuduFigure(kind: DuduKind) {
  const root = new THREE.Group(), body = new THREE.Group(), head = new THREE.Group();
  root.name = `dudu-figure:${kind}`; root.add(body, head);
  body.position.y = .31; head.position.set(0, .65, .015);
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const sphere = new THREE.SphereGeometry(1, 20, 14); geometries.add(sphere);
  const fluffy = sphere.clone(); geometries.add(fluffy);
  const vertices = fluffy.getAttribute("position");
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
    const puff = 1 + .055 * Math.cos(Math.atan2(y, x) * 9) * (1 - z * z);
    vertices.setXYZ(i, x * puff, y * puff, z);
  }
  fluffy.computeVertexNormals();
  const white = kind === "dumu", color = white ? "#fffdf5" : "#dfb77e";
  const material = (value: string) => { const m = new THREE.MeshStandardMaterial({ color: value, roughness: .9, metalness: 0, emissive: value, emissiveIntensity: .12 }); materials.add(m); return m; };
  const fur = material(color), ink = material("#231d1b"), blush = material("#ef9e9c"), cream = white ? fur : material("#efd5a5");
  const earFur = white ? fur : material("#c9a06b");
  const outline = new THREE.MeshBasicMaterial({ color: "#282421", side: THREE.BackSide }); materials.add(outline);
  function blob(parent: THREE.Object3D, name: string, scale: [number, number, number], at: [number, number, number], surface = fur, edged = true, fluffyShape = false) {
    const part = new THREE.Group(); part.name = name; part.position.set(...at); parent.add(part);
    const geometry = fluffyShape ? fluffy : sphere, mesh = new THREE.Mesh(geometry, surface); mesh.scale.set(...scale); part.add(mesh);
    if (edged) { const edge = new THREE.Mesh(geometry, outline); edge.scale.set(scale[0] + .009, scale[1] + .009, scale[2] + .009); part.add(edge); }
    return part;
  }
  blob(body, "body", [.18, .23, .14], [0, 0, 0], fur, true, white);
  const feet = [-1, 1].map(side => blob(root, `foot:${side}`, [.09, .065, .12], [side * .105, .065, .025]));
  const arms = [-1, 1].map(side => { const arm = new THREE.Group(); arm.position.set(side * .175, .13, .015); body.add(arm); blob(arm, `paw:${side}`, [.065, .14, .065], [0, -.1, 0]); return arm; });
  const tail = new THREE.Group(); tail.position.set(0, .27, -.12); root.add(tail);
  blob(tail, "tail", white ? [.07, .065, .11] : [.065, .07, .16], [0, .02, -.09]);
  blob(head, "head", [.285, .245, .205], [0, 0, 0], fur, true, white);
  const ears = [-1, 1].map(side => {
    const ear = new THREE.Group(); ear.position.set(side * .25, white ? .085 : .015, -.015); head.add(ear);
    blob(ear, `ear:${side}`, white ? [.12, .08, .075] : [.085, .16, .065], [side * .015, white ? .01 : -.08, 0], earFur, true, white); return ear;
  });
  blob(head, "muzzle", [.085, .055, .055], [0, -.045, .2], cream, false);
  const eyes = [-1, 1].map(side => blob(head, `eye:${side}`, [.014, .018, .012], [side * .075, .025, .202], ink, false));
  blob(head, "nose", [.025, .018, .017], [0, -.025, .265], ink, false);
  const smileGeometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(-.055, -.062, .256), new THREE.Vector3(-.035, -.079, .258), new THREE.Vector3(0, -.059, .267),
    new THREE.Vector3(.035, -.079, .258), new THREE.Vector3(.055, -.062, .256),
  ]), 16, .006, 5, false); geometries.add(smileGeometry); head.add(new THREE.Mesh(smileGeometry, ink));
  const mouth = blob(head, "happy-mouth", [.031, .045, .01], [0, -.1, .259], ink, false);
  blob(mouth, "tongue", [.018, .027, .01], [0, -.009, .009], blush, false);
  for (const side of [-1, 1]) blob(head, `blush:${side}`, [.033, .013, .007], [side * .125, -.055, .188], blush, false);
  if (!white) {
    const collar = new THREE.TorusGeometry(.157, .016, 6, 28); geometries.add(collar);
    const mesh = new THREE.Mesh(collar, material("#ee8178")); mesh.rotation.x = Math.PI / 2; mesh.position.y = .44; root.add(mesh);
  }
  return {
    root, bounds: new THREE.Box3(new THREE.Vector3(-.62, -.02, -.65), new THREE.Vector3(.62, 1.3, .65)),
    animate(state: CompanionState, time: number, walking: boolean, interaction?: DuduInteraction, progress = 0) {
      const wave = Math.sin(time * (state.speed > 1 ? 14 : 10)), pulse = Math.sin(Math.min(1, progress) * Math.PI);
      const asleep = !walking && !interaction && state.action === "sleep";
      const tantrum = white && !walking && !interaction && ["stretch", "groom"].includes(state.action);
      const tilt = !white && !walking && !interaction && ["sniff", "sit", "idle"].includes(state.action);
      body.position.set(0, asleep ? .23 : .31, 0); body.rotation.set(asleep ? -.12 : 0, 0, walking ? wave * .045 : 0); body.scale.set(1, 1, 1);
      head.position.set(0, asleep ? .47 : .65, .015); head.rotation.set(0, 0, tilt ? Math.sin(time * 1.1) * .19 : 0); head.scale.setScalar(1);
      root.position.y = walking ? Math.abs(wave) * .035 : tantrum ? Math.abs(Math.sin(time * 13)) * .045 : Math.sin(time * 2) * .005;
      feet.forEach((foot, i) => { foot.position.set((i ? 1 : -1) * .105, .065 + (walking ? Math.max(0, wave * (i ? 1 : -1)) * .06 : tantrum ? Math.max(0, Math.sin(time * 13) * (i ? 1 : -1)) * .035 : 0), .025); foot.rotation.x = walking ? wave * (i ? 1 : -1) * .35 : 0; });
      arms.forEach((arm, i) => { arm.rotation.set(walking ? wave * (i ? -1 : 1) * .4 : 0, 0, (i ? -1 : 1) * (tantrum ? .45 + Math.sin(time * 13) * .2 : .04)); arm.scale.set(1, 1, 1); });
      ears.forEach((ear, i) => { ear.rotation.set(walking ? Math.abs(wave) * -.25 : 0, 0, (i ? -1 : 1) * .2 + (tantrum ? Math.sin(time * 13) * .18 : Math.sin(time * 2.5) * .035)); });
      tail.rotation.set(0, Math.sin(time * (interaction || tantrum ? 15 : walking ? 12 : 5)) * (asleep ? .03 : .6), 0);
      const blink = asleep ? .1 : Math.sin(time * 1.7) > .993 ? .08 : 1;
      eyes.forEach(eye => { eye.scale.y = interaction === "cuddle" ? .25 : blink; });
      mouth.visible = walking || !!interaction || tantrum || (!white && Math.sin(time * .7) > .92);
      if (asleep) { body.scale.y = 1 + Math.sin(time * 2) * .03; head.rotation.z = .16; }
      if (tantrum) head.rotation.y = Math.sin(time * 13) * .13;
      if (interaction === "boop") { head.position.z += pulse * .27; head.rotation.x = pulse * .12; arms.forEach(arm => arm.rotation.x = -pulse * .6); }
      if (interaction === "highFive") {
        const arm = arms[white ? 1 : 0]; arm.rotation.set(-2.05 * pulse, 0, 0); arm.scale.y = 1 + pulse * .8;
        root.position.y += Math.max(0, Math.sin(progress * Math.PI * 4)) * .10; head.rotation.z = (white ? 1 : -1) * pulse * .12;
      }
      if (interaction === "cuddle") {
        const inner = arms[white ? 1 : 0]; inner.rotation.set(-.2 * pulse, 0, (white ? 1 : -1) * 1.4 * pulse); inner.scale.y = 1 + pulse * .65;
        head.position.x += (white ? 1 : -1) * .18 * pulse; head.rotation.z = (white ? -1 : 1) * pulse * .15;
      }
    },
    dispose() { geometries.forEach(geometry => geometry.dispose()); materials.forEach(surface => surface.dispose()); },
  };
}

export function duduHeartGeometry() {
  const heart = new THREE.Shape(); heart.moveTo(0, -.13);
  heart.bezierCurveTo(-.24, .005, -.13, .19, 0, .08); heart.bezierCurveTo(.13, .19, .24, .005, 0, -.13);
  return new THREE.ShapeGeometry(heart, 12);
}
