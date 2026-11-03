import type { PoolHost } from "@/lib/monitoring/types";
import * as THREE from "three";
import type { Builder, ModelName } from "./geometry";
import { machineRoomPlan, SERVER_ACTIVITY_COLORS, SERVER_RACK } from "./machineRoomLayout";
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
  for (let attempt = 0; attempt < 400 && trees.length < 22; attempt++) {
    const patch = patches[Math.floor(random() * patches.length)];
    const u = patch.u + between(-1.65, 1.65), v = patch.v + between(-.65, .65);
    if (!plantable(u, v) || trees.some(tree => Math.hypot(tree.u - u, tree.v - v) < .95)) continue;
    const kind = trees.length % 3, yaw = between(0, Math.PI * 2), spread = between(.95, 1.35);
    let height = between(1.7, 2.7);
    if (kind === 0) {
      const size = between(2.05, 2.9);
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
  // Dense root clusters blend into growth across the beds, without a planting grid.
  for (let attempt = 0, planted = 0; attempt < 700 && planted < 200; attempt++) {
    const tree = trees[Math.floor(random() * trees.length)], clustered = tree && random() < .55;
    const a = between(0, Math.PI * 2), distance = between(.35, 1.65);
    const u = clustered ? tree.u + Math.cos(a) * distance : between(-width * .39, width * .39);
    const v = clustered ? tree.v + Math.sin(a) * distance * .6 : (random() < .5 ? -1 : 1) * between(1.08, ring.depth / 2 - .55);
    if (!plantable(u, v)) continue;
    const reach = Math.min(Math.abs(v) - .72, ring.depth / 2 - .3 - Math.abs(v));
    const kind = random(), size = Math.min(between(.65, 1.35), reach * 1.5), spread = Math.min(size * .8, reach), yaw = between(0, Math.PI * 2);
    // Optional model loading must not leave holes in the understory.
    if (kind < .48) {
      if (!model("rainforestFern", size, u, v, .18, yaw)) tropicalPlant(b, point, u, v, size * .55, spread, yaw);
    } else if (kind < .7) {
      if (!model("rainforestBush", size * .85, u, v, .16, yaw)) b.object("rainforestBush", () => {
        b.ball(size * .45, xyz(u, v, .25 + size * .25), "#3f7046", [1.15, .7, 1]);
        tropicalPlant(b, point, u, v, size * .65, spread * .85, yaw);
      });
    } else tropicalPlant(b, point, u, v, between(.55, 1.25), spread, yaw);
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

export function addMachineRoom(b: Builder, layout: ShipLayout, cabin: ShipCabin, hosts?: readonly PoolHost[]) {
  const ring = layout.rings[cabin.ring], angle = cabinAngle(layout, cabin.slot), plan = machineRoomPlan(layout, cabin, hosts);
  const point = (u: number, v: number) => shipPoint(ring.radius + v, angle + u / ring.radius);
  const xyz = (u: number, v: number, y: number): [number, number, number] => { const p = point(u, v); return [p.x, y, p.z]; };
  const box = (u: number, v: number, y: number, size: [number, number, number], color: string, glow = false) => b.localBox(layout, cabin, u, v, y, size, color, 0, glow);
  const { first, last } = plan;

  for (const side of [-1, 1]) {
    const bank = plan.rows.filter(row => row.v * side > 0).map(row => row.v);
    b.annulus(ring.radius + Math.min(...bank) - .5, ring.radius + Math.max(...bank) + .5,
      angle + (first - .5) / ring.radius, angle + (last + .5) / ring.radius, .06, .035, "#344b58");
    for (const v of [side * .91, side * (ring.depth / 2 - .24)]) {
      b.annulus(ring.radius + v, ring.radius + v + .025, angle + (first - .5) / ring.radius,
        angle + (last + .5) / ring.radius, .102, .012, v === side * .91 ? "#68bfce" : "#526775", true);
    }
  }
  for (const rack of plan.racks) {
    const { u, v, face, row, column } = rack, front = v + face * .455;
    const inactive = !rack.host?.active;
    b.object(rack.host ? "serverRack" : "spareServerRack", () => {
      box(u, v, .16, [.9, .18, .94], "#52646f");
      box(u, v, 1.19, [SERVER_RACK.width, SERVER_RACK.height, SERVER_RACK.depth], inactive ? "#46515a" : "#1b303f");
      box(u, v, 2.3, [.88, .065, .91], rack.color || "#536c78");
      for (const edge of [-.39, .39]) box(u + edge, front, 1.22, [.035, 2.05, .05], "#6d8491");
      for (let slot = 0; slot < 9; slot++) {
        const y = .32 + slot * .216;
        box(u, front, y, [.73, .17, .045], slot % 2 ? "#2c4352" : "#223644");
        for (const vent of [-.25, -.15, -.05, .05]) box(u + vent, front + face * .027, y, [.035, .09, .015], "#0c1b27");
        box(u + .25, front + face * .03, y + .025, [.055, .035, .025], inactive ? "#63717a" : SERVER_ACTIVITY_COLORS[(row + column + slot) % 4], !inactive);
        box(u + .25, front + face * .03, y - .04, [.04, .014, .025], "#5e9ccb", true);
      }
      // Exposed cold/hot risers connect the rack to the overhead coolant loop.
      for (const pipe of [-1, 1]) b.curve([xyz(u + pipe * .34, v, .22), xyz(u + pipe * .34, v, 2.38), xyz(u + pipe * .34, v - face * .26, 2.46)], .025, pipe < 0 ? "#4ba8bc" : "#a56e61");
    }, rack.host?.alias);
    if (column % 4 === 1) b.furniture("machineFan", .52, point(u, v), 2.35, angle + u / ring.radius);
  }
  for (const family of plan.families) {
    b.sign(family.id === "local" ? "LOCAL" : family.id.toUpperCase(), "", point(family.u, family.v), angle + family.u / ring.radius, Math.min(2.3, family.width), family.color);
  }
  for (const row of plan.rows) {
    const v = row.v - row.face * .26;
    b.object("cables", () => {
      b.curve([xyz(first - .25, v, 2.47), xyz((first + last) / 2, v, 2.47), xyz(last + .55, v, 2.47), xyz(last + .6, v, .24)], .06, "#5896a8");
      b.curve([xyz(first - .25, v + .14, 2.47), xyz((first + last) / 2, v + .14, 2.47), xyz(last + .75, v + .14, 2.47), xyz(last + .8, v + .14, .24)], .035, "#b17e69");
    });
  }
  // One cooling skid at the end of the banks: reservoir pair, pumps and manifold.
  b.object("waterTank", () => {
    const u = plan.width * .33;
    box(u, -1.85, .17, [2.05, .22, 1.2], "#3f5665");
    for (const offset of [-.53, .53]) {
      b.cylinder(.32, 1.72, xyz(u + offset, -1.87, 1.11), "#537b8a", 20);
      for (const y of [.27, 1.98]) b.cylinder(.35, .1, xyz(u + offset, -1.87, y), "#97b4bc", 20);
      box(u + offset, -1.51, 1.13, [.13, 1.35, .035], "#5ed4da", true);
      b.curve([xyz(u + offset, -1.87, 2.05), xyz(u + offset, -2.5, 2.25), xyz(last + .65, -2.45, 2.47)], .06, "#5996a8");
    }
    box(u, -1.16, .46, [1.65, .36, .39], "#263f50");
    for (const x of [-.5, 0, .5]) box(u + x, -1.16, .66, [.18, .035, .22], "#9cb6bd");
  });
  // One shared side console, with a central interactive screen and two wings.
  const console = plan.console, p = point(console.u, console.v);
  const consoleBox = (x: number, z: number, y: number, size: [number, number, number], color: string, glow = false) => {
    const q: [number, number, number] = [p.x + x * Math.cos(console.angle) + z * Math.sin(console.angle), y,
      p.z - x * Math.sin(console.angle) + z * Math.cos(console.angle)];
    b.box(size, q, color, console.angle, glow);
  };
  b.object("machineConsole", () => {
    consoleBox(0, 0, .49, [plan.console.width - .12, .86, .9], "#435f70");
    consoleBox(0, .03, .97, [plan.console.width, .13, 1.12], "#75949d");
    consoleBox(0, .04, 1.06, [plan.console.width - .1, .035, 1.02], "#1b3242");
    for (const x of [-plan.console.width * .32, 0, plan.console.width * .32]) {
      consoleBox(x, -.05, 1.3, [.07, .42, .06], "#627d89");
      consoleBox(x, .1, 1.62, [.8, .59, .13], "#223e50");
      consoleBox(x, .18, 1.62, [.72, .49, .025], "#327185", true);
      // Decorative graphs; the main screen opens the real host data.
      for (let n = 0; n < 5; n++) consoleBox(x - .26 + n * .13, .2, 1.53 + Math.sin(n * 1.8 + x) * .065, [.06, .12 + n * .015, .015], "#74c9d2", true);
      consoleBox(x, .33, 1.09, [.5, .025, .24], "#527485");
    }
    consoleBox(0, .6, .97, [plan.console.width - .2, .03, .025], "#66cbd7", true);
  });
  for (let u = first; u <= last; u += 1.1) {
    box(u, 0, .071, [1, .025, 1.6], "#536b79");
    for (const v of [-.42, -.14, .14, .42]) box(u, v, .088, [.76, .008, .025], "#2d4655");
  }
  // Four material batches blink out of phase; no per-rack lights or frame work.
  for (const batch of b.groups.values()) {
    const phase = SERVER_ACTIVITY_COLORS.findIndex(color => batch.material.color.getHexString() === color.slice(1));
    if (phase >= 0) batch.material.userData.serverActivityPhase = phase * 1.7;
  }
}
