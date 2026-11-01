import * as THREE from "three";
import { normalizeDuckAppearance, type DuckAppearance } from "@/lib/avatars/duck";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

function shapedBill() {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  const across = 24, along = 14, stride = along + 1, offset = (across + 1) * stride;
  for (const upper of [true, false]) for (let i = 0; i <= across; i++) for (let j = 0; j <= along; j++) {
    const u = i / across * 2 - 1, v = j / along, weight = Math.max(0, 1 - u * u);
    const front = .204 - .048 * Math.pow(Math.abs(u), 1.2), back = .105 + .018 * Math.abs(u);
    const seam = .448 - .004 * weight;
    const y = upper ? seam + .034 * Math.pow(1 - Math.pow(Math.abs(u), 1.3), .9) * Math.sqrt(1 - v) + .009 * weight * Math.sin(Math.PI * v)
      : seam - .007 * weight * (.4 + .6 * v) - .008 * weight * Math.pow(Math.sin(Math.PI * v), .75);
    positions.push(u * .064, y, back + (front - back) * v); uv.push(i / across, v);
    if (i < across && j < along) {
      const k = (upper ? 0 : offset) + i * stride + j;
      const faces = [k, k + 1, k + stride, k + 1, k + stride + 1, k + stride];
      if (!upper) for (let t = 0; t < faces.length; t += 3) [faces[t], faces[t + 1]] = [faces[t + 1], faces[t]];
      indices.push(...faces);
    }
  }
  for (let i = 0; i < across; i++) {
    const a = i * stride, b = a + stride;
    indices.push(a, b, a + offset, b, b + offset, a + offset);
    const front = a + along, next = b + along;
    indices.push(front, front + offset, next, next, front + offset, next + offset);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

// Original ship crew artwork: rounded waterfowl silhouettes and matte feathers.
// The rig uses the same height, facing and workstation coordinates as the crew.
export function createDuckCrewFigure(appearance?: DuckAppearance) {
  const style = normalizeDuckAppearance(appearance);
  const root = new THREE.Group();
  root.name = "duck-crew";
  // Cancel the original flattened barrel proportions. At 100%, the body has a
  // circular horizontal section; equipment and face scale with the same rig.
  root.scale.set(style.bodyWidth / 1.14, style.bodyHeight, style.bodyDepth / .93);
  const feather = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  const bill = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0 });
  const eyes = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
  const uniform = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .88, metalness: .08 });
  const yellow = style.featherColor, orange = style.billColor, dark = style.eyeColor;
  const wingYellow = style.wingColor ?? (yellow === "#ffbb3c" ? "#e6a82f" : "#" + new THREE.Color(yellow).multiplyScalar(.87).getHexString());
  const footColor = style.footColor ?? orange, hatColor = style.headwearColor ?? style.outfitColor;
  const tailColor = style.tailColor ?? (yellow === "#ffbb3c" ? "#e6a82f" : "#" + new THREE.Color(yellow).multiplyScalar(.87).getHexString());
  const billShade = "#" + new THREE.Color(orange).multiplyScalar(.68).getHexString();

  function add(group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, color: string,
    position: [number, number, number], scale: [number, number, number] = [1, 1, 1], rotation: [number, number, number] = [0, 0, 0]) {
    const tint = new THREE.Color(color), colors = new Float32Array(geometry.getAttribute("position").count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = tint.r; colors[i + 1] = tint.g; colors[i + 2] = tint.b; }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position); mesh.scale.set(...scale); mesh.rotation.set(...rotation);
    mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); return mesh;
  }
  function egg(group: THREE.Group, position: [number, number, number], scale: [number, number, number], color = yellow,
    material = feather, rotation: [number, number, number] = [0, 0, 0]) {
    add(group, new THREE.SphereGeometry(1, 20, 14), material, color, position, scale, rotation);
  }
  function pivot(name: string, position: [number, number, number], parent = root) {
    const group = new THREE.Group(); group.name = name; group.position.set(...position); parent.add(group); return group;
  }

  const body = pivot("body", [0, 0, 0]);
  // One continuous barrel, with parallel sides and rounded ends: no head/neck seam.
  const torso = add(body, new THREE.CapsuleGeometry(0.14, 0.32, 8, 24), feather, yellow, [0, 0.345, 0], [1.14, 1, 0.93]);
  const positions = torso.geometry.getAttribute("position"), colors = torso.geometry.getAttribute("color");
  const bodyTint = new THREE.Color(yellow), headTint = new THREE.Color(style.headColor ?? yellow), tint = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const blend = THREE.MathUtils.smoothstep(positions.getY(i) + .345, .38, .5);
    const scale = 1 + (style.headScale - 1) * blend;
    positions.setXYZ(i, positions.getX(i) * scale, positions.getY(i), positions.getZ(i) * scale);
    tint.copy(bodyTint).lerp(headTint, blend); colors.setXYZ(i, tint.r, tint.g, tint.b);
  }
  torso.geometry.computeVertexNormals();
  if (style.bellyPatch) egg(body, [0, .3, .125], [.10, .105, .025], style.bellyColor);
  if (style.tailStyle === "round") egg(body, [0, .145, -.105], [.052 * style.tailScale, .03 * style.tailScale, .066 * style.tailScale], tailColor, feather, [-.3, 0, 0]);
  else if (style.tailStyle === "fan") for (const side of [-1, 0, 1]) egg(body, [side * .035 * style.tailScale, .155, -.14], [.026 * style.tailScale, .032 * style.tailScale, .09 * style.tailScale], tailColor, feather, [-.3, side * -.4, 0]);
  else add(body, new THREE.ConeGeometry(.048, .15, 5), feather, tailColor, [0, .15, -.16], [style.tailScale, style.tailScale, style.tailScale], [-Math.PI / 2, 0, 0]);

  const face = pivot("face", [0, 0.022, 0], body);
  const billPivot = new THREE.Vector3(0, .448, .105);
  const billTransform = (scale: number) => {
    const size = new THREE.Vector3(scale * style.billWidth, scale, scale * style.billLength);
    return new THREE.Matrix4().makeScale(size.x, size.y, size.z)
      .setPosition(billPivot.clone().multiply(new THREE.Vector3(1, 1, 1).sub(size)));
  };
  if (style.billShape === "sculpted") {
    // The reviewed size is the starting point; the editor scales around the face mount.
    const transform = billTransform(1.17 * style.billScale);
    add(face, shapedBill().applyMatrix4(transform), bill, orange, [0, 0, 0]);
    const seam = Array.from({ length: 25 }, (_, i) => {
      const u = i / 24 * 2 - 1;
      return new THREE.Vector3(u * .064, .448 - .0075 * (1 - u * u), .205 - .048 * Math.pow(Math.abs(u), 1.2));
    });
    add(face, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seam), 24, .0009, 4, false).applyMatrix4(transform), bill, billShade, [0, 0, 0]);
  } else {
    const classic = new THREE.Group();
    egg(classic, [0, .442, .145], [.095, .029, .078], orange, bill);
    egg(classic, [0, .423, .151], [.088, .014, .07], orange === "#f58b28" ? "#dd671e" : billShade, bill);
    for (const side of [-1, 1]) egg(classic, [side * .035, .465, .174], [.004, .0025, .006], "#934617", bill);
    for (const mesh of [...classic.children] as THREE.Mesh[]) {
      mesh.updateMatrix(); mesh.geometry.applyMatrix4(mesh.matrix).applyMatrix4(billTransform(style.billScale));
      mesh.position.set(0, 0, 0); mesh.scale.set(1, 1, 1);
      face.add(mesh);
    }
  }
  const eyeY = .517 + (style.eyeHeight - 1) * .3;
  const capY = Math.max(0, Math.abs(eyeY + .022 - .345) - .16);
  const eyeX = .082 * style.eyeSpacing * style.headScale;
  const eyeZ = .93 * style.headScale * Math.sqrt(Math.max(0, .14 ** 2 - capY ** 2 - (eyeX / (1.14 * style.headScale)) ** 2)) + .006;
  for (const side of [-1, 1]) {
    const rotation: [number, number, number] = [0, side * Math.atan2(eyeX / 1.14 ** 2, eyeZ / .93 ** 2), 0];
    if (style.eyeStyle === "happy") add(face, new THREE.TorusGeometry(.015, .004, 6, 14, Math.PI), eyes, dark, [side * eyeX, eyeY, eyeZ], [style.eyeScale, style.eyeScale, style.eyeScale], rotation);
    else egg(face, [side * eyeX, eyeY, eyeZ], [.014 * style.eyeScale, .018 * style.eyeScale * (style.eyeStyle === "sleepy" ? .45 : 1), .01], dark, eyes, rotation);
    if (style.eyewear === "round") add(face, new THREE.TorusGeometry(.026 * style.eyeScale, .004, 6, 20), uniform, hatColor, [side * eyeX, eyeY, eyeZ + .016], [1, 1, 1], rotation);
  }
  if (style.eyewear === "round") add(face, new THREE.BoxGeometry(eyeX * 1.35, .005, .005), uniform, hatColor, [0, eyeY, eyeZ + .023]);
  if (style.eyewear === "visor") egg(face, [0, eyeY, eyeZ + .005], [.13 * style.headScale, .035 * style.eyeScale, .024], "#476f82", uniform);

  if (style.outfit === "vest" || style.outfit === "jacket") {
    const height = style.outfit === "jacket" ? .25 : .19;
    add(body, new THREE.CylinderGeometry(1, 1, height, 32).scale(.166, 1, .137), uniform, style.outfitColor, [0, .292, 0]);
    for (const side of [-1, 1]) {
      add(body, new THREE.BoxGeometry(.018, height, .018), uniform, "#26333a", [side * .095, .292, .12]);
      for (const y of [.25, .33]) add(body, new THREE.BoxGeometry(.058, .045, .023), uniform, style.outfitColor, [side * .045, y, .139]);
    }
    add(body, new THREE.BoxGeometry(.012, height - .02, .012), uniform, "#b8b6a5", [0, .292, .145]);
  }
  if (style.outfit === "scarf") {
    add(body, new THREE.TorusGeometry(.153, .016, 8, 32), uniform, style.outfitColor, [0, .405, 0], [1.08, .9, 1], [Math.PI / 2, 0, 0]);
    add(body, new THREE.BoxGeometry(.047, .15, .018), uniform, style.outfitColor, [.055, .33, .14], [1, 1, 1], [0, 0, -.16]);
  }
  if (style.backpack) {
    egg(body, [0, .29, -.147], [.095, .11, .045], style.outfitColor, uniform);
    for (const side of [-1, 1]) add(body, new THREE.BoxGeometry(.018, .2, .024), uniform, "#394047", [side * .1, .3, -.075]);
  }
  if (style.crest !== "none" && style.headwear === "none") {
    const tufts = style.crest === "mohawk" ? [-.045, 0, .045] : [0];
    for (const z of tufts) egg(body, [0, .648, z], [.024, .05, .025], style.headColor ?? yellow, feather, [.2, 0, .2]);
  }
  if (style.headwear !== "none") {
    const helmet = style.headwear === "helmet";
    const eyeLift = Math.max(0, style.eyeHeight - 1) * .3;
    if (style.headwear === "crown") {
      add(body, new THREE.CylinderGeometry(.13, .14, .065, 24, 1, true), uniform, hatColor, [0, .63 + eyeLift, 0], [style.headScale, 1, style.headScale]);
      for (let i = 0; i < 5; i++) {
        const angle = i * Math.PI * 2 / 5;
        add(body, new THREE.ConeGeometry(.023, .058, 4), uniform, hatColor, [Math.sin(angle) * .13 * style.headScale, .689 + eyeLift, Math.cos(angle) * .13 * style.headScale]);
      }
    } else {
    add(body, new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), uniform, hatColor,
      [0, (helmet ? .566 : .565) + eyeLift, 0], [.173 * style.headScale, helmet ? .15 : .118, .148 * style.headScale]);
    add(body, new THREE.TorusGeometry(1, .025, 6, 36), uniform, "#25333a", [0, (helmet ? .566 : .565) + eyeLift, 0], [.174 * style.headScale, .15 * style.headScale, .149], [Math.PI / 2, 0, 0]);
    if (style.headwear === "cap") egg(body, [0, .563 + eyeLift, .123], [.126 * style.headScale, .012, .103 * style.headScale], hatColor, uniform);
    if (style.headwear === "beanie") egg(body, [0, .7 + eyeLift, 0], [.035, .035, .035], hatColor, uniform);
    }
  }

  const wingParts: THREE.Group[] = [];
  const wings = [-1, 1].map(side => {
    const wing = pivot(side < 0 ? "left-wing" : "right-wing", [side * 0.158, 0.30, 0.008], body);
    const shape = pivot("wing-shape", [0, 0, 0], wing); wingParts.push(shape);
    shape.scale.set(style.wingWidth, style.wingLength, 1); shape.rotation.z = side * style.wingSpread * Math.PI / 180;
    egg(shape, [side * .006, -.032, 0], [.035, .077, .052], wingYellow, feather, [0, 0, side * .12]);
    if (style.wingStyle === "layered") for (const z of [-.028, 0, .028]) egg(shape, [side * .022, -.065, z], [.022, .053, .025], wingYellow);
    return wing;
  });
  const feet = [-1, 1].map(side => {
    const foot = pivot(side < 0 ? "left-foot" : "right-foot", [side * .074 * style.footSpacing, .075, 0]);
    foot.scale.set(style.footScale, 1, style.footScale);
    if (style.footStyle === "boots") {
      add(foot, new THREE.BoxGeometry(.06, .06, .07), uniform, footColor, [0, -.018, 0]);
      egg(foot, [0, -.039, .035], [.042, .026, .063], footColor, uniform);
      add(foot, new THREE.BoxGeometry(.078, .012, .115), uniform, "#343638", [0, -.062, .018]);
      return foot;
    }
    egg(foot, [0, -0.027, 0], [0.016, 0.024, 0.018], footColor, bill);
    const shape = new THREE.Shape();
    shape.moveTo(-0.021, -0.02); shape.lineTo(-0.052, 0.065); shape.quadraticCurveTo(-0.046, 0.085, -0.026, 0.075);
    shape.quadraticCurveTo(0, 0.095, 0.026, 0.075); shape.quadraticCurveTo(0.046, 0.085, 0.052, 0.065);
    shape.lineTo(0.021, -0.02); shape.closePath();
    const web = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.004, bevelThickness: 0.004, curveSegments: 3 });
    web.rotateX(Math.PI / 2);
    add(foot, web, bill, footColor, [0, -0.052, 0.018]);
    return foot;
  });

  // Merge fixed parts by material, while retaining the animated pivots.
  for (const group of [body, face, ...wingParts, ...feet]) {
    const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const child of [...group.children]) {
      if (!(child instanceof THREE.Mesh)) continue;
      child.updateMatrix(); child.geometry.applyMatrix4(child.matrix);
      const material = child.material as THREE.Material;
      if (!batches.has(material)) batches.set(material, []);
      const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
      batches.get(material)!.push(geometry); child.geometry.dispose(); group.remove(child);
    }
    for (const [material, geometries] of batches) {
      const geometry = mergeGeometries(geometries, false)!;
      geometries.forEach(value => value.dispose());
      const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    }
  }

  return { root, body, wings, feet, dispose() {
    root.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    for (const material of [feather, bill, eyes, uniform]) material.dispose();
  } };
}
