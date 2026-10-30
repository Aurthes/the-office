import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Original ship crew artwork: rounded waterfowl silhouettes and matte feathers.
// The rig uses the same height, facing and workstation coordinates as the crew.
export function createDuckCrewFigure() {
  const root = new THREE.Group();
  root.name = "duck-crew";
  const feather = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  const bill = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0 });
  const eyes = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
  const yellow = "#efbd35", wingYellow = "#dfad2d", orange = "#cc7c35", dark = "#302e28";

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
  add(body, new THREE.CapsuleGeometry(0.14, 0.3, 8, 24), feather, yellow, [0, 0.355, 0], [1, 1, 0.9]);
  egg(body, [0, 0.145, -0.105], [0.052, 0.03, 0.066], wingYellow, feather, [-0.3, 0, 0]);

  const face = pivot("face", [0, 0, 0], body);
  // A broad, flattened bill with a separate lower lip and tiny nostrils.
  egg(face, [0, 0.442, 0.145], [0.095, 0.029, 0.078], orange, bill);
  egg(face, [0, 0.423, 0.151], [0.088, 0.014, 0.07], "#ac602d", bill);
  for (const side of [-1, 1]) {
    egg(face, [side * 0.035, 0.465, 0.174], [0.004, 0.0025, 0.006], "#754f2e", bill);
    egg(face, [side * 0.073, 0.517, 0.108], [0.014, 0.018, 0.01], dark, eyes, [0, side * 0.4, 0]);
  }

  const wings = [-1, 1].map(side => {
    const wing = pivot(side < 0 ? "left-wing" : "right-wing", [side * 0.139, 0.30, 0.008], body);
    egg(wing, [side * 0.006, -0.032, 0], [0.035, 0.077, 0.052], wingYellow, feather, [0, 0, side * 0.12]);
    return wing;
  });
  const feet = [-1, 1].map(side => {
    const foot = pivot(side < 0 ? "left-foot" : "right-foot", [side * 0.067, 0.075, 0]);
    egg(foot, [0, -0.025, 0], [0.016, 0.035, 0.018], orange, bill);
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
    for (const material of [feather, bill, eyes]) material.dispose();
  } };
}
