import { advanceCompanion, companionBody, companionPoint, createCompanionState, type CompanionState } from "./companionMotion";
import { moveCharacter, occupiedWaypoint, separateCharacter, type CharacterBody } from "./characterCollision";
import { cabinAngle, routeBetweenCabins, shipPoint, type ShipLayout, type ShipPoint } from "./layout";
import { footingRadius, isWalkable, walkableSegment } from "./walkableSurface";

export type DuduKind = "dumu" | "dufu";
export type DuduInteraction = "boop" | "highFive" | "cuddle" | "chase";
export type DuduState = {
  dogs: [CompanionState, CompanionState]; phase: "solo" | "meet" | "play" | "tour";
  interaction: DuduInteraction; elapsed: number; clock: number; cooldown: number; round: number; tourRound: number;
  center: ShipPoint; targets: [ShipPoint, ShipPoint]; orbitStart: number; seed: number;
};
const INTERACTIONS: DuduInteraction[] = ["boop", "highFive", "cuddle", "chase"];
const distance = (a: ShipPoint, b: ShipPoint) => Math.hypot(a.x - b.x, a.z - b.z);
function random(state: DuduState) { state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0; return state.seed / 4294967296; }

export function createDuduState(layout: ShipLayout, seed: number): DuduState {
  const garden = layout.cabins.find(c => c.deck === 0 && c.kind === "garden")!;
  const dogs: [CompanionState, CompanionState] = [createCompanionState("dumu", layout, seed), createCompanionState("dufu", layout, seed + 173)];
  dogs.forEach((dog, i) => {
    Object.assign(dog, { position: companionPoint(layout, garden, i ? 1 : -1), cabinId: garden.id, destinationId: garden.id,
      duration: 6, facing: cabinAngle(layout, garden.slot) + (i ? -Math.PI / 2 : Math.PI / 2) });
  });
  return { dogs, phase: "solo", interaction: "boop", elapsed: 0, clock: 0, cooldown: 1.2, round: 0, tourRound: -1,
    center: companionPoint(layout, garden, 0), targets: dogs.map(dog => ({ ...dog.position })) as [ShipPoint, ShipPoint], orbitStart: 0, seed: seed >>> 0 };
}
function rest(state: DuduState, cooldown: number) {
  state.phase = "solo"; state.elapsed = 0; state.cooldown = cooldown;
  for (const dog of state.dogs) { dog.route = []; dog.time = 0; dog.action = "idle"; dog.duration = 1.5 + random(state) * 1.5; }
}
function tour(state: DuduState, layout: ShipLayout) {
  const rooms = layout.cabins.filter(c => c.deck === 0 && ["garden", "lounge", "hydroponics", "canteen"].includes(c.kind));
  const destinations = rooms.filter(c => c.id !== state.dogs[0].cabinId);
  const destination = destinations[Math.floor(random(state) * destinations.length)];
  for (const dog of state.dogs) {
    const radius = Math.hypot(dog.position.x, dog.position.z);
    const ring = layout.rings.reduce((a, b) => Math.abs(radius - a.radius) < Math.abs(radius - b.radius) ? a : b);
    dog.route = routeBetweenCabins(layout, { ring: ring.index, angle: Math.atan2(dog.position.x, dog.position.z) }, destination);
    dog.waypoint = 0; dog.destinationId = destination.id; dog.speed = dog.kind === "dumu" ? 1.15 : 1.08;
    dog.action = "run"; dog.time = 0; dog.progress = undefined;
  }
  state.phase = "tour"; state.elapsed = 0; state.tourRound = state.round;
}
function meet(state: DuduState, layout: ShipLayout, obstacles: readonly CharacterBody[]) {
  const [a, b] = state.dogs, radius = Math.hypot(a.position.x, a.position.z);
  const ring = layout.rings.reduce((x, y) => Math.abs(radius - x.radius) < Math.abs(radius - y.radius) ? x : y);
  if (Math.abs(Math.hypot(b.position.x, b.position.z) - ring.radius) > ring.depth / 2 - .6 || distance(a.position, b.position) > 7) return false;
  const angleA = Math.atan2(a.position.x, a.position.z), angleB = Math.atan2(b.position.x, b.position.z);
  const angle = Math.atan2(Math.sin(angleA) + Math.sin(angleB), Math.cos(angleA) + Math.cos(angleB));
  state.interaction = INTERACTIONS[state.round % INTERACTIONS.length];
  const half = state.interaction === "chase" ? .85 : (a.radius + b.radius + .06) / 2;
  for (const turn of [0, -.06, .06, -.12, .12]) for (const radial of [0, -.5, .5]) {
    const center = shipPoint(ring.radius + radial, angle + turn);
    const targets = [-1, 1].map(side => ({ x: center.x + Math.cos(angle + turn) * side * half, z: center.z - Math.sin(angle + turn) * side * half })) as [ShipPoint, ShipPoint];
    if (!state.dogs.every((dog, i) => isWalkable(targets[i], layout, footingRadius(dog.radius))
      && walkableSegment(dog.position, targets[i], layout, footingRadius(dog.radius))
      && !occupiedWaypoint(companionBody(dog), targets[i], obstacles))) continue;
    if (state.interaction === "chase" && Array.from({ length: 16 }, (_, i) => {
      const p = { x: center.x + Math.sin(i * Math.PI / 8) * half, z: center.z + Math.cos(i * Math.PI / 8) * half };
      return isWalkable(p, layout, .4) && !occupiedWaypoint(companionBody(a), p, obstacles);
    }).some(clear => !clear)) continue;
    state.center = center; state.targets = targets; state.phase = "meet"; state.elapsed = 0;
    for (const dog of state.dogs) { dog.route = []; dog.time = 0; dog.action = "idle"; }
    return true;
  }
  return false;
}

// One controller coordinates this pair. Every actual step still uses the shared
// character collision and rendered-floor constraints; meeting poses never teleport.
export function advanceDudu(state: DuduState, layout: ShipLayout, elapsed: number, others: readonly CharacterBody[] = []) {
  const dt = Math.min(Math.max(elapsed, 0), .05); if (!dt) return;
  state.clock += dt; state.elapsed += dt; state.cooldown = Math.max(0, state.cooldown - dt);
  const ownIds = state.dogs.map(dog => companionBody(dog).id);
  const obstacles = others.filter(body => !ownIds.includes(body.id)), bodies = [...obstacles, ...state.dogs.map(companionBody)];
  for (const dog of state.dogs) Object.assign(dog.position, moveCharacter(companionBody(dog), dog.position, 0, bodies, true, layout));
  if (state.phase === "solo" || state.phase === "tour") {
    for (const dog of state.dogs) {
      if (state.phase !== "tour" || dog.route.length) advanceCompanion(dog, layout, dt, bodies);
      else { dog.time += dt; Object.assign(dog.position, separateCharacter(companionBody(dog), dt, bodies, layout)); }
      if (!dog.route.length) dog.duration = Math.min(dog.duration, dog.action === "sleep" ? 7 : dog.kind === "dumu" ? 3 : 4);
    }
    if (state.phase === "tour") {
      if (state.dogs.every(dog => !dog.route.length)) rest(state, 1.5);
      else if (state.elapsed > 90) { state.phase = "solo"; state.cooldown = 5; }
      return;
    }
    if (state.cooldown || state.dogs.some(dog => dog.route.length)) return;
    if ((state.round > 0 && state.round % 3 === 0 && state.tourRound !== state.round) || distance(state.dogs[0].position, state.dogs[1].position) > 7) tour(state, layout);
    else if (!meet(state, layout, obstacles)) state.cooldown = 2;
    return;
  }
  const duration = state.interaction === "chase" ? 5.5 : state.interaction === "cuddle" ? 4 : 3.5;
  for (const [i, dog] of state.dogs.entries()) {
    dog.time += dt;
    if (state.phase === "meet" || state.interaction === "chase") {
      const angle = state.orbitStart + state.elapsed * 1.6 + i * Math.PI;
      const target = state.phase === "meet" ? state.targets[i] : { x: state.center.x + Math.sin(angle) * .85, z: state.center.z + Math.cos(angle) * .85 };
      const before = { ...dog.position };
      Object.assign(dog.position, moveCharacter(companionBody(dog), target, dt * (state.phase === "meet" ? 1.05 : 1.5), bodies, true, layout));
      if (state.phase === "play" && distance(before, dog.position) > .0001) dog.facing = Math.atan2(dog.position.x - before.x, dog.position.z - before.z);
    } else Object.assign(dog.position, separateCharacter(companionBody(dog), dt, bodies, layout));
    if (state.phase === "meet" || state.interaction !== "chase") {
      const other = state.dogs[1 - i].position;
      const facing = state.phase === "play" && state.interaction === "cuddle" ? Math.atan2(state.center.x, state.center.z) : Math.atan2(other.x - dog.position.x, other.z - dog.position.z);
      dog.facing += Math.atan2(Math.sin(facing - dog.facing), Math.cos(facing - dog.facing)) * Math.min(1, dt * 8);
    }
  }
  if (state.phase === "meet") {
    if (state.dogs.every((dog, i) => distance(dog.position, state.targets[i]) < .03)) {
      state.phase = "play"; state.elapsed = 0; state.orbitStart = Math.atan2(state.dogs[0].position.x - state.center.x, state.dogs[0].position.z - state.center.z);
    } else if (state.elapsed > 8) rest(state, 3);
  } else if (state.elapsed > duration) { state.round++; rest(state, 5 + random(state) * 3); }
}

export function duduActivity(state: DuduState, index: number) {
  if (state.phase === "meet") return "Finding a clear spot for a little rendezvous";
  if (state.phase === "tour") return "Two tiny explorers, one very important expedition";
  if (state.phase === "play") return { boop: "Nose boop! A tiny heart has escaped", highFive: "Secret handshake: paw, paw, hooray!", cuddle: "A little hug makes the universe less enormous", chase: "Emergency zoomies! Catch that fluffy tail!" }[state.interaction];
  const dog = state.dogs[index];
  if (dog.route.length) return index === 0 ? "Tiny paws, enormous plans" : "Following the captain of small adventures";
  if (dog.action === "sleep") return "Recharging the cuddle batteries";
  return index === 0 ? "Practising the world's smallest happy tantrum" : "Head tilt: calculating the next snack";
}
