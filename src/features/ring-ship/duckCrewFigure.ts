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
  const yellow = style.featherColor, orange = style.billColor, dark = "#302e28";
  const wingYellow = yellow === "#ffbb3c" ? "#e6a82f" : "#" + new THREE.Color(yellow).multiplyScalar(.87).getHexString();
  const billShade = "#" + new THREE.Color(orange).multiplyScalar(.68).getHexString();

  function add(group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, color: string,
    position: [number, number, number], scale: [number, number, number] = [1, 1, 1], rotation: [number, number, number] = [0, 0, 0]) {
    const tint = new THREE.Color(color), colors = new Float32Array(geometry.getAttribute("position").count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = tint.r; colors[i + 1] = tint.g; colors[i + 2] = tint.b; }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position); mesh.scale.set(...scale); mesh.rotation.set(...rotation);
    mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
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
  add(body, new THREE.CapsuleGeometry(0.14, 0.32, 8, 24), feather, yellow, [0, 0.345, 0], [1.14, 1, 0.93]);
  egg(body, [0, 0.145, -0.105], [0.052, 0.03, 0.066], wingYellow, feather, [-0.3, 0, 0]);

  const face = pivot("face", [0, 0.022, 0], body);
  const billPivot = new THREE.Vector3(0, .448, .105);
  const billTransform = (scale: number) => new THREE.Matrix4().makeScale(scale, scale, scale)
    .setPosition(billPivot.clone().multiplyScalar(1 - scale));
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
  const eyeX = .082 * style.eyeSpacing;
  const eyeZ = .93 * Math.sqrt(Math.max(0, .14 ** 2 - capY ** 2 - (eyeX / 1.14) ** 2)) + .006;
  for (const side of [-1, 1]) egg(face, [side * eyeX, eyeY, eyeZ], [.014, .018, .01], dark, eyes,
    [0, side * Math.atan2(eyeX / 1.14 ** 2, eyeZ / .93 ** 2), 0]);

  if (style.outfit !== "none") {
    const height = style.outfit === "jacket" ? .25 : .19;
    add(body, new THREE.CylinderGeometry(1, 1, height, 32).scale(.166, 1, .137), uniform, style.outfitColor, [0, .292, 0]);
    for (const side of [-1, 1]) {
      add(body, new THREE.BoxGeometry(.018, height, .018), uniform, "#26333a", [side * .095, .292, .12]);
      for (const y of [.25, .33]) add(body, new THREE.BoxGeometry(.058, .045, .023), uniform, style.outfitColor, [side * .045, y, .139]);
    }
    add(body, new THREE.BoxGeometry(.012, height - .02, .012), uniform, "#b8b6a5", [0, .292, .145]);
  }
  if (style.headwear !== "none") {
    const helmet = style.headwear === "helmet";
    const eyeLift = Math.max(0, style.eyeHeight - 1) * .3;
    add(body, new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), uniform, style.outfitColor,
      [0, (helmet ? .566 : .565) + eyeLift, 0], [.173, helmet ? .15 : .118, .148]);
    add(body, new THREE.TorusGeometry(1, .025, 6, 36), uniform, "#25333a", [0, (helmet ? .566 : .565) + eyeLift, 0], [.174, .15, .149], [Math.PI / 2, 0, 0]);
    if (!helmet) egg(body, [0, .563 + eyeLift, .123], [.126, .012, .103], style.outfitColor, uniform);
  }

  const wings = [-1, 1].map(side => {
    const wing = pivot(side < 0 ? "left-wing" : "right-wing", [side * 0.158, 0.30, 0.008], body);
    egg(wing, [side * 0.006, -0.032, 0], [0.035, 0.077, 0.052], wingYellow, feather, [0, 0, side * 0.12]);
    return wing;
  });
  const feet = [-1, 1].map(side => {
    const foot = pivot(side < 0 ? "left-foot" : "right-foot", [side * 0.074, 0.075, 0]);
    egg(foot, [0, -0.027, 0], [0.016, 0.024, 0.018], orange, bill);
    const shape = new THREE.Shape();
    shape.moveTo(-0.021, -0.02); shape.lineTo(-0.052, 0.065); shape.quadraticCurveTo(-0.046, 0.085, -0.026, 0.075);
    shape.quadraticCurveTo(0, 0.095, 0.026, 0.075); shape.quadraticCurveTo(0.046, 0.085, 0.052, 0.065);
    shape.lineTo(0.021, -0.02); shape.closePath();
    const web = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.004, bevelThickness: 0.004, curveSegments: 3 });
    web.rotateX(Math.PI / 2);
    add(foot, web, bill, orange, [0, -0.052, 0.018]);
    return foot;
  });

  // Merge fixed parts by material, while retaining the animated pivots.
  for (const group of [body, face, ...wings, ...feet]) {
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
