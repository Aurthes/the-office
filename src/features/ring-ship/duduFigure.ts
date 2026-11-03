import * as THREE from "three";
import type { CompanionState } from "./companionMotion";
import type { DuduInteraction, DuduKind } from "./duduMotion";
import bodyData from "./duduBody.generated.json";

export type DuduPosture = "upright" | "quadruped";

export function createDuduFigure(kind: DuduKind) {
  const white = kind === "dumu";
  // Uneven arcs from the drawn character: broad cheeks, small temple tufts and
  // long quiet stretches. Fade toward the face so this never becomes a rosette.
  const contourArcs = [
    [-2.72, .25, 1.1], [-1.63, .16, .35], [-.81, .14, .75], [-.20, .18, 1],
    [.54, .12, .32], [1.42, .25, .55], [2.00, .09, .35], [2.92, .12, .85],
    [-3.07, .09, -.23], [.14, .11, -.25], [1.83, .10, -.18],
  ];
  const root = new THREE.Group(); root.name = `dudu-figure:${kind}`;
  const joints = bodyData.joints.map(joint => {
    const bone = new THREE.Bone(); bone.name = joint.name; bone.position.fromArray(joint.position); root.add(bone); return bone;
  });
  const [body, head] = joints, arms = joints.slice(2, 4), feet = joints.slice(4, 6);
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const sphere = new THREE.SphereGeometry(1, 24, 16); geometries.add(sphere);
  const smallSphere = new THREE.SphereGeometry(1, 12, 8); geometries.add(smallSphere);
  // Maltese's fluff is a rounded, scalloped silhouette, not strands or surface noise.
  const fur = new THREE.MeshStandardMaterial({ color: white ? "#fffdf8" : "#f7c56d", roughness: .9, metalness: 0 });
  const ink = new THREE.MeshBasicMaterial({ color: "#16110f" });
  const pink = new THREE.MeshStandardMaterial({ color: "#ee777a", roughness: .9 });
  const red = new THREE.MeshStandardMaterial({ color: "#e94e35", roughness: .72 });
  [fur, ink, pink, red].forEach(surface => materials.add(surface));
  const skin = new THREE.BufferGeometry(); geometries.add(skin);
  for (const [name, values, size] of [["position", bodyData.position, 3], ["normal", bodyData.normal, 3], ["uv", bodyData.uv, 2], ["skinWeight", bodyData.skinWeight, 4]] as const)
    skin.setAttribute(name, new THREE.Float32BufferAttribute(values, size));
  skin.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(bodyData.skinIndex, 4)); skin.setIndex(bodyData.index);
  if (white) scallop(skin, new THREE.Vector3(0, .245, 0), new THREE.Vector3(.21, .175, .155), .030, true);
  const coat = new THREE.SkinnedMesh(skin, fur); coat.name = "sculpted-body"; coat.castShadow = coat.receiveShadow = true; coat.frustumCulled = false;
  root.add(coat); root.updateMatrixWorld(true); const skeleton = new THREE.Skeleton(joints); coat.bind(skeleton);
  function blob(parent: THREE.Object3D, name: string, scale: [number, number, number], at: [number, number, number], surface: THREE.Material = fur, geometry = sphere) {
    const part = new THREE.Group(); part.name = name; part.position.set(...at); parent.add(part);
    const mesh = new THREE.Mesh(geometry, surface); mesh.scale.set(...scale); mesh.castShadow = surface === fur; mesh.receiveShadow = true; part.add(mesh); return part;
  }
  const signedPower = (value: number, power: number) => Math.sign(value) * Math.abs(value) ** power;
  function smoothNormals(geometry: THREE.BufferGeometry) {
    geometry.computeVertexNormals();
    const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
    const groups = new Map<string, number[]>();
    for (let i = 0; i < positions.count; i++) {
      const key = [positions.getX(i), positions.getY(i), positions.getZ(i)].map(v => Math.round(v * 1e5)).join(",");
      const group = groups.get(key); if (group) group.push(i); else groups.set(key, [i]);
    }
    for (const group of groups.values()) {
      const normal = new THREE.Vector3();
      for (const i of group) normal.add(new THREE.Vector3(normals.getX(i), normals.getY(i), normals.getZ(i)));
      normal.normalize(); for (const i of group) normals.setXYZ(i, normal.x, normal.y, normal.z);
    }
  }
  function contourScale(x: number, y: number, amount: number) {
    const angle = Math.atan2(y, x);
    let rise = 0;
    for (const [center, width, height] of contourArcs) {
      const offset = Math.atan2(Math.sin(angle - center), Math.cos(angle - center));
      rise += height * Math.exp(-.5 * (offset / width) ** 2);
    }
    return 1 + amount * rise * THREE.MathUtils.smoothstep(Math.hypot(x, y), .55, 1);
  }
  function scallop(geometry: THREE.BufferGeometry, center: THREE.Vector3, size: THREE.Vector3, amount: number, torso = false) {
    const positions = geometry.getAttribute("position"), indices = geometry.getAttribute("skinIndex"), weights = geometry.getAttribute("skinWeight");
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i) - center.x, y = positions.getY(i) - center.y;
      let support = 1;
      if (torso) { support = 0; for (let j = 0; j < 4; j++) if (indices.getComponent(i, j) === 0) support += weights.getComponent(i, j); }
      const scale = contourScale(x / size.x, y / size.y, amount * support);
      positions.setXYZ(i, center.x + x * scale, center.y + y * scale, positions.getZ(i));
    }
    smoothNormals(geometry);
  }
  const neck = blob(root, "neck", [1, 1, 1], [0, .42, 0]);
  const shoulder = new THREE.Vector3(), throat = new THREE.Vector3(), link = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const headSize = new THREE.Vector3(white ? .30 : .34, white ? .255 : .275, white ? .275 : .29);
  const faceWidth = white ? .94 : 1.04;
  const lowerPower = white ? .79 : .87, upperPower = white ? .96 : 1.06, horizontalPower = .88;
  const headGeometry = new THREE.SphereGeometry(1, white ? 64 : 48, white ? 64 : 32); geometries.add(headGeometry);
  const points = headGeometry.getAttribute("position");
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i), y = points.getY(i), z = points.getZ(i);
    points.setXYZ(i, signedPower(x, horizontalPower) * headSize.x * (1 - .10 * Math.max(0, y)), signedPower(y, y >= 0 ? upperPower : lowerPower) * headSize.y, signedPower(z, horizontalPower) * headSize.z);
  }
  smoothNormals(headGeometry);
  if (white) scallop(headGeometry, new THREE.Vector3(), headSize, .080);
  blob(head, "round-head", [1, 1, 1], [0, 0, 0], fur, headGeometry);
  const earGeometry = sphere.clone(); geometries.add(earGeometry);
  const earPoints = earGeometry.getAttribute("position");
  for (let i = 0; i < earPoints.count; i++) {
    const x = earPoints.getX(i), y = earPoints.getY(i), z = earPoints.getZ(i);
    const cup = white && z > 0 ? Math.min(z * .8, .45 * Math.exp(-3 * x * x - 3 * (y - .05) ** 2)) : 0;
    earPoints.setXYZ(i, x * (1 - (white ? .24 : .12) * y), y,
      white ? z * (1 - .12 * y) - cup : z + .2 * Math.max(0, -y) ** 2);
  }
  smoothNormals(earGeometry);
  const ears = [-1, 1].map(side => {
    const ear = new THREE.Group(); ear.name = `ear:${side}`; head.add(ear);
    const scale: [number, number, number] = white ? [.085, .105, .088] : [.10, .125, .105];
    blob(ear, "soft-ear", scale, white ? [0, .035, 0] : [side * .025, -.065, 0], fur, earGeometry);
    return ear;
  });
  const tail = new THREE.Group(); tail.name = "tail"; root.add(tail);
  const tailSocket = new THREE.Vector3();
  const tailCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, .035, -.10), new THREE.Vector3(0, .12, white ? -.15 : -.17)]);
  const tailGeometry = new THREE.TubeGeometry(tailCurve, 16, .05, 8, false); geometries.add(tailGeometry);
  const tailMesh = new THREE.Mesh(tailGeometry, fur); tailMesh.castShadow = true; tail.add(tailMesh);
  const tip = tailCurve.getPoint(1); blob(tail, "tail-tip", [.05, .05, .05], [tip.x, tip.y, tip.z]);

  // Follow the curved face so the printed features stay attached from every angle.
  function faceZ(x: number, y: number) {
    const scale = white ? contourScale(x / headSize.x, y / headSize.y, .080) : 1; x /= scale; y /= scale;
    const rawY = signedPower(y / headSize.y, 1 / (y >= 0 ? upperPower : lowerPower));
    const rawX = signedPower(x / (headSize.x * (1 - .10 * Math.max(0, rawY))), 1 / horizontalPower);
    return Math.max(0, 1 - rawX * rawX - rawY * rawY) ** (horizontalPower / 2) * headSize.z;
  }
  function feature(name: string, x: number, y: number, scale: [number, number, number]) {
    x *= faceWidth;
    const part = blob(head, name, scale, [x, y, faceZ(x, y) + .001], ink, smallSphere);
    const step = .001, normal = new THREE.Vector3(-(faceZ(x + step, y) - faceZ(x - step, y)) / (step * 2), -(faceZ(x, y + step) - faceZ(x, y - step)) / (step * 2), 1).normalize();
    part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal); return part;
  }
  const eyeSize = white ? .015 : .016;
  const eyes = [-1, 1].map(side => feature(`eye:${side}`, side * .10, .035, [eyeSize, eyeSize, .0015]));
  feature("nose", 0, white ? .031 : .023, [white ? .025 : .031, white ? .020 : .023, .002]);
  function stroke(coordinates: number[][], radius: number) {
    const curve = new THREE.CatmullRomCurve3(coordinates.map(([x, y]) => new THREE.Vector3(x * faceWidth, y, 0)));
    const vertices: number[] = [], triangles: number[] = [];
    for (let i = 0; i <= 32; i++) {
      const point = curve.getPoint(i / 32), tangent = curve.getTangent(i / 32);
      for (const side of [-1, 1]) {
        const x = point.x - tangent.y * radius * side, y = point.y + tangent.x * radius * side;
        vertices.push(x, y, faceZ(x, y) + .0015);
      }
      if (i < 32) { const a = i * 2; triangles.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex(triangles);
    geometries.add(geometry); head.add(new THREE.Mesh(geometry, ink));
  }
  const mouthRise = white ? .018 : .012, strokeWidth = white ? .013 : .014;
  stroke([[0, .016], [0, -.004], [0, -.040 + mouthRise]], white ? .015 : .0155);
  stroke([[-.102, -.041], [-.085, -.062], [-.052, -.065], [-.024, -.057], [0, -.040], [.024, -.057], [.052, -.065], [.085, -.062], [.102, -.041]].map(([x, y]) => [x, y + mouthRise]), strokeWidth);
  for (const side of [-1, 1]) feature(`smile-tip:${side}`, side * .102, -.041 + mouthRise, [strokeWidth, strokeWidth, .0015]);
  const mouth = blob(head, "happy-mouth", [.031, .045, .006], [0, -.077, faceZ(0, -.077) + .002], ink, smallSphere);
  blob(mouth, "tongue", [.019, .027, .004], [0, -.011, .006], pink, smallSphere);
  if (!white) {
    // Follow the lower head surface so the collar stays visible in both poses.
    const y = -headSize.y * .86, rawY = signedPower(y / headSize.y, 1 / lowerPower);
    const section = (1 - rawY * rawY) ** (horizontalPower / 2);
    const ring = Array.from({ length: 48 }, (_, i) => {
      const angle = i / 48 * Math.PI * 2;
      return new THREE.Vector3(signedPower(Math.cos(angle), horizontalPower) * (headSize.x * section + .004), y,
        signedPower(Math.sin(angle), horizontalPower) * (headSize.z * section + .004));
    });
    const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring, true), 64, .010, 8, true); geometries.add(geometry);
    const collar = new THREE.Mesh(geometry, red); collar.name = "red-collar"; head.add(collar);
  }
  let stance = 0, lastTime: number | undefined;
  return {
    root, bounds: new THREE.Box3(new THREE.Vector3(-.62, -.02, -.65), new THREE.Vector3(.62, 1.3, .68)),
    animate(state: CompanionState, time: number, walking: boolean, interaction?: DuduInteraction, progress = 0, posture?: DuduPosture) {
      const asleep = !walking && !interaction && state.action === "sleep";
      const sniffing = !walking && !interaction && state.action === "sniff";
      const tantrum = white && !walking && !interaction && ["stretch", "groom"].includes(state.action);
      const seated = !walking && !interaction && state.action === "sit";
      const desired = posture ? Number(posture === "quadruped") : Number(!interaction && (asleep || sniffing || (walking && Math.sin(time * .16 + (white ? 0 : 1)) > -.35)));
      stance = lastTime === undefined || time < lastTime ? desired : THREE.MathUtils.damp(stance, desired, 7, Math.min(.05, time - lastTime)); lastTime = time;
      const wave = Math.sin(time * (state.speed > 1 ? 13 : 10)), pulse = Math.sin(Math.min(1, progress) * Math.PI), mix = THREE.MathUtils.lerp;
      body.position.set(0, asleep ? .245 : seated ? .25 : mix(.27, .305, stance), mix(0, -.045, stance));
      body.rotation.set(stance * Math.PI / 2, 0, walking ? wave * .025 : 0); body.scale.set(1, mix(1, 1.6, stance) * (asleep ? .92 + Math.sin(time * 2) * .025 : 1), 1.2);
      head.position.set(0, asleep ? .40 : seated ? .60 : mix(.62, white ? .53 : .55, stance), mix(.02, .23, stance));
      head.rotation.set(sniffing ? .13 + Math.sin(time * 3) * .06 : 0, tantrum ? Math.sin(time * 13) * .10 : 0, !white && !walking && !interaction ? Math.sin(time * 1.1) * .09 : 0);
      root.position.y = walking ? Math.abs(wave) * .025 : tantrum ? Math.abs(Math.sin(time * 13)) * .04 : 0;
      feet.forEach((foot, i) => {
        const sign = i ? 1 : -1, lift = walking ? Math.max(0, wave * sign) * .055 : tantrum ? Math.max(0, Math.sin(time * 13) * sign) * .035 : 0;
        foot.position.set(sign * mix(seated ? .17 : .13, .145, stance), mix(.117, .175, stance) + lift, mix(seated ? .075 : .02, -.285, stance));
        foot.scale.set(1, mix(1, 1.6, stance), 1); foot.rotation.x = walking ? wave * sign * .27 : 0;
      });
      arms.forEach((arm, i) => {
        const sign = i ? 1 : -1;
        arm.position.set(sign * .165, seated ? .263 : mix(.345, .265, stance), mix(seated ? .13 : .02, .16, stance));
        arm.rotation.set(walking ? wave * sign * mix(-.4, .34, stance) : 0, 0, -sign * (Math.PI / 2 - (tantrum ? .35 + Math.sin(time * 13) * .2 : .32 * (1 - stance)))); arm.scale.set(mix(1, 1.5, stance), 1, 1);
      });
      ears.forEach((ear, i) => {
        const sign = i ? 1 : -1; ear.position.set(sign * (white ? .25 : .285), white ? .16 : .075, -.035);
        ear.rotation.set(walking ? Math.sin(time * 13 - i) * .08 : 0, 0, sign * (white ? -mix(.32, .80, stance) : .28) + (tantrum ? Math.sin(time * 13) * .13 : 0));
      });
      // Anchor inside the deformed rump, including posture changes and breathing.
      body.updateMatrix();
      tailSocket.set(0, mix(.24, .11, stance) - bodyData.joints[0].position[1], mix(-.13, -.055, stance)).applyMatrix4(body.matrix);
      tail.position.copy(tailSocket); tail.rotation.y = Math.sin(time * (walking || interaction ? 12 : 5)) * (asleep ? .02 : .45);
      const blink = asleep ? .08 : Math.sin(time * 1.7) > .993 ? .08 : 1;
      eyes.forEach(eye => { eye.scale.y = interaction === "cuddle" ? .25 : blink; }); mouth.visible = tantrum || (walking && Math.sin(time * .8) > .3) || (!!interaction && interaction !== "cuddle");
      if (interaction === "boop") { head.position.z += pulse * .27; head.rotation.x = pulse * .10; arms.forEach(arm => arm.rotation.x = -pulse * .5); }
      if (interaction === "highFive") {
        const index = white ? 1 : 0, arm = arms[index]; arm.rotation.set(-2.05 * pulse, 0, (index ? -1 : 1) * Math.PI / 2); arm.scale.x = 1 + pulse * .7;
        root.position.y += Math.max(0, Math.sin(progress * Math.PI * 4)) * .08; head.rotation.z = (white ? 1 : -1) * pulse * .10;
      }
      if (interaction === "cuddle") {
        const index = white ? 1 : 0, inner = arms[index]; inner.rotation.set(-.2 * pulse, 0, (index ? -1 : 1) * Math.PI / 2 * (1 - pulse)); inner.scale.x = 1 + pulse * .6;
        head.position.x += (white ? 1 : -1) * .09 * pulse; head.rotation.z = (white ? -1 : 1) * pulse * .12;
      }
      shoulder.set(0, mix(.39, .37, stance), mix(0, .11, stance));
      throat.set(0, -headSize.y * .70, -headSize.z * .35).applyQuaternion(head.quaternion).add(head.position);
      link.subVectors(throat, shoulder);
      neck.position.copy(shoulder).add(throat).multiplyScalar(.5); neck.scale.set(mix(.105, .09, stance), link.length() / 2 + .07, mix(.105, .08, stance));
      neck.quaternion.setFromUnitVectors(up, link.normalize());
      root.userData.posture = stance;
    },
    dispose() { skeleton.dispose(); geometries.forEach(geometry => geometry.dispose()); materials.forEach(surface => surface.dispose()); },
  };
}

export function duduHeartGeometry() {
  const heart = new THREE.Shape(); heart.moveTo(0, -.13);
  heart.bezierCurveTo(-.24, .005, -.13, .19, 0, .08); heart.bezierCurveTo(.13, .19, .24, .005, 0, -.13);
  return new THREE.ShapeGeometry(heart, 12);
}
