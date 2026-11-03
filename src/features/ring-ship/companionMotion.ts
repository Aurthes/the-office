import { cabinAngle, routeBetweenCabins, shipPoint, type ShipCabin, type ShipLayout, type ShipPoint } from "./layout";
import { BAR_LAYOUT, barPoint } from "./barLayout";
import { moveCharacter, occupiedWaypoint, separateCharacter, walkCharacter, type CharacterBody, type CharacterRecovery } from "./characterCollision";
import { footingRadius, walkableSegment } from "./walkableSurface";

export type CompanionKind = "cat" | "dog" | "drone" | "bartender" | "kirby" | "dumu" | "dufu";
export type CompanionAction = "idle" | "wander" | "run" | "sniff" | "sit" | "sleep" | "stretch" | "groom" | "patrol" | "scan" | "repair" | "charge" | "wash" | "inventory" | "pour" | "wipe";
export type CompanionState = {
  kind: CompanionKind; action: CompanionAction; time: number; duration: number;
  position: ShipPoint; facing: number; y: number; speed: number;
  cabinId: string; destinationId: string; route: ShipPoint[]; waypoint: number;
  seed: number; cycles: number; radius: number;
  progress?: { position: ShipPoint; elapsed: number };
  recovery?: CharacterRecovery; walking?: boolean;
};
export const COMPANION_NAMES: Record<CompanionKind, string> = { cat: "MOCHI", dog: "BISCUIT", drone: "PATCH-7", bartender: "C.O.R.E.", kirby: "Kirby", dumu: "嘟母", dufu: "嘟父" };
const RADII: Record<CompanionKind, number> = { cat: .42, dog: .5, drone: .62, bartender: .55, kirby: .78, dumu: .56, dufu: .56 };
export function companionBody(state: CompanionState): CharacterBody {
  return { id: `npc:${state.kind}`, position: state.position, radius: state.radius, deck: 0 };
}
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
  state.progress = { position: { ...state.position }, elapsed: 0 };
}

export function createCompanionState(kind: CompanionKind, layout: ShipLayout, seed: number, radius = RADII[kind]): CompanionState {
  const cabin = layout.cabins.find(c => c.deck === 0 && c.kind === (kind === "drone" ? "maintenance" : kind === "bartender" ? "bar" : "lounge"));
  if (!cabin) throw new Error(`Missing companion cabin: ${kind}`);
  const position = kind === "bartender" ? barPoint(layout, cabin, -.7, BAR_LAYOUT.staffZ)
    : kind === "kirby" ? companionPoint(layout, cabin, 2.1, -.35)
    : companionPoint(layout, cabin, kind === "cat" ? -.85 : kind === "dog" ? .9 : 0, kind === "drone" ? -.6 : -.15);
  return { kind, action: kind === "bartender" ? "wash" : kind === "drone" ? "scan" : "idle", time: 0,
    duration: kind === "kirby" ? 1.5 : kind === "cat" ? 2.5 : kind === "dog" ? 4 : 8, position, facing: cabinAngle(layout, cabin.slot) + (kind === "bartender" ? Math.PI : kind === "cat" ? 1.1 : -1.1),
    y: kind === "bartender" ? .8 : kind === "drone" ? .65 : .09, speed: .65,
    cabinId: cabin.id, destinationId: cabin.id, route: [], waypoint: 0, seed: seed >>> 0, cycles: 0, radius };
}

function nextAction(state: CompanionState, layout: ShipLayout, others: readonly CharacterBody[]) {
  const previous = state.action, cabin = cabinFor(state, layout), ring = layout.rings[cabin.ring];
  state.cycles++; state.time = 0;
  if (state.kind === "cat" || state.kind === "dog" || state.kind === "kirby" || state.kind === "dumu" || state.kind === "dufu") {
    state.action = state.kind === "kirby" ? "wander" : previous === "sleep" ? "stretch" : pick(state, PET_ACTIONS);
    if (state.action === previous) state.action = "wander";
    state.duration = state.action === "sleep" ? 16 + random(state) * 14 : 4 + random(state) * 7;
    if (state.action === "wander" || state.action === "run") {
      // The duo controller chooses shared room visits; local strolls stay independent.
      const roomVisit = state.kind !== "dumu" && state.kind !== "dufu" && state.action !== "run" && random(state) < .24;
      const rooms = layout.cabins.filter(c => c.deck === 0 && ["lounge", "garden", "canteen", "hydroponics"].includes(c.kind));
      let destination = roomVisit ? pick(state, rooms.filter(c => c.id !== cabin.id)) : cabin;
      const angle = Math.atan2(state.position.x, state.position.z);
      const localPoint = () => companionPoint(layout, cabin, (random(state) - .5) * Math.min(state.kind === "kirby" ? 6 : 4, ring.radius * Math.PI * 2 / layout.allocation.sectors * (state.kind === "kirby" ? .6 : .45)));
      let point = destination.id === cabin.id ? localPoint() : null;
      if (state.kind === "kirby" && point) {
        // Pick somewhere free to explore instead of repeatedly approaching a
        // spot occupied by a resting pet or another crew member.
        for (let attempt = 0; attempt < 8 && occupiedWaypoint(companionBody(state), point, others); attempt++) point = localPoint();
        if (occupiedWaypoint(companionBody(state), point, others)) destination = pick(state, rooms.filter(c => c.id !== cabin.id));
      }
      const route = destination.id === cabin.id
        ? [shipPoint(ring.radius, angle), point!]
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
    travel(state, [barPoint(layout, cabin, x, BAR_LAYOUT.staffZ)], cabin, .5);
  }
}

export function advanceCompanion(state: CompanionState, layout: ShipLayout, elapsed: number, others: readonly CharacterBody[] = []) {
  const dt = Math.min(Math.max(elapsed, 0), .05), target = state.route[state.waypoint];
  if (!dt) return;
  const before={...state.position};
  Object.assign(state.position, moveCharacter(companionBody(state), state.position, 0, others, true, layout));
  if (target) {
    const dx = target.x - state.position.x, dz = target.z - state.position.z, distance = Math.hypot(dx, dz), step = state.speed * dt;
    if (distance > .001) {
      const next = state.kind === "bartender" ? moveCharacter(companionBody(state),target,step,others,false,layout)
        : walkCharacter(state,companionBody(state),target,step,dt,others,layout);
      state.position.x = next.x; state.position.z = next.z;
    }
    const body = companionBody(state);
    const reached = Math.hypot(target.x - state.position.x, target.z - state.position.z) <= .001;
    const following = state.route[state.waypoint + 1];
    const closeEnough = state.kind !== "bartender" && distance < body.radius * 2 + .15 && occupiedWaypoint(body, target, others)
      && (!following || walkableSegment(state.position, following, layout, footingRadius(body.radius)));
    if (reached || closeEnough) state.progress = { position: { ...state.position }, elapsed: 0 };
    if ((reached || closeEnough) && ++state.waypoint >= state.route.length) {
      state.route = []; state.waypoint = 0; state.cabinId = state.destinationId; state.time = 0;
      if (state.kind === "cat" || state.kind === "dog" || state.kind === "dumu" || state.kind === "dufu") { state.action = "sniff"; state.duration = 2 + random(state) * 3; }
      if (state.kind === "kirby") { state.action = pick(state, ["stretch", "sit", "groom"]); state.duration = 1.5 + random(state) * 2; }
      if (state.kind === "drone" && state.action === "patrol") { state.action = "scan"; state.duration = 7; }
    }
    // A blocked stroll can pick another destination, but only from a cabin.
    // Never abandon a bridge midway or cut across the space beside it.
    if (state.route.length && state.kind !== "bartender") {
      const progress = state.progress ||= { position: { ...state.position }, elapsed: 0 };
      progress.elapsed += dt;
      if (progress.elapsed >= 4) {
        const ring = layout.rings.find(r => Math.abs(Math.hypot(state.position.x, state.position.z) - r.radius) < r.depth / 2 - .45);
        const gained = Math.hypot(target.x - progress.position.x, target.z - progress.position.z) - Math.hypot(target.x - state.position.x, target.z - state.position.z);
        if (ring && gained < .3) {
          const angle = Math.atan2(state.position.x, state.position.z);
          const slot = ((Math.floor(angle / (Math.PI * 2) * layout.allocation.sectors) % layout.allocation.sectors) + layout.allocation.sectors) % layout.allocation.sectors;
          const cabin = layout.cabins.find(c => c.deck === 0 && c.ring === ring.index && c.slot === slot)!;
          state.cabinId = cabin.id; state.route = []; state.time = state.duration;
        }
        state.progress = { position: { ...state.position }, elapsed: 0 };
      }
    }
  } else {
    state.recovery=undefined;
    if (state.kind !== "bartender") {
      const next = separateCharacter(companionBody(state), state.speed * dt, others, layout,.2);
      state.position.x = next.x; state.position.z = next.z;
    }
    state.time += dt;
    if (state.time >= state.duration) nextAction(state, layout, others);
    if (state.kind === "bartender" || state.kind === "drone") {
      const target = companionWorkPoint(state, layout);
      const facing = Math.atan2(target.x - state.position.x, target.z - state.position.z);
      state.facing += Math.atan2(Math.sin(facing - state.facing), Math.cos(facing - state.facing)) * Math.min(1, dt * 4);
    }
  }
  const targetY = state.kind === "drone" ? state.action === "charge" && !state.route.length ? .2 : .65 : state.kind === "bartender" ? .8 : .09;
  state.y += (targetY - state.y) * Math.min(1, dt * 3);
  state.walking=Math.hypot(state.position.x-before.x,state.position.z-before.z)>.00001;
  if(state.walking){const facing=Math.atan2(state.position.x-before.x,state.position.z-before.z);state.facing+=Math.atan2(Math.sin(facing-state.facing),Math.cos(facing-state.facing))*Math.min(1,dt*10);}
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
