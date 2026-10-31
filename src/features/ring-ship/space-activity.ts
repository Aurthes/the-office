// Fixed pools: encounters reuse these slots instead of spawning scene objects.
export const SPACE_ACTIVITY_BUDGET = { asteroids: 18, ships: 3, dust: 64, drawCalls: 4 } as const;
export type SpaceMotion = { elapsed: number; planetApproach: number; planetPass: number };
export type SpaceEncounter = { trafficProgress: number; trafficCount: number; trafficLane: number; trafficDirection: number; planetApproach: number; planetPass: number; label: string };
export type SpacePose = { x: number; y: number; z: number; rx: number; ry: number; rz: number; sx: number; sy: number; sz: number; opacity: number };
export const emptySpaceMotion = (): SpaceMotion => ({ elapsed: 0, planetApproach: 0, planetPass: 0 });
export const emptySpaceEncounter = (): SpaceEncounter => ({ trafficProgress: 0, trafficCount: 0, trafficLane: 0, trafficDirection: 1, planetApproach: 0, planetPass: 0, label: "Cruising" });
export const emptySpacePose = (): SpacePose => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1, opacity: 1 });

const TAU = Math.PI * 2, length = Math.hypot(70, 73, 94), flat = Math.hypot(70, 94);
const fx = -70 / length, fy = -73 / length, fz = -94 / length;
const rx = 94 / flat, rz = -70 / flat;
const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
const fraction = (value: number) => value - Math.floor(value);
const random = (value: number, seed: number) => fraction(Math.sin(value * 12.9898 + seed * 78.233) * 43758.5453);
const smooth = (low: number, high: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};
const envelope = (p: number) => smooth(0, .1, p) * (1 - smooth(.88, 1, p));

function position(out: SpacePose, horizontal: number, vertical: number, depth: number) {
  out.x = rx * horizontal + ux * vertical + fx * depth;
  out.y = uy * vertical + fy * depth;
  out.z = rz * horizontal + uz * vertical + fz * depth;
}

// Deterministic, varied windows. No event queue, timers, or accumulated history.
export function sampleSpaceEncounter(time: number, seed: number, out: SpaceEncounter) {
  const cycle = Math.floor(time / 80), local = time % 80;
  const start = 8 + random(cycle + 7, seed) * 12, duration = 22 + random(cycle + 17, seed) * 6;
  const progress = (local - start) / duration;
  out.trafficProgress = Math.max(0, Math.min(1, progress));
  out.trafficCount = progress >= 0 && progress < 1 ? 1 + Math.floor(random(cycle + 31, seed) * SPACE_ACTIVITY_BUDGET.ships) : 0;
  out.trafficLane = random(cycle + 47, seed);
  out.trafficDirection = random(cycle + 53, seed) > .5 ? 1 : -1;
  const orbit = Math.floor(time / 180), approach = (time % 180 - 28 - random(orbit + 71, seed) * 22) / 58;
  const p = Math.max(0, Math.min(1, approach)), wave = seed ? Math.sin(Math.PI * p) : 0;
  out.planetApproach = wave * wave;
  out.planetPass = Math.sin(TAU * p) * wave;
  out.label = out.trafficCount > 1 ? "Convoy passing" : out.trafficCount ? "Passing ship" : out.planetApproach > .08 ? "Planetary approach" : "Cruising";
  return out;
}

export function advanceSpaceMotion(motion: SpaceMotion, delta: number, seed: number, encounter: SpaceEncounter) {
  motion.elapsed += Math.min(delta, .1);
  sampleSpaceEncounter(motion.elapsed, seed, encounter);
  motion.planetApproach = encounter.planetApproach; motion.planetPass = encounter.planetPass;
  return encounter;
}

export function sampleAsteroid(index: number, time: number, seed: number, radius: number, out: SpacePose) {
  const progress = fraction(time / (65 + random(index + 3, seed) * 50) + random(index + 11, seed));
  const cycle = Math.floor(time / (65 + random(index + 3, seed) * 50) + random(index + 11, seed));
  const angle = random(index + cycle * 19 + 23, seed) * TAU;
  const lane = .35 + random(index + cycle * 13 + 37, seed) * .65;
  const spread = Math.max(60, radius * 1.7) * lane * (.5 + progress);
  position(out, Math.cos(angle) * spread, Math.sin(angle) * spread * .7, radius + 50 + (1 - progress) * 80);
  const scale = (.35 + random(index + cycle * 29 + 43, seed) * .95) * (1 + progress * .4) * envelope(progress);
  out.sx = scale; out.sy = scale * (.7 + random(index + 59, seed) * .5); out.sz = scale * (1.1 + random(index + 61, seed) * .8);
  out.rx = random(index + 67, seed) * TAU + time * .03;
  out.ry = random(index + 73, seed) * TAU + time * .05;
  out.rz = random(index + 79, seed) * TAU + time * .018;
  out.opacity = envelope(progress);
  return out;
}

export function samplePassingShip(index: number, encounter: SpaceEncounter, radius: number, out: SpacePose) {
  const p = encounter.trafficProgress, direction = encounter.trafficDirection, span = Math.max(80, radius * 2);
  position(out, ((p * 4 - 2) * span - index * 12) * direction, (encounter.trafficLane - .5) * radius * 1.3 + index * 2, radius + 70 + index * 7);
  const scale = index < encounter.trafficCount ? envelope(p) * .8 : 0;
  out.sx = scale * (encounter.trafficCount === 1 ? .8 : 1.1); out.sy = scale; out.sz = scale;
  out.rx = 0; out.ry = Math.atan2(-rx * direction, -rz * direction); out.rz = 0;
  out.opacity = envelope(p);
  return out;
}

export function writeSpaceDust(time: number, seed: number, radius: number, positions: Float32Array, colors: Float32Array) {
  for (let i = 0; i < SPACE_ACTIVITY_BUDGET.dust; i++) {
    const progress = fraction(time * .04 + random(i + 101, seed));
    const angle = random(i + 113, seed) * TAU, spread = Math.max(70, radius * 2) * (.15 + progress * 1.6);
    const h = Math.cos(angle) * spread, v = Math.sin(angle) * spread * .7, depth = radius + 55 + (1 - progress) * 90;
    const offset = i * 3, fade = envelope(progress);
    positions[offset] = rx * h + ux * v + fx * depth;
    positions[offset + 1] = uy * v + fy * depth;
    positions[offset + 2] = rz * h + uz * v + fz * depth;
    colors[offset] = fade * .6; colors[offset + 1] = fade * .75; colors[offset + 2] = fade;
  }
}
