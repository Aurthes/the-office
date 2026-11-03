// Bake a smooth, poseable body. No extra runtime modelling or dependencies.
import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { writeFileSync } from 'node:fs';

const joints = [
  { name: 'body-joint', position: [0, .27, 0] },
  { name: 'head-joint', position: [0, .62, .02] },
  { name: 'foreleg:-1', position: [-.165, .345, .02] },
  { name: 'foreleg:1', position: [.165, .345, .02] },
  { name: 'hind-paw:-1', position: [-.13, .117, .02] },
  { name: 'hind-paw:1', position: [.13, .117, .02] },
];
const shapes = [
  { bone: 0, center: [0, .245, 0], box: [.09, .055, .035], rounding: .12 },
  // Full roots and gently narrower tips keep both poses from looking like clubs.
  ...[-1, 1].map((side, i) => ({ bone: i + 2, a: [side * .165, .345, .02], b: [side * .285, .345, .02], radius: [.095, .055] })),
  ...[-1, 1].map((side, i) => ({ bone: i + 4, a: [side * .115, .145, .015], b: [side * .13, .065, .02], radius: [.105, .055], depth: 1.25 })),
];
function distance(x, y, z, shape) {
  if (shape.box) {
    const q = [x, y, z].map((v, i) => Math.abs(v - shape.center[i]) - shape.box[i]);
    return Math.hypot(...q.map(v => Math.max(v, 0))) + Math.min(Math.max(...q), 0) - shape.rounding;
  }
  const depth = shape.depth || 1;
  const p = [x - shape.a[0], y - shape.a[1], (z - shape.a[2]) / depth], v = shape.b.map((c, i) => (c - shape.a[i]) / (i === 2 ? depth : 1));
  const h = Math.max(0, Math.min(1, (p[0] * v[0] + p[1] * v[1] + p[2] * v[2]) / (v[0] ** 2 + v[1] ** 2 + v[2] ** 2)));
  const radius = shape.radius[0] + (shape.radius[1] - shape.radius[0]) * h;
  return Math.hypot(p[0] - v[0] * h, p[1] - v[1] * h, p[2] - v[2] * h) - radius;
}
function smoothUnion(a, b) {
  const k = .04, h = Math.max(0, Math.min(1, .5 + .5 * (b - a) / k));
  return b + (a - b) * h - k * h * (1 - h);
}
const size = 88, scale = .55, centerY = .27;
const field = new MarchingCubes(size, new THREE.MeshBasicMaterial(), false, false, 30000); field.isolation = 0;
for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const px = (x / size * 2 - 1) * scale, py = (y / size * 2 - 1) * scale + centerY, pz = (z / size * 2 - 1) * scale;
  let value = 10; for (const shape of shapes) value = smoothUnion(value, distance(px, py, pz, shape));
  field.field[x + y * size + z * size * size] = -value;
}
field.update();
const geometry = new THREE.BufferGeometry();
const count = field.geometry.drawRange.count;
for (const name of ['position', 'normal']) geometry.setAttribute(name, new THREE.Float32BufferAttribute(field.geometry.getAttribute(name).array.slice(0, count * 3), 3));
geometry.scale(scale, scale, scale); geometry.translate(0, centerY, 0);
const compact = mergeVertices(geometry, 1e-5), position = compact.getAttribute('position');
const skinIndex = [], skinWeight = [], uv = [];
for (let i = 0; i < position.count; i++) {
  const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
  const parts = joints.map((_, bone) => ({ bone, distance: Math.min(...shapes.filter(s => s.bone === bone).map(s => distance(x, y, z, s))) })).sort((a, b) => a.distance - b.distance).slice(0, 4);
  const weights = parts.map(p => Math.exp(-(p.distance - parts[0].distance) / .020)), total = weights.reduce((a, b) => a + b, 0);
  skinIndex.push(...parts.map(p => p.bone)); skinWeight.push(...weights.map(v => v / total));
  uv.push(Math.atan2(x, z) / (2 * Math.PI) + .5, y * 1.8);
}
const rounded = values => Array.from(values, n => Math.round(n * 1e6) / 1e6);
const asset = { generator: 'node scripts/generate-dudu-body.mjs', joints,
  position: rounded(position.array), normal: rounded(compact.getAttribute('normal').array),
  index: Array.from(compact.index.array), skinIndex, skinWeight: rounded(skinWeight), uv: rounded(uv) };
writeFileSync(new URL('../src/features/ring-ship/duduBody.generated.json', import.meta.url), JSON.stringify(asset) + '\n');
console.log(JSON.stringify({ vertices: position.count, triangles: compact.index.count / 3, bytes: JSON.stringify(asset).length }));
field.geometry.dispose(); field.material.dispose(); geometry.dispose(); compact.dispose();
