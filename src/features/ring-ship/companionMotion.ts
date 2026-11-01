import { cabinAngle, routeBetweenCabins, shipPoint, type ShipCabin, type ShipLayout, type ShipPoint } from "./layout";
import { BAR_LAYOUT, barPoint } from "./barLayout";

export type CompanionKind = "cat" | "dog" | "drone" | "bartender";
export type CompanionAction = "idle" | "wander" | "run" | "sniff" | "sit" | "sleep" | "stretch" | "groom" | "patrol" | "scan" | "repair" | "charge" | "wash" | "inventory" | "pour" | "wipe";
export type CompanionState = {
  kind: CompanionKind; action: CompanionAction; time: number; duration: number;
  position: ShipPoint; facing: number; y: number; speed: number;
  cabinId: string; destinationId: string; route: ShipPoint[]; waypoint: number;
  seed: number; cycles: number;
};
export const COMPANION_NAMES: Record<CompanionKind, string> = { cat: "MOCHI", dog: "BISCUIT", drone: "PATCH-7", bartender: "C.O.R.E." };
const PET_ACTIONS: CompanionAction[] = ["wander", "wander", "run", "sniff", "sit", "sleep", "stretch", "groom"];
const DRONE_ACTIONS: CompanionAction[] = ["patrol", "scan", "repair", "scan", "charge"];
const BAR_ACTIONS: CompanionAction[] = ["wash", "inventory", "pour", "wipe", "wash", "idle"];

function random(state: CompanionState) {
  state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
  return state.seed / 4294967296;
}
function pick<T>(state: CompanionState, values: readonly T[]) { return values[Math.floor(random(state) * values.length)]; }
export function companionPoint(layout: ShipLayout, cabin: ShipCabin, tangent: number, radial = 0) {
  const ring = layout.rings[cabin.ring];
  return shipPoint(ring.radius + radial, cabinAngle(layout, cabin.slot) + tangent / ring.radius);
}
export function companionWorkPoint(state: CompanionState, layout: ShipLayout) {
  const cabin = cabinFor(state, layout);
  if (state.kind === "bartender") {
    const bottle = BAR_LAYOUT.bottles[Math.floor(state.time / 2) % BAR_LAYOUT.bottles.length];
    const x = state.action === "inventory" ? bottle.x : state.action === "pour" ? -.92 : state.action === "wipe" ? 2.03 + Math.sin(state.time * 2) * .14 : -1.1;
    const z = state.action === "wipe" ? -.15 + Math.cos(state.time * 2) * .1 : state.action === "inventory" ? .16 : -.1;
    return { ...barPoint(layout, cabin, x, z), y: state.action === "inventory" ? BAR_LAYOUT.counter + bottle.height + .1 : state.action === "wash" ? 1.53 : state.action === "wipe" ? 1.35 : 1.6 };
  }
  const ring = layout.rings[cabin.ring], width = ring.radius * Math.PI * 2 / layout.allocation.sectors;
  const difference = Math.atan2(Math.sin(Math.atan2(state.position.x, state.position.z) - cabinAngle(layout, cabin.slot)), Math.cos(Math.atan2(state.position.x, state.position.z) - cabinAngle(layout, cabin.slot)));
  const u = Math.round(difference * ring.radius / (width * .27)) * width * .27;
  return { ...companionPoint(layout, cabin, u, 1.15), y: 1.0 };
}
function cabinFor(state: CompanionState, layout: ShipLayout) { return layout.cabins.find(cabin => cabin.id === state.cabinId)!; }
function travel(state: CompanionState, points: ShipPoint[], destination: ShipCabin, speed: number) {
  state.route = points; state.waypoint = 0; state.destinationId = destination.id; state.speed = speed;
}

export function createCompanionState(kind: CompanionKind, layout: ShipLayout, seed: number): CompanionState {
  const cabin = layout.cabins.find(c => c.deck === 0 && c.kind === (kind === "drone" ? "maintenance" : "lounge"));
  if (!cabin) throw new Error(`Missing companion cabin: ${kind}`);
  const position = kind === "bartender" ? barPoint(layout, cabin, -.7, .42)
    : companionPoint(layout, cabin, kind === "cat" ? -.85 : kind === "dog" ? .9 : 0, kind === "drone" ? -.6 : -.15);
  return { kind, action: kind === "bartender" ? "wash" : kind === "drone" ? "scan" : "idle", time: 0,
    duration: kind === "cat" ? 2.5 : kind === "dog" ? 4 : 8, position, facing: cabinAngle(layout, cabin.slot) + (kind === "bartender" ? Math.PI : kind === "cat" ? 1.1 : -1.1),
    y: kind === "bartender" ? .8 : kind === "drone" ? .65 : .09, speed: .65,
    cabinId: cabin.id, destinationId: cabin.id, route: [], waypoint: 0, seed: seed >>> 0, cycles: 0 };
}

function nextAction(state: CompanionState, layout: ShipLayout) {
  const previous = state.action, cabin = cabinFor(state, layout), ring = layout.rings[cabin.ring];
  state.cycles++; state.time = 0;
  if (state.kind === "cat" || state.kind === "dog") {
    state.action = previous === "sleep" ? "stretch" : pick(state, PET_ACTIONS);
    if (state.action === previous) state.action = "wander";
    state.duration = state.action === "sleep" ? 16 + random(state) * 14 : 4 + random(state) * 7;
    if (state.action === "wander" || state.action === "run") {
      const roomVisit = state.action !== "run" && random(state) < .24;
      const rooms = layout.cabins.filter(c => c.deck === 0 && ["lounge", "garden", "canteen", "hydroponics"].includes(c.kind));
      const destination = roomVisit ? pick(state, rooms.filter(c => c.id !== cabin.id)) : cabin;
      const angle = Math.atan2(state.position.x, state.position.z);
      const route = destination.id === cabin.id
        ? [shipPoint(ring.radius, angle), companionPoint(layout, cabin, (random(state) - .5) * Math.min(4, ring.radius * Math.PI * 2 / layout.allocation.sectors * .45))]
        : routeBetweenCabins(layout, { ring: cabin.ring, angle }, destination);
      travel(state, route, destination, state.action === "run" ? 1.65 : .6);
    }
  } else if (state.kind === "drone") {
    state.action = pick(state, DRONE_ACTIONS);
    if (state.action === previous) state.action = "patrol";
    state.duration = 6 + random(state) * 7;
    const width = ring.radius * Math.PI * 2 / layout.allocation.sectors;
    const u = state.action === "charge" ? -width * .34 : (random(state) < .5 ? -1 : 1) * width * .23;
    travel(state, [companionPoint(layout, cabin, u, state.action === "charge" ? -1.0 : .6)], cabin, .75);
  } else {
    state.action = pick(state, BAR_ACTIONS);
    if (state.action === previous) state.action = state.action === "wash" ? "inventory" : "wash";
    state.duration = state.action === "idle" ? 3 : 8 + random(state) * 6;
    const x = state.action === "inventory" ? -1.45 : state.action === "pour" ? -.55 : state.action === "wipe" ? 1.65 : -.7;
    travel(state, [barPoint(layout, cabin, x, .42)], cabin, .5);
  }
}

export function advanceCompanion(state: CompanionState, layout: ShipLayout, elapsed: number) {
  const dt = Math.min(Math.max(elapsed, 0), .05), target = state.route[state.waypoint];
  if (!dt) return;
  if (target) {
    const dx = target.x - state.position.x, dz = target.z - state.position.z, distance = Math.hypot(dx, dz), step = state.speed * dt;
    if (distance > .001) {
      const facing = Math.atan2(dx, dz), difference = Math.atan2(Math.sin(facing - state.facing), Math.cos(facing - state.facing));
      state.facing += difference * Math.min(1, dt * 10);
      state.position.x += dx / distance * Math.min(step, distance); state.position.z += dz / distance * Math.min(step, distance);
    }
    if (distance <= step + .001 && ++state.waypoint >= state.route.length) {
      state.route = []; state.waypoint = 0; state.cabinId = state.destinationId; state.time = 0;
      if (state.kind === "cat" || state.kind === "dog") { state.action = "sniff"; state.duration = 2 + random(state) * 3; }
      if (state.kind === "drone" && state.action === "patrol") { state.action = "scan"; state.duration = 7; }
    }
  } else {
    state.time += dt;
    if (state.time >= state.duration) nextAction(state, layout);
    if (state.kind === "bartender" || state.kind === "drone") {
      const target = companionWorkPoint(state, layout);
      const facing = Math.atan2(target.x - state.position.x, target.z - state.position.z);
      state.facing += Math.atan2(Math.sin(facing - state.facing), Math.cos(facing - state.facing)) * Math.min(1, dt * 4);
    }
  }
  const targetY = state.kind === "drone" ? state.action === "charge" && !state.route.length ? .2 : .65 : state.kind === "bartender" ? .8 : .09;
  state.y += (targetY - state.y) * Math.min(1, dt * 3);
}

const ACTIVITY: Record<CompanionAction, string> = {
  idle: "Watching life aboard the ship", wander: "Exploring the ship", run: "A sudden case of the zoomies", sniff: "Investigating an interesting scent",
  sit: "Sitting and watching the crew", sleep: "Curled up for a little nap", stretch: "Enjoying a long stretch", groom: "A very important grooming break",
  patrol: "Making the maintenance rounds", scan: "Scanning equipment and pressure seals", repair: "Tightening a loose connection", charge: "Docked for a quick recharge",
  wash: "Washing and polishing a glass", inventory: "Checking the bottle stock", pour: "Pouring a fresh drink", wipe: "Wiping down the counter",
};
export function companionActivity(state: CompanionState) {
  if (state.route.length && state.kind === "bartender") return "Moving to the next bar station";
  if (state.route.length && state.kind === "drone") return ACTIVITY.patrol;
  return ACTIVITY[state.action];
}
