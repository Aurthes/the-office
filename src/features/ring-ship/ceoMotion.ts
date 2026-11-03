import { CEO_ID } from "@/lib/office/organization";
import { cabinAngle, routeBetweenCabins, shipPoint, type ShipCabin, type ShipLayout, type ShipPoint } from "./layout";
import { moveCharacter, occupiedWaypoint, type CharacterBody } from "./characterCollision";
import { footingRadius, isWalkable, walkableSegment } from "./walkableSurface";
import { monitorChairPose } from "./monitor-room-geometry";

export type CeoAction = "monitor" | "stretch" | "review" | "window" | "coffee" | "patrol" | "think" | "celebrate";
export type CeoState = {
  action: CeoAction; time: number; elapsed: number; duration: number; routine: number; seed: number; tours: number;
  position: ShipPoint; facing: number; walking: boolean; radius: number;
  cabinId: string; destinationId: string; route: ShipPoint[]; waypoint: number; blocked: number;
};
const ROUTINE: CeoAction[] = ["monitor", "stretch", "review", "window", "coffee", "patrol", "monitor", "think"];
const DURATIONS: Record<CeoAction, number> = { monitor: 12, stretch: 4, review: 8, window: 6, coffee: 9, patrol: 5, think: 5, celebrate: 3 };
export const CEO_ACTIVITIES: Record<CeoAction, string> = {
  monitor: "Watching the fleet monitors and checking the controls",
  stretch: "A very necessary executive stretch",
  review: "Reviewing the ship's ambitious to-do list",
  window: "Looking at the stars. Thinking big thoughts.",
  coffee: "Coffee first. Galactic domination later.",
  patrol: "Checking in on the crew",
  think: "Considering an extremely important decision",
  celebrate: "A tiny victory dance. Nobody saw that.",
};
export function ceoHome(layout: ShipLayout) { return layout.cabins.find(c => c.kind === "monitor") || layout.cabins.find(c => c.kind === "lounge") || layout.cabins[0]; }
export function ceoBody(state: CeoState): CharacterBody { return { id: CEO_ID, position: state.position, radius: state.radius, deck: 0 }; }
function random(state: CeoState) { state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0; return state.seed / 4294967296; }
function point(layout: ShipLayout, cabin: ShipCabin, u: number, v: number) {
  const ring = layout.rings[cabin.ring];
  // Stay on the supported part of the tapered cabin floor.
  for (let radial = v; Math.abs(radial) > .05; radial *= .8) {
    const p = shipPoint(ring.radius + radial, cabinAngle(layout, cabin.slot) + u / ring.radius);
    if (isWalkable(p, layout, .4)) return p;
  }
  return shipPoint(ring.radius, cabinAngle(layout, cabin.slot) + u / ring.radius);
}
function rear(layout: ShipLayout, home: ShipCabin) { return point(layout, home, -.9, 2.05); }
function door(layout: ShipLayout, home: ShipCabin) { return point(layout, home, -4, 0); }

export function createCeoState(layout: ShipLayout, seed: number, radius = .43): CeoState {
  const home = ceoHome(layout), chair = monitorChairPose(layout, home);
  return { action: "monitor", time: 0, elapsed: 0, duration: 5, routine: 0, seed, tours: 0,
    position: { ...chair.point }, facing: chair.facing, walking: false, radius,
    cabinId: home.id, destinationId: home.id, route: [], waypoint: 0, blocked: 0 };
}
function nextAction(state: CeoState, layout: ShipLayout) {
  const home = ceoHome(layout), source = layout.cabins.find(c => c.id === state.cabinId) || home;
  if (state.action !== "celebrate") state.routine = (state.routine + 1) % ROUTINE.length;
  const action = state.action === "think" && random(state) < .35 ? "celebrate" : ROUTINE[state.routine];
  state.action = action; state.time = 0; state.duration = DURATIONS[action] * (.8 + random(state) * .4); state.blocked = 0;
  let destination = home;
  if (action === "patrol") {
    const departments = layout.cabins.filter(c => c.deck === 0 && c.kind === "work" && c.agentIds.length);
    if (departments.length) destination = departments[state.tours++ % departments.length];
  }
  let target = action === "monitor" ? monitorChairPose(layout, home).point : action === "review" ? point(layout, home, -1.55, 1.65)
    : action === "window" ? point(layout, home, 0, layout.rings[home.ring].depth / 2 - .65)
    : action === "coffee" ? point(layout, home, 1.5, 1.9) : rear(layout, home);
  if (destination !== home) target = shipPoint(layout.rings[destination.ring].radius, cabinAngle(layout, destination.slot));
  const route: ShipPoint[] = [];
  if (source.id !== destination.id) {
    if (source.id === home.id) route.push(rear(layout, home), point(layout, home, -4, 1.3), door(layout, home));
    const start = route.at(-1) || state.position;
    const arrival = destination.id === home.id ? Math.atan2(door(layout, home).x, door(layout, home).z) : cabinAngle(layout, destination.slot);
    route.push(...routeBetweenCabins(layout, { ring: source.ring, angle: Math.atan2(start.x, start.z) }, destination, arrival));
    if (destination.id === home.id) route.push(point(layout, home, -4, 1.3), rear(layout, home));
  } else if (source.id === home.id) route.push(rear(layout, home));
  route.push(target);
  state.destinationId = destination.id; state.route = route; state.waypoint = 0;
}

export function advanceCeo(state: CeoState, layout: ShipLayout, elapsed: number, others: readonly CharacterBody[] = []) {
  const dt = Math.min(Math.max(elapsed, 0), .05); if (!dt) return;
  state.elapsed += dt; state.walking = false;
  const target = state.route[state.waypoint];
  if (target) {
    const before = state.position, body = ceoBody(state), distance = Math.hypot(target.x - before.x, target.z - before.z);
    const last = state.waypoint === state.route.length - 1, following = state.route[state.waypoint + 1];
    // An occupied stop cannot be reached exactly. Pass an optional waypoint
    // only when the next leg has floor; the command chair must actually clear.
    const nearbyCrew = distance < state.radius * 3 + .3 && occupiedWaypoint(body, target, others)
      && !occupiedWaypoint(body, before, others);
    if (nearbyCrew) {
      const canContinue = following && walkableSegment(before, following, layout, footingRadius(state.radius));
      if (canContinue || (last && state.action !== "monitor")) {
        state.waypoint++; state.blocked = 0;
        if (state.waypoint === state.route.length) { state.route = []; state.cabinId = state.destinationId; }
      } else state.blocked += dt;
      return;
    }
    const next = moveCharacter(body, target, dt * .9, others, true, layout);
    const moved = Math.hypot(next.x - before.x, next.z - before.z);
    state.position = next; state.walking = moved > 1e-6;
    if (state.walking) {
      const facing = Math.atan2(next.x - before.x, next.z - before.z);
      state.facing += Math.atan2(Math.sin(facing - state.facing), Math.cos(facing - state.facing)) * Math.min(1, dt * 9);
    }
    state.blocked = moved < dt * .1 ? state.blocked + dt : 0;
    if (Math.hypot(next.x - target.x, next.z - target.z) < 1e-5) {
      state.waypoint++; state.blocked = 0;
      if (state.waypoint === state.route.length) { state.route = []; state.cabinId = state.destinationId; }
    }
    return;
  }
  state.time += dt;
  const cabin = layout.cabins.find(c => c.id === state.cabinId) || ceoHome(layout);
  const facing = cabinAngle(layout, cabin.slot) + (state.action === "review" ? .8 : state.action === "coffee" ? .3 : state.action === "window" || state.action === "celebrate" ? 0 : Math.PI);
  state.facing += Math.atan2(Math.sin(facing - state.facing), Math.cos(facing - state.facing)) * Math.min(1, dt * 4);
  if (state.time >= state.duration) nextAction(state, layout);
}
export function ceoActivity(state: CeoState) { return state.blocked > 1 ? "Patiently waiting for the corridor to clear" : state.route.length ? state.action === "patrol" ? "Taking a stroll to visit a department" : state.action === "monitor" ? "Heading back to the command chair" : "Stretching the legs between important decisions" : CEO_ACTIVITIES[state.action]; }
