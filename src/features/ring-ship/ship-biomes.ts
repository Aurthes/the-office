import * as THREE from "three";
import type { Builder, ModelName } from "./geometry";
import { cabinAngle, shipPoint, type ShipCabin, type ShipLayout } from "./layout";

const WATER = new THREE.MeshStandardMaterial({ roughness: .23, metalness: .02, transparent: true, opacity: .88 });
const LEAF = new THREE.MeshStandardMaterial({ roughness: .96, metalness: 0, side: THREE.DoubleSide, vertexColors: true });

function tropicalPlant(b: Builder, point: (u: number, v: number) => { x: number; z: number }, u: number, v: number, height: number, spread: number, seed: number, base = .2) {
  b.object("tropicalPlant", () => {
    const shade = new THREE.Color("#28593c").lerp(new THREE.Color("#3a6842"), .5 + .5 * Math.sin(seed));
    const tip = new THREE.Color("#6a9a50").lerp(new THREE.Color("#3d8272"), .5 + .5 * Math.cos(seed * 1.7));
    for (let leaf = 0; leaf < 7; leaf++) {
      const variation = Math.sin(seed * 3.7 + leaf * 2.1);
      const angle = seed + leaf * Math.PI * 2 / 7 + variation * .24, length = spread * (.82 + .18 * variation);
      const positions: number[] = [], colors: number[] = [], indices: number[] = [];
      for (let row = 0; row <= 12; row++) {
        const t = row / 12, width = Math.sin(Math.PI * t) * length * .28;
        const y = base + height * (1 - Math.exp(-t * 4) - (.4 + variation * .15) * t ** 3);
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
  });
}

function hangingVine(b: Builder, points: [number, number, number][], seed: number) {
  b.object("vine", () => {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    b.add(new THREE.TubeGeometry(curve, 32, .018, 5, false), "#496442");
    const positions: number[] = [], colors: number[] = [];
    for (let i = 1; i < 10; i++) {
      const p = curve.getPoint(i / 10), angle = seed + (i % 2 ? 0 : Math.PI) + Math.sin(i * 2.4) * .4;
      const length = .17 + .07 * Math.sin(seed + i), width = length * .38;
      const outward = new THREE.Vector3(Math.sin(angle), -.25, Math.cos(angle));
      const across = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
      const tip = p.clone().addScaledVector(outward, length);
      const middle = p.clone().addScaledVector(outward, length * .48).add(new THREE.Vector3(0, .025, 0));
      const left = middle.clone().addScaledVector(across, width), right = middle.clone().addScaledVector(across, -width);
      const shade = new THREE.Color(i % 3 ? "#4e8050" : "#83a85b");
      for (const vertex of [p, left, middle, left, tip, middle, p, middle, right, middle, tip, right]) {
        positions.push(vertex.x, vertex.y, vertex.z); colors.push(shade.r, shade.g, shade.b);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
    b.add(geometry, "#ffffff", new THREE.Matrix4(), false, LEAF);
  });
}

export function addRainforest(b: Builder, layout: ShipLayout, cabin: ShipCabin) {
  const ring = layout.rings[cabin.ring], step = Math.PI * 2 / layout.allocation.sectors;
  const width = ring.radius * step, angle = cabinAngle(layout, cabin.slot);
  const point = (u: number, v: number) => shipPoint(ring.radius + v, angle + u / ring.radius);
  const xyz = (u: number, v: number, y: number): [number, number, number] => { const p = point(u, v); return [p.x, y, p.z]; };
  const model = (name: ModelName, size: number, u: number, v: number, y = .21, yaw = 0) => b.furniture(name, size, point(u, v), y, angle + u / ring.radius + yaw);
  const box = (u: number, v: number, y: number, size: [number, number, number], color: string) => b.localBox(layout, cabin, u, v, y, size, color);
  const start = cabin.slot * step - Math.PI / 2 + .05, end = (cabin.slot + 1) * step - Math.PI / 2 - .05;
  // Stable per habitat: natural growth survives reloads and roster updates.
  let seed = 2166136261;
  for (const char of cabin.id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const between = (min: number, max: number) => min + random() * (max - min);
  const plantable = (u: number, v: number) => Math.abs(u) < width * .39 && Math.abs(v) > 1.08 && Math.abs(v) < ring.depth / 2 - .55 &&
    // Keep the pond, benches and service terminals accessible.
    (u / 1.65) ** 2 + ((v + 2.05) / .95) ** 2 > 1 &&
    !(Math.abs(Math.abs(u) - width * .39) < .9 && (v < 0 ? Math.abs(v + 1.25) < .65 : v > 2.05));

  // The ring's central circulation lane stays clear between two planted beds.
  for (const side of [-1, 1]) {
    const inner = side > 0 ? ring.radius + .83 : ring.radius - ring.depth / 2 + .4;
    const outer = side > 0 ? ring.radius + ring.depth / 2 - .4 : ring.radius - .83;
    b.annulus(inner, outer, start, end, .07, .12, side > 0 ? "#465a3d" : "#3d5845");
  }
  for (let u = -width * .42; u < width * .42; u += .35) {
    box(u, 0, .061, [.31, .024, 1.24], Math.round(u / .35) % 2 ? "#957c61" : "#86705a");
  }
  const patches = Array.from({ length: 9 }, () => ({ u: between(-width * .35, width * .35), v: (random() < .55 ? 1 : -1) * between(1.5, 2.65) }));
  const trees: { u: number; v: number; height: number; spread: number }[] = [];
  for (let attempt = 0; attempt < 160 && trees.length < 12; attempt++) {
    const patch = patches[Math.floor(random() * patches.length)];
    const u = patch.u + between(-1.65, 1.65), v = patch.v + between(-.65, .65);
    if (!plantable(u, v) || trees.some(tree => Math.hypot(tree.u - u, tree.v - v) < 1.2)) continue;
    const kind = trees.length % 3, yaw = between(0, Math.PI * 2), spread = between(.8, 1.2);
    let height = between(1.7, 2.7);
    if (kind === 0) {
      const size = between(1.8, 2.65);
      b.object("rainforestTree", () => { if (!model("rainforestTree", size, u, v, .19, yaw)) {
        b.curve([xyz(u, v, .2), xyz(u + .08, v, 1.2), xyz(u - .12, v + .06, height)], .12, "#79644b");
        b.ball(spread, xyz(u, v, height), "#43764c", [1.15, .65, 1]);
      } });
      height = size * .9;
    } else {
      // Curved palms and shorter tree ferns break up the broadleaf canopy.
      if (kind === 2) height *= .58;
      const leanU = between(-.28, .28), leanV = between(-.16, .16);
      b.object("rainforestTree", () => b.curve([xyz(u, v, .2), xyz(u + leanU * .3, v + leanV * .3, height * .55), xyz(u + leanU, v + leanV, height)], kind === 1 ? .085 : .11, kind === 1 ? "#79644b" : "#586349"));
      if (kind === 2 && model("rainforestFern", spread * 1.8, u + leanU, v + leanV, height, yaw)) height += .35;
      else tropicalPlant(b, point, u + leanU, v + leanV, kind === 1 ? .85 : .55, spread * 1.25, yaw, height);
    }
    trees.push({ u, v, height, spread });
  }
  // Understory gathers around tree roots, with occasional growth in the gaps.
  for (let attempt = 0, planted = 0; attempt < 220 && planted < 76; attempt++) {
    const patch = random() < .8 && trees.length ? trees[Math.floor(random() * trees.length)] : patches[Math.floor(random() * patches.length)];
    const a = between(0, Math.PI * 2), distance = between(.35, 1.65);
    const u = patch.u + Math.cos(a) * distance, v = patch.v + Math.sin(a) * distance * .6;
    if (!plantable(u, v)) continue;
    const kind = random(), size = between(.55, 1.25), yaw = between(0, Math.PI * 2);
    if (kind < .48) model("rainforestFern", size, u, v, .18, yaw);
    else if (kind < .7) model("rainforestBush", size * .65, u, v, .16, yaw);
    else tropicalPlant(b, point, u, v, between(.45, 1.15), size * .65, yaw);
    planted++;
  }
  for (const [index, tree] of trees.entries()) {
    // Unequal hanging tendrils and occasional swags between nearby crowns.
    const count = Math.floor(between(1, 4));
    for (let i = 0; i < count; i++) {
      const a = between(0, Math.PI * 2), u = tree.u + Math.sin(a) * tree.spread * .4, v = tree.v + Math.cos(a) * tree.spread * .22;
      const top = tree.height * between(.8, 1.05), bottom = between(.35, top * .65), sway = between(-.3, .3);
      hangingVine(b, [xyz(u, v, top), xyz(u + sway, v + .08, top * .72), xyz(u - sway * .5, v - .06, bottom + .2), xyz(u + sway * .4, v, bottom)], a);
    }
    const next = trees.slice(index + 1).find(other => other.v * tree.v > 0 && Math.hypot(other.u - tree.u, other.v - tree.v) < 3.4);
    if (next && random() < .65) hangingVine(b, [xyz(tree.u, tree.v, tree.height * .8), xyz((tree.u + next.u) / 2, (tree.v + next.v) / 2, Math.min(tree.height, next.height) * .55), xyz(next.u, next.v, next.height * .8)], between(0, Math.PI * 2));
  }
  // A dark, shallow pool sits inside the planting, away from the walking lane.
  const pond = point(0, -2.05);
  const matrix = new THREE.Matrix4().makeRotationY(angle).scale(new THREE.Vector3(1.25, 1, .58)).setPosition(pond.x, .205, pond.z);
  b.object("pond", () => b.add(new THREE.CylinderGeometry(1, 1, .025, 48), "#397e78", matrix, false, WATER));
  for (let i = 0; i < 11; i++) {
    const a = (i + between(-.3, .3)) / 11 * Math.PI * 2;
    const u = Math.cos(a) * between(1.26, 1.4), v = -2.05 + Math.sin(a) * between(.6, .72);
    b.object("rainforestRock", () => { if (!model("rainforestRock", between(.28, .55), u, v, .15, a)) b.ball(.2, xyz(u, v, .23), "#7b8270", [1, .6, 1]); });
  }
  for (const side of [-1, 1]) {
    const u = side * width * .39;
    model("rainforestBush", .35, u, -2.5, .2, side);
    b.object("bench", () => {
      box(u, -1.25, .42, [1.15, .1, .43], "#a58a67");
      for (const foot of [-.4, .4]) box(u + foot, -1.25, .24, [.09, .36, .32], "#435650");
    });
    b.object("terminal", () => {
      box(u, 2.6, .73, [.08, 1.1, .09], "#658178");
      box(u, 2.57, 1.28, [.36, .25, .055], "#2e504b");
      b.localBox(layout, cabin, u, 2.535, 1.29, [.25, .12, .02], "#90c19e", 0, true);
    });
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
      b.object("serverRack", () => {
        box(u, v, .18, [1.12, .23, .94], "#53636a");
        box(u, v, 1.08, [1.02, 1.72, .84], "#263a46");
        for (const edge of [-.47, .47]) box(u + edge, front, 1.1, [.055, 1.68, .08], "#819297");
        for (let slot = 0; slot < 7; slot++) {
          const y = .39 + slot * .205;
          box(u, front, y, [.83, .16, .055], slot % 2 ? "#334852" : "#1b2c36");
          box(u + .3, front - side * .035, y, [.045, .026, .018], slot === 3 && index === 1 ? "#d3a15e" : "#72b4aa", true);
          for (const vent of [-.25, -.12, 0, .12]) box(u + vent, front - side * .032, y, [.04, .075, .015], "#0e1c24");
        }
      });
      b.furniture("machineFan", .74, point(u, v), 1.95, angle + u / ring.radius);
      // Grounded cable bundles join each rack to the rear service rail.
      b.object("cables", () => b.curve([xyz(u, v, .23), xyz(u + .15, side * 2.05, .2), xyz(u + .45, side * 2.18, .24)], .045, "#344c54"));
    }
    b.object("cables", () => b.curve([xyz(-width * .34, side * 2.15, .3), xyz(-width * .37, side * 2.15, 1.65), xyz(0, side * 2.15, 1.8), xyz(width * .36, side * 2.15, 1.65), xyz(width * .37, side * 2.15, .35)], .065, "#7a9b9b"));
    b.object("cables", () => b.curve([xyz(-width * .32, side * 2.28, .3), xyz(-width * .33, side * 2.28, 1.5), xyz(0, side * 2.28, 1.6), xyz(width * .34, side * 2.28, 1.5)], .035, "#4d727b"));
    for (const u of [-width * .39, width * .39]) {
      const terminal = point(u, side * 1.18);
      b.object("machineConsole", () => { if (!b.furniture("machineConsole", .56, terminal, .09, angle + (side > 0 ? Math.PI : 0))) {
        box(u, side * 1.18, .62, [.58, 1.06, .42], "#667c82");
        box(u, side * 1.18 - side * .22, 1.07, [.42, .25, .025], "#79aaa9");
      } });
    }
    box(0, side * .76, .073, [width * .8, .018, .035], "#d3ab65");
  }
  for (let i = -3; i <= 3; i++) {
    const u = i * width * .1;
    box(u, 0, .065, [width * .09, .018, 1.25], i % 2 ? "#718084" : "#65777d");
    for (const line of [-.24, 0, .24]) box(u, line, .078, [width * .065, .005, .012], "#455b65");
  }
}
