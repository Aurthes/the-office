import * as THREE from "three";
import type { Builder, ModelName } from "./geometry";
import { cabinAngle, shipPoint, type ShipCabin, type ShipLayout } from "./layout";

const WATER = new THREE.MeshStandardMaterial({ roughness: .23, metalness: .02, transparent: true, opacity: .88 });
const LEAF = new THREE.MeshStandardMaterial({ roughness: .96, metalness: 0, side: THREE.DoubleSide, vertexColors: true });

function tropicalPlant(b: Builder, point: (u: number, v: number) => { x: number; z: number }, u: number, v: number, height: number, spread: number, seed: number) {
  const shade = new THREE.Color("#28593c"), tip = new THREE.Color("#6a9a50");
  for (let leaf = 0; leaf < 7; leaf++) {
    const angle = seed + leaf * Math.PI * 2 / 7, length = spread * (.85 + .15 * Math.sin(leaf * 2.1));
    const positions: number[] = [], colors: number[] = [], indices: number[] = [];
    for (let row = 0; row <= 12; row++) {
      const t = row / 12, width = Math.sin(Math.PI * t) * length * .28;
      const y = .2 + height * (1 - Math.exp(-t * 4) - .45 * t ** 3);
      for (const side of [-1, 0, 1]) {
        const p = point(u + Math.sin(angle) * length * t + Math.cos(angle) * width * side, v + Math.cos(angle) * length * t - Math.sin(angle) * width * side);
        positions.push(p.x, y + (side === 0 ? width * .12 : -width * .18), p.z);
        const color = shade.clone().lerp(tip, t * .65 + (side === 0 ? .16 : 0));
        colors.push(color.r, color.g, color.b);
      }
      if (row < 12) for (let side = 0; side < 2; side++) {
        const a = row * 3 + side; indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    b.add(geometry, "#ffffff", new THREE.Matrix4(), false, LEAF);
  }
}

export function addRainforest(b: Builder, layout: ShipLayout, cabin: ShipCabin) {
  const ring = layout.rings[cabin.ring], step = Math.PI * 2 / layout.allocation.sectors;
  const width = ring.radius * step, angle = cabinAngle(layout, cabin.slot);
  const point = (u: number, v: number) => shipPoint(ring.radius + v, angle + u / ring.radius);
  const xyz = (u: number, v: number, y: number): [number, number, number] => { const p = point(u, v); return [p.x, y, p.z]; };
  const model = (name: ModelName, size: number, u: number, v: number, y = .21, yaw = 0) => b.furniture(name, size, point(u, v), y, angle + u / ring.radius + yaw);
  const box = (u: number, v: number, y: number, size: [number, number, number], color: string) => b.localBox(layout, cabin, u, v, y, size, color);
  const start = cabin.slot * step - Math.PI / 2 + .05, end = (cabin.slot + 1) * step - Math.PI / 2 - .05;

  // The ring's central circulation lane stays clear between two planted beds.
  for (const side of [-1, 1]) {
    const inner = side > 0 ? ring.radius + .83 : ring.radius - ring.depth / 2 + .4;
    const outer = side > 0 ? ring.radius + ring.depth / 2 - .4 : ring.radius - .83;
    b.annulus(inner, outer, start, end, .07, .12, side > 0 ? "#465a3d" : "#3d5845");
  }
  for (let u = -width * .42; u < width * .42; u += .35) {
    box(u, 0, .061, [.31, .024, 1.24], Math.round(u / .35) % 2 ? "#957c61" : "#86705a");
  }
  for (let index = 0; index < 5; index++) {
    const u = (index - 2) * width * .16, v = index % 2 ? 1.6 : 1.4, size = index === 2 ? 2.8 : 2.55;
    if (!model("rainforestTree", size, u, v, .19, index * 1.8)) {
      b.cylinder(.12, 1.7, xyz(u, v, 1.02), "#79644b", 9);
      b.ball(.9, xyz(u, v, 2.15), "#43764c", [1.2, .8, 1]);
    }
    model("rainforestFern", 1.1, u + .65, 1.4, .2, index);
    tropicalPlant(b, point, u - .75, 2.55, .85, .65, index * .9);
    model("rainforestRock", .62, u - .5, 1.35, .14, index);
    const vine = u + .4;
    b.curve([xyz(vine, 1.65, 2.35), xyz(vine - .16, 1.6, 1.85), xyz(vine + .1, 1.58, 1.3), xyz(vine, 1.62, .8)], .025, "#456443");
    for (let j = 0; j < 5; j++) model("rainforestFern", .25, vine + (j % 2 ? .1 : -.1), 1.58, .95 + j * .25, j * 1.2);
  }
  for (let i = 0; i < 17; i++) {
    const u = (i - 8) * width * .048;
    model("rainforestFern", 1.1 + (i % 3) * .12, u, i % 2 ? 2.65 : 1.35, .2, i * .8);
    if (Math.abs(u) > 1.6) {
      if (i % 2) tropicalPlant(b, point, u, -1.9, 1.6, .92, i * 1.3);
      else model("rainforestFern", 1.35, u, -2.05, .2, i);
      model("rainforestFern", 1.05, u + .35, -1.35, .2, i);
    }
  }
  for (const [index, u] of [-width * .29, -width * .115, width * .115, width * .29].entries()) {
    model("rainforestTree", index % 2 ? 2.15 : 2.35, u, -1.8, .19, index * 1.9 + .8);
  }
  // A dark, shallow pool sits inside the planting, away from the walking lane.
  const pond = point(0, -2.05);
  const matrix = new THREE.Matrix4().makeRotationY(angle).scale(new THREE.Vector3(1.25, 1, .58)).setPosition(pond.x, .205, pond.z);
  b.add(new THREE.CylinderGeometry(1, 1, .025, 48), "#397e78", matrix, false, WATER);
  for (let i = 0; i < 11; i++) {
    const a = i / 11 * Math.PI * 2;
    const u = Math.cos(a) * 1.32, v = -2.05 + Math.sin(a) * .63;
    if (!model("rainforestRock", .36 + (i % 3) * .06, u, v, .15, a)) b.ball(.2, xyz(u, v, .23), "#7b8270", [1, .6, 1]);
  }
  for (const side of [-1, 1]) {
    const u = side * width * .39;
    model("rainforestBush", .35, u, -2.5, .2, side);
    box(u, -1.25, .42, [1.15, .1, .43], "#a58a67");
    for (const foot of [-.4, .4]) box(u + foot, -1.25, .24, [.09, .36, .32], "#435650");
    box(u, 2.6, .73, [.08, 1.1, .09], "#658178");
    box(u, 2.57, 1.28, [.36, .25, .055], "#2e504b");
    b.localBox(layout, cabin, u, 2.535, 1.29, [.25, .12, .02], "#90c19e", 0, true);
  }
}

export function addMachineRoom(b: Builder, layout: ShipLayout, cabin: ShipCabin) {
  const ring = layout.rings[cabin.ring], width = ring.radius * Math.PI * 2 / layout.allocation.sectors;
  const angle = cabinAngle(layout, cabin.slot);
  const point = (u: number, v: number) => shipPoint(ring.radius + v, angle + u / ring.radius);
  const xyz = (u: number, v: number, y: number): [number, number, number] => { const p = point(u, v); return [p.x, y, p.z]; };
  const box = (u: number, v: number, y: number, size: [number, number, number], color: string, glow = false) => b.localBox(layout, cabin, u, v, y, size, color, 0, glow);

  for (const side of [-1, 1]) {
    const v = side * 1.52, front = v - side * .43;
    for (const [index, u] of [-width * .27, 0, width * .27].entries()) {
      box(u, v, .18, [1.12, .23, .94], "#53636a");
      box(u, v, 1.08, [1.02, 1.72, .84], "#263a46");
      for (const edge of [-.47, .47]) box(u + edge, front, 1.1, [.055, 1.68, .08], "#819297");
      for (let slot = 0; slot < 7; slot++) {
        const y = .39 + slot * .205;
        box(u, front, y, [.83, .16, .055], slot % 2 ? "#334852" : "#1b2c36");
        box(u + .3, front - side * .035, y, [.045, .026, .018], slot === 3 && index === 1 ? "#d3a15e" : "#72b4aa", true);
        for (const vent of [-.25, -.12, 0, .12]) box(u + vent, front - side * .032, y, [.04, .075, .015], "#0e1c24");
      }
      b.furniture("machineFan", .74, point(u, v), 1.95, angle + u / ring.radius);
      // Grounded cable bundles join each rack to the rear service rail.
      b.curve([xyz(u, v, .23), xyz(u + .15, side * 2.05, .2), xyz(u + .45, side * 2.18, .24)], .045, "#344c54");
    }
    b.curve([xyz(-width * .34, side * 2.15, .3), xyz(-width * .37, side * 2.15, 1.65), xyz(0, side * 2.15, 1.8), xyz(width * .36, side * 2.15, 1.65), xyz(width * .37, side * 2.15, .35)], .065, "#7a9b9b");
    b.curve([xyz(-width * .32, side * 2.28, .3), xyz(-width * .33, side * 2.28, 1.5), xyz(0, side * 2.28, 1.6), xyz(width * .34, side * 2.28, 1.5)], .035, "#4d727b");
    for (const u of [-width * .39, width * .39]) {
      const terminal = point(u, side * 1.18);
      if (!b.furniture("machineConsole", .56, terminal, .09, angle + (side > 0 ? Math.PI : 0))) {
        box(u, side * 1.18, .62, [.58, 1.06, .42], "#667c82");
        box(u, side * 1.18 - side * .22, 1.07, [.42, .25, .025], "#79aaa9");
      }
    }
    box(0, side * .76, .073, [width * .8, .018, .035], "#d3ab65");
  }
  for (let i = -3; i <= 3; i++) {
    const u = i * width * .1;
    box(u, 0, .065, [width * .09, .018, 1.25], i % 2 ? "#718084" : "#65777d");
    for (const line of [-.24, 0, .24]) box(u, line, .078, [width * .065, .005, .012], "#455b65");
  }
}
