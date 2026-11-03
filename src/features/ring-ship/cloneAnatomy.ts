import * as THREE from "three";
import { normalizeDuckAppearance, type DuckAppearance } from "@/lib/avatars/duck";
import { cloneAnatomy } from "./cloneMotion";

// Stylized anatomical layers follow the same local coordinates as the duck rig.
// Each part grows in order along the body, then stays inside the outer layers.
export function createCloneAnatomy(appearance?: DuckAppearance) {
  const style = normalizeDuckAppearance(appearance), root = new THREE.Group();
  root.name = "clone-anatomy"; root.scale.set(style.bodyWidth / 1.14, style.bodyHeight, style.bodyDepth / .93);
  const bone = new THREE.MeshStandardMaterial({ color: "#f0e7ca", roughness: .78 });
  const muscle = new THREE.MeshStandardMaterial({ color: "#bd6868", roughness: .72 });
  const tendon = new THREE.MeshStandardMaterial({ color: "#e3a79b", roughness: .82 });
  const dark = new THREE.MeshStandardMaterial({ color: "#514b4a", roughness: .9 });
  const glow = new THREE.MeshBasicMaterial({ color: "#8ef2e8", transparent: true, opacity: .7, depthWrite: false });
  const parts: Array<{ node: THREE.Mesh; layer: "bone" | "tissue"; level: number; scale: THREE.Vector3 }> = [];
  function part(layer: "bone" | "tissue", geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number], scale: [number, number, number] = [1, 1, 1]) {
    const node = new THREE.Mesh(geometry, material); node.position.set(...position); node.scale.set(...scale);
    node.name = `clone-${layer}`; root.add(node); parts.push({ node, layer, level: Math.max(0, position[1] / .65), scale: node.scale.clone() }); return node;
  }
  function link(a: [number, number, number], b: [number, number, number], radius = .013) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), delta = end.clone().sub(start);
    const node = part("bone", new THREE.CylinderGeometry(radius, radius * 1.1, delta.length(), 8), bone, start.clone().add(end).multiplyScalar(.5).toArray() as [number, number, number]);
    node.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  }
  link([0, .13, -.025], [0, .47, -.025], .018);
  for (const y of [.20, .25, .30, .35, .40]) {
    const rib = part("bone", new THREE.TorusGeometry(.105, .01, 6, 24), bone, [0, y, -.015], [1.12, .58, 1]); rib.rotation.x = Math.PI / 2;
    part("bone", new THREE.SphereGeometry(.022, 8, 6), bone, [0, y, -.025]);
  }
  part("bone", new THREE.SphereGeometry(1, 20, 12), bone, [0, .51, .005], [.10 * style.headScale, .09, .075]);
  part("bone", new THREE.SphereGeometry(1, 16, 10), bone, [0, .475, .09], [.065, .027, .067]);
  for (const side of [-1, 1]) {
    part("bone", new THREE.SphereGeometry(1, 12, 8), dark, [side * .048, .535, .065], [.022, .026, .012]);
    link([side * .07, .145, 0], [side * .065, .055, .012], .016);
    for (const toe of [-1, 0, 1]) link([side * .065, .045, .01], [side * .065 + toe * .025, .025, .10], .009);
    link([side * .025, .16, -.02], [side * .07, .145, 0], .022);
    link([side * .105, .37, 0], [side * .19, .29, .005]);
    link([side * .19, .29, .005], [side * .15, .20, .025], .01);
    const wing = part("tissue", new THREE.CapsuleGeometry(.037, .12, 6, 12), muscle, [side * .15, .29, .005], [1, 1, .75]); wing.rotation.z = side * -.25;
    part("tissue", new THREE.SphereGeometry(1, 14, 10), muscle, [side * .065, .095, .015], [.045, .07, .045]);
    part("tissue", new THREE.CapsuleGeometry(.043, .16, 6, 12), muscle, [side * .065, .29, .025], [.85, 1, 1.65]);
  }
  part("tissue", new THREE.CapsuleGeometry(.123, .25, 8, 24), muscle, [0, .34, 0], [1.03, 1, .83]);
  part("tissue", new THREE.SphereGeometry(1, 20, 12), tendon, [0, .51, .005], [.118 * style.headScale, .105, .095]);
  for (let y = .18; y < .42; y += .04) {
    const band = part("tissue", new THREE.TorusGeometry(.125, .003, 4, 24), tendon, [0, y, 0], [1, .84, 1]); band.rotation.x = Math.PI / 2;
  }
  const scanner = new THREE.Mesh(new THREE.TorusGeometry(.225, .003, 6, 48), glow); scanner.rotation.x = Math.PI / 2; scanner.name = "clone-growth-scan"; root.add(scanner);
  function update(seconds: number) {
    const progress = cloneAnatomy(seconds);
    for (const p of parts) {
      const growth = THREE.MathUtils.smoothstep(progress[p.layer] - p.level * .72, 0, .25);
      p.node.visible = growth > 0 && progress.skin < 1; p.node.scale.copy(p.scale).multiplyScalar(Math.max(.001, growth));
    }
    scanner.visible = seconds >= .4 && seconds < 8.8;
    const phase = seconds < 3.4 ? progress.bone : seconds < 6.2 ? progress.tissue : progress.skin;
    scanner.position.y = .66 * phase; scanner.scale.setScalar(1 + .035 * Math.sin(seconds * 14));
    return progress;
  }
  update(0);
  return { root, update, dispose() { root.traverse(node => { if (node instanceof THREE.Mesh) node.geometry.dispose(); }); for (const material of [bone, muscle, tendon, dark, glow]) material.dispose(); } };
}
