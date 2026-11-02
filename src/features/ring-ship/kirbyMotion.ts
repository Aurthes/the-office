import { normalizeDuckAppearance, type DuckAppearance } from "@/lib/avatars/duck";
import { crewRadius, moveCharacter, occupiedWaypoint, type CharacterBody } from "./characterCollision";
import { advanceCompanion, companionBody, createCompanionState, type CompanionState } from "./companionMotion";
import { canvasPoint, worldPoint, type MovingAgent } from "./crewMotion";
import type { ShipLayout, ShipPoint } from "./layout";

export const KIRBY_RANGE = 3.5;
export const KIRBY_HOLD_MS = 5000;
const INHALE_MS = 1100, SPIT_MS = 750, COOLDOWN_MS = 14000;
export type KirbyState = {
  actor: CompanionState;
  phase: "wander" | "approach" | "inhale" | "holding" | "spit";
  since: number; cooldownUntil: number;
  // One slot is shared by approach, inhale, holding and spit. No second target
  // can be selected until this slot has been released.
  victim: { id: string; name: string; appearance: DuckAppearance; origin: ShipPoint; landing: ShipPoint } | null;
};
export function createKirbyState(layout: ShipLayout, seed: number, radius?: number): KirbyState {
  return { actor: createCompanionState("kirby", layout, seed, radius), phase: "wander", since: 0, cooldownUntil: 0, victim: null };
}
function eligible(agent: MovingAgent, layout: ShipLayout, chatId?: string | null) {
  return agent.status === "idle" && !agent.needsInput && agent.id !== chatId && layout.seats[agent.id]?.deck === 0;
}
function onFloor(point: ShipPoint, layout: ShipLayout) {
  const radius = Math.hypot(point.x, point.z);
  return layout.rings.some(ring => Math.abs(radius - ring.radius) < ring.depth / 2 - .45)
    || layout.spokes.some(angle => radius > 3.2 && radius < layout.radius && Math.abs(point.x * Math.cos(angle) - point.z * Math.sin(angle)) < .55);
}
function landingPoint(state: KirbyState, agent: MovingAgent, layout: ShipLayout, others: readonly CharacterBody[]) {
  const actor = state.actor, radius = crewRadius(agent), body = { id: agent.id, position: actor.position, radius, deck: 0 };
  const obstacles = [...others.filter(other => other.id !== agent.id), companionBody(actor)];
  for (const extra of [.25, .65, 1.2, 1.8]) for (const turn of [0, .5, -.5, 1, -1, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const distance = actor.radius + radius + extra, angle = actor.facing + turn;
    const point = { x: actor.position.x + Math.sin(angle) * distance, z: actor.position.z + Math.cos(angle) * distance };
    if (onFloor(point, layout) && !occupiedWaypoint(body, point, obstacles)) return point;
  }
  const origin = state.victim!.origin;
  return !occupiedWaypoint(body, origin, obstacles) ? origin : undefined;
}
export function resetKirby(state: KirbyState, crew: readonly MovingAgent[], now: number) {
  for (const agent of crew) if (agent.id === state.victim?.id) delete agent.kirbyPose;
  state.victim = null; state.phase = "wander"; state.since = now; state.cooldownUntil = now + COOLDOWN_MS;
  state.actor.route = []; state.actor.action = "idle"; state.actor.time = 0;
}
function beginSpit(state: KirbyState, agent: MovingAgent, layout: ShipLayout, now: number, others: readonly CharacterBody[]) {
  const landing = landingPoint(state, agent, layout, others);
  if (!landing) return false;
  state.victim!.landing = landing; state.phase = "spit"; state.since = now;
  return true;
}

export function advanceKirby(state: KirbyState, crew: readonly MovingAgent[], layout: ShipLayout, now: number, elapsed: number, others: readonly CharacterBody[], chatId?: string | null) {
  const dt = Math.min(Math.max(elapsed, 0), .05), actor = state.actor;
  if (!dt) return;
  actor.time += dt;
  let victim = state.victim && crew.find(agent => agent.id === state.victim!.id);
  if (state.victim && (!victim || layout.seats[victim.id]?.deck !== 0)) { resetKirby(state, crew, now); return; }
  if (victim && !eligible(victim, layout, chatId) && state.phase !== "spit") {
    if (state.phase === "approach") { resetKirby(state, crew, now); return; }
    if (!beginSpit(state, victim, layout, now, others)) { resetKirby(state, crew, now); return; }
  }
  if (state.phase === "wander") {
    // Idle animation and movement use the existing companion routes/collisions.
    actor.time -= dt; advanceCompanion(actor, layout, dt, others);
    if (now < state.cooldownUntil) return;
    victim = crew.filter(agent => eligible(agent, layout, chatId) && !agent.kirbyPose)
      .filter(agent => Math.hypot(worldPoint(agent).x - actor.position.x, worldPoint(agent).z - actor.position.z) <= KIRBY_RANGE)
      .sort((a, b) => Math.hypot(worldPoint(a).x - actor.position.x, worldPoint(a).z - actor.position.z) - Math.hypot(worldPoint(b).x - actor.position.x, worldPoint(b).z - actor.position.z))[0];
    if (!victim) return;
    const origin = worldPoint(victim);
    state.victim = { id: victim.id, name: victim.name, appearance: normalizeDuckAppearance(victim.avatarProfile?.duck), origin, landing: origin };
    state.phase = "approach"; state.since = now; actor.route = []; actor.action = "wander";
  }
  if (!victim || !state.victim) return;
  if (state.phase === "approach") {
    const point = worldPoint(victim), dx = point.x - actor.position.x, dz = point.z - actor.position.z, distance = Math.hypot(dx, dz);
    if (distance > KIRBY_RANGE * 1.6 || now - state.since > 8000) { resetKirby(state, crew, now); return; }
    actor.facing = Math.atan2(dx, dz);
    const next = moveCharacter(companionBody(actor), point, dt * .9, others);
    actor.position.x = next.x; actor.position.z = next.z;
    if (distance <= actor.radius + crewRadius(victim) + .3) {
      state.victim.origin = point; state.phase = "inhale"; state.since = now;
      actor.action = "idle";
    } else return;
  }
  const mouth = { x: actor.position.x + Math.sin(actor.facing) * .48, z: actor.position.z + Math.cos(actor.facing) * .48 };
  if (state.phase === "inhale") {
    const t = Math.min(1, (now - state.since) / INHALE_MS), pull = t * t;
    victim.kirbyPose = { x: state.victim.origin.x + (mouth.x - state.victim.origin.x) * pull,
      z: state.victim.origin.z + (mouth.z - state.victim.origin.z) * pull, y: .08 + Math.sin(t * Math.PI) * .45 + t * .5,
      scale: 1 - .96 * pull, tilt: Math.sin(t * Math.PI * 5) * .35, hidden: t >= 1 };
    if (t >= 1) { state.phase = "holding"; state.since = now; }
  }
  if (state.phase === "holding") {
    victim.kirbyPose = { ...mouth, y: .6, scale: .04, tilt: 0, hidden: true };
    if (now - state.since >= KIRBY_HOLD_MS) beginSpit(state, victim, layout, now, others);
  }
  if (state.phase === "spit") {
    // Recheck the landing throughout the arc; a walker may have entered it.
    const landing = landingPoint(state, victim, layout, others);
    if (landing) state.victim.landing = landing;
    const t = Math.min(1, (now - state.since) / SPIT_MS), point = state.victim.landing;
    victim.kirbyPose = { x: mouth.x + (point.x - mouth.x) * t, z: mouth.z + (point.z - mouth.z) * t,
      y: .08 + Math.sin(t * Math.PI) * .7 + (1 - t) * .5, scale: .04 + .96 * Math.min(1, t * 2), tilt: Math.sin(t * Math.PI) * -.7, hidden: false };
    if (t >= 1 && landing) {
      Object.assign(victim, canvasPoint(point)); victim.pauseUntil = now + 2500;
      resetKirby(state, crew, now);
    }
  }
}

export function kirbyActivity(state: KirbyState) {
  if (state.phase === "approach") return "Inspecting a suspiciously idle crew member";
  if (state.phase === "inhale") return "One idle crew member, coming right up!";
  if (state.phase === "holding") return "A five-second break in the belly. Poyo!";
  if (state.phase === "spit") return "Break over! Returning the crew member";
  if (state.actor.route.length) return "Patrolling for idle crew. Poyo!";
  return "A little wiggle, a little hop. Poyo!";
}
