import type { OfficeAgent, RenderAgent } from "@/features/retro-office/core/types";
import { CANVAS_W, CANVAS_H, SCALE } from "@/features/retro-office/core/constants";
import { SHIP_WORKSTATION } from "./geometry";
import { routeBetweenCabins, shipPoint, type DeckIndex, type ShipCabin, type ShipLayout, type ShipPoint } from "./layout";
import { walkableWaypoint, crewRadius, moveCharacter, occupiedWaypoint, separateCharacter, walkCharacter, type CharacterBody, type CharacterRecovery } from "./characterCollision";
import { resolveWorksite, siteJourney, sitePoint, insideSite, type FieldworkState } from "./fieldwork";
import { footingRadius, isWalkable, walkableSegment } from "./walkableSurface";
import { BREAK_ACTIONS, breakSeatKey, breakSeatPose, type BreakVisit } from "./breakRoomLayout";
import { freeBreakSeat, hasBreakPartner, routeToBreakSeat } from "./breakRoomMotion";
import { HIBERNATION_CAPACITY, HIBERNATION_IDLE_MS, hibernationPod } from "./hibernationLayout";
import { insideHibernation, sleepPose, type HibernationState, type SleepPose } from "./hibernationMotion";

export type KirbyCrewPose = ShipPoint & { y: number; scale: number; tilt: number; hidden: boolean };
export type MovingAgent = RenderAgent & OfficeAgent & { deck: DeckIndex; homeDeck?: DeckIndex; deckY?: number; fieldwork?: FieldworkState; worksite?: ShipCabin; route: ShipPoint[]; routeIndex: number; pauseUntil: number; home: ShipPoint; visiting: boolean; kirbyPose?: KirbyCrewPose; recovery?: CharacterRecovery; breakVisit?: BreakVisit; departingSeat?: { key: string; point: ShipPoint }; outings?: number; idleSince?: number; idleActivityAt?: number; hibernation?: HibernationState; sleepPose?: SleepPose };
export function canvasPoint(point: ShipPoint) { return { x: point.x / SCALE + CANVAS_W / 2, y: point.z / SCALE + CANVAS_H / 2 }; }
export function worldPoint(agent: RenderAgent): ShipPoint { return { x: (agent.x - CANVAS_W / 2) * SCALE, z: (agent.y - CANVAS_H / 2) * SCALE }; }
export function hash(value: string) { let result = 0; for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0; return result; }
export function crewBodies(crew: readonly RenderAgent[], layout: ShipLayout): CharacterBody[] {
  return crew.flatMap(agent => {
    const seat = layout.seats[agent.id];
    const pose = (agent as MovingAgent).kirbyPose;
    const deck = (agent as MovingAgent).deck ?? seat?.deck, visit = (agent as MovingAgent).breakVisit;
    return deck !== undefined && !pose?.hidden && !insideHibernation((agent as MovingAgent).hibernation) && (agent as MovingAgent).fieldwork?.phase !== "lift" ? [{ id: agent.id, position: pose || worldPoint(agent), radius: crewRadius("avatarProfile" in agent ? agent : {}) * (pose?.scale ?? 1), deck,
      reservedSeat: visit ? breakSeatKey(visit.cabinId, visit.seat) : departureKey(agent as MovingAgent) }] : [];
  });
}

// Metadata refreshes must preserve the pose until the next animation frame.
export function syncCrew(agents: OfficeAgent[], layout: ShipLayout, previousById: ReadonlyMap<string, RenderAgent>, now: number): MovingAgent[] {
  return agents.flatMap(agent => {
    const seat = layout.seats[agent.id]; if (!seat) return [];
    const previous = previousById.get(agent.id) as MovingAgent | undefined, p = canvasPoint(seat);
    const unchanged = previous && (previous.homeDeck ?? seat.deck) === seat.deck && Math.hypot(previous.home.x - seat.x, previous.home.z - seat.z) < 0.01;
    const keepRoute = unchanged;
    return [{ ...agent, x: unchanged ? previous.x : p.x, y: unchanged ? previous.y : p.y, targetX: p.x, targetY: p.y,
      path: [], facing: unchanged ? previous.facing : seat.facing, frame: previous?.frame || hash(agent.id) % 100, state: unchanged ? previous.state : "standing" as const,
      walkSpeed: unchanged ? previous.walkSpeed : 1, phaseOffset: hash(agent.id) % 100, interactionTarget: unchanged ? previous.interactionTarget : undefined,
      workstation: { ...p, deskUid: seat.cabinId + agent.id, facing: seat.facing, pose: "sitting" as const, seatHeight: seat.seatHeight ?? SHIP_WORKSTATION.seatHeight, surfaceHeight: seat.surfaceHeight ?? SHIP_WORKSTATION.surfaceHeight },
      home: { x: seat.x, z: seat.z }, route: keepRoute ? previous.route : [], routeIndex: keepRoute ? previous.routeIndex : 0,
      visiting: keepRoute ? previous.visiting : false, pauseUntil: keepRoute ? previous.pauseUntil : now + 7000 + hash(agent.id) % 18000,
      homeDeck: seat.deck,
      worksite: agent.constructionWorker ? resolveWorksite(agent.siteTask, layout, seat.deck) : undefined,
      deck: unchanged ? previous.deck ?? seat.deck : seat.deck, deckY: unchanged ? previous.deckY : undefined, fieldwork: unchanged ? previous.fieldwork : undefined,
      kirbyPose: unchanged ? previous.kirbyPose : undefined, breakVisit: unchanged ? previous.breakVisit : undefined,
      idleSince: previous?.idleSince, idleActivityAt: previous?.idleActivityAt,
      hibernation: unchanged ? previous.hibernation : undefined, sleepPose: unchanged ? previous.sleepPose : undefined,
      recovery: unchanged ? previous.recovery : undefined, departingSeat: unchanged ? previous.departingSeat : undefined, outings: previous?.outings ?? 0 }];
  });
}

function departureKey(agent: MovingAgent) {
  const seat = agent.departingSeat;
  return seat && Math.hypot(worldPoint(agent).x - seat.point.x, worldPoint(agent).z - seat.point.z) < 1.5 ? seat.key : undefined;
}
function leaveBreakSeat(agent: MovingAgent, layout: ShipLayout) {
  const visit = agent.breakVisit;
  if (visit) {
    const cabin = layout.cabins.find(c => c.id === visit.cabinId)!;
    agent.departingSeat = { key: breakSeatKey(cabin.id, visit.seat), point: breakSeatPose(layout, cabin, visit.seat).point };
  }
  agent.breakVisit = undefined;
}

const SITE_ROUTINE = ["blueprint", "notes", "survey", "measure", "patrol"] as const;
function advanceHibernation(a: MovingAgent, crew: MovingAgent[], layout: ShipLayout, now: number, wallNow: number, dt: number, body: CharacterBody, others: readonly CharacterBody[]): boolean {
  const idle = a.status === "idle" && !a.needsInput;
  const activity = Number.isFinite(a.lastActivityAt) && a.lastActivityAt! > 0 ? Math.min(a.lastActivityAt!, wallNow) : 0;
  if (!idle) a.idleSince = wallNow;
  else if (a.idleSince === undefined) a.idleSince = activity || wallNow;
  else if (activity > (a.idleActivityAt ?? 0)) a.idleSince = Math.max(a.idleSince, activity);
  const refreshed = activity > (a.idleActivityAt ?? activity);
  a.idleActivityAt = activity;
  if (!a.hibernation && idle && !a.fieldwork && wallNow - a.idleSince! > HIBERNATION_IDLE_MS) {
    const cabin = layout.cabins.find(c => c.kind === "quarters" && c.deck === a.deck);
    if (cabin) {
      const pod = Array.from({ length: HIBERNATION_CAPACITY }, (_, i) => i).find(index => !crew.some(other =>
        other.hibernation?.cabinId === cabin.id && other.hibernation.pod === index && other.hibernation.phase !== "returning"));
      if (pod !== undefined) {
        a.hibernation = { cabinId: cabin.id, pod, phase: "travelling", time: 0 };
        const berth = hibernationPod(layout, cabin, pod);
        a.route = siteJourney(layout, worldPoint(a), a.deck, cabin, shipPoint(layout.rings[cabin.ring].radius, berth.angle), body)[0].points.concat([berth.entry]);
        a.routeIndex = 0; a.visiting = false; leaveBreakSeat(a, layout); a.recovery = undefined; body.reservedSeat = departureKey(a);
      }
    }
  }
  const sleep = a.hibernation; if (!sleep) return false;
  const cabin = layout.cabins.find(c => c.id === sleep.cabinId);
  if (!cabin) { a.hibernation = undefined; a.sleepPose = undefined; return false; }
  const pod = hibernationPod(layout, cabin, sleep.pod);
  const goHome = () => {
    sleep.phase = "returning"; sleep.time = 0; a.sleepPose = undefined;
    const home = layout.cabins.find(c => c.id === layout.seats[a.id].cabinId)!;
    a.route = siteJourney(layout, worldPoint(a), a.deck, home, a.home, body)[0].points; a.routeIndex = 0; a.recovery = undefined;
  };
  if ((!idle || refreshed) && !["waking", "leaving", "returning"].includes(sleep.phase)) {
    if (sleep.phase === "travelling") goHome();
    else { sleep.wakeFrom = sleepPose(sleep, pod); sleep.phase = "waking"; sleep.time = 0; }
  }
  a.interactionTarget = undefined;
  if (sleep.phase === "returning" && a.status === "working" && a.worksite) { a.hibernation = undefined; return false; }
  if (sleep.phase === "travelling" || sleep.phase === "returning") {
    const target = walkableWaypoint(body, a.route, a.routeIndex, layout);
    if (target) {
      const before = worldPoint(a);
      a.walkSpeed = sleep.phase === "returning" ? 2.15 : 1;
      a.frame += dt * 60 * (a.walkSpeed - 1);
      const next = walkCharacter(a, body, target, dt * 1.05 * a.walkSpeed, dt, others, layout);
      Object.assign(a, canvasPoint(next)); body.position = next;
      const moved = Math.hypot(next.x - before.x, next.z - before.z) > 1e-6;
      a.state = moved ? "walking" : "standing";
      if (moved) a.facing = Math.atan2(next.x - before.x, next.z - before.z);
      if (Math.hypot(next.x - target.x, next.z - target.z) < 1e-5) a.routeIndex++;
      if (a.routeIndex < a.route.length) return true;
    }
    a.route = []; a.routeIndex = 0;
    if (sleep.phase === "returning") { a.hibernation = undefined; a.pauseUntil = now + 6000; return false; }
    sleep.phase = "entering"; sleep.time = 0;
  }
  sleep.time += dt; a.facing = pod.facing; a.state = "standing";
  // Entry/exit is a short, bounded animation within the reserved pod footprint.
  // Ordinary walkers still collide with the pod, never the reclining body.
  if (sleep.phase === "entering" && sleep.time >= 1.8) { sleep.phase = "sleeping"; sleep.time = 0; }
  if (sleep.phase === "waking" && sleep.time >= 1) {
    sleep.wakeFrom = sleepPose(sleep, pod); sleep.phase = "leaving"; sleep.time = 0;
  }
  const pose = sleepPose(sleep, pod);
  if (sleep.phase === "leaving" && pose && occupiedWaypoint(body, pose, others)) { sleep.time = Math.max(0, sleep.time - dt); return true; }
  if (sleep.phase === "leaving" && sleep.time >= 1) {
    // Wait for a passer-by before stepping into the aisle.
    if (occupiedWaypoint(body, pod.entry, others)) { sleep.time = 1; return true; }
    Object.assign(a, canvasPoint(pod.entry)); body.position = pod.entry; goHome(); return true;
  }
  if (pose) { a.sleepPose = pose; Object.assign(a, canvasPoint(pose)); body.position = pose; }
  return true;
}

function advanceFieldwork(a: MovingAgent, layout: ShipLayout, now: number, dt: number, body: CharacterBody, others: readonly CharacterBody[]): boolean {
  const seat = layout.seats[a.id];
  const desired = a.constructionWorker && a.status === "working" ? a.worksite : undefined;
  if (!a.fieldwork && !desired) return false;
  const seed = hash(a.id);
  if (!a.fieldwork) a.fieldwork = { cabinId: "", nextId: desired!.id, camp: a.home, phase: "travelling", time: 0, cycle: 0, geared: false, legs: [], afterTravel: "changing", liftFrom: a.deck };
  const field = a.fieldwork;
  const plan = (id: string | null) => {
    const destination = layout.cabins.find(c => c.id === (id || seat.cabinId));
    if (!destination) return;
    const camp = id ? sitePoint(layout, destination, seed, 0, body, point => !occupiedWaypoint({ ...body, deck: destination.deck }, point, others)) : a.home;
    if (!camp) { a.route = []; a.routeIndex = 0; a.state = "standing"; return false; }
    field.cabinId = destination.id; field.camp = camp;
    field.afterTravel = id ? "changing" : "home"; field.time = 0;
    field.legs = siteJourney(layout, worldPoint(a), a.deck, destination, field.camp, body);
    a.route = field.legs.shift()!.points; a.routeIndex = 0; a.visiting = false; leaveBreakSeat(a, layout); body.reservedSeat = departureKey(a);
    field.phase = id ? "travelling" : "returning";
    return true;
  };
  if (!field.cabinId && !desired) { a.fieldwork = undefined; return false; }
  if (!field.cabinId && !plan(desired!.id)) return true;
  if ((desired?.id || null) !== field.nextId) {
    field.nextId = desired?.id || null;
    if (field.phase !== "lift") {
      if (field.geared) { field.phase = "packing"; field.time = 0; a.route = []; }
      else if (!plan(field.nextId)) return true;
    }
  }
  if (field.phase !== "lift" && field.phase !== "packing" && field.cabinId !== (field.nextId || seat.cabinId) && !plan(field.nextId)) return true;
  a.interactionTarget = undefined; field.time += dt;
  if (field.phase === "lift") {
    const next = field.legs[0];
    const progress = Math.min(1, field.time / 1.8);
    a.deckY = (field.liftFrom + (next.deck - field.liftFrom) * progress) * 10;
    a.state = "standing";
    if (progress >= 1) {
      a.deck = next.deck; a.deckY = undefined;
      if ((field.nextId || seat.cabinId) !== field.cabinId) plan(field.nextId);
      else { a.route = field.legs.shift()!.points; a.routeIndex = 0; field.phase = field.afterTravel === "home" ? "returning" : "travelling"; field.time = 0; }
    }
    return true;
  }
  if (field.phase === "packing") {
    a.state = "standing";
    if (field.time >= 1.8) plan(field.nextId);
    return true;
  }
  const target = walkableWaypoint(body, a.route, a.routeIndex, layout);
  if (target) {
    const before = worldPoint(a), distance = Math.hypot(target.x - before.x, target.z - before.z);
    a.walkSpeed = field.phase === "patrol" ? .72 : 2.15;
    a.frame += dt * 60 * (a.walkSpeed - 1); a.facing = Math.atan2(target.x - before.x, target.z - before.z);
    const next = moveCharacter(body, target, dt * 1.05 * a.walkSpeed, others, true, layout);
    Object.assign(a, canvasPoint(next)); body.position = next;
    a.state = Math.hypot(next.x - before.x, next.z - before.z) > 1e-6 ? "walking" : "standing";
    const following = a.route[a.routeIndex + 1];
    const nearOccupied = distance < body.radius * 2 + .2 && occupiedWaypoint(body, target, others)
      && (!following || walkableSegment(next, following, layout, footingRadius(body.radius), a.deck));
    if (Math.hypot(next.x - target.x, next.z - target.z) < 1e-5 || nearOccupied) a.routeIndex++;
    if (a.routeIndex < a.route.length) return true;
    a.route = []; a.routeIndex = 0; field.time = 0;
    if (field.legs.length) { field.phase = "lift"; field.liftFrom = a.deck; return true; }
    if (field.afterTravel === "home") {
      a.fieldwork = undefined; a.deckY = undefined; a.state = "standing"; a.pauseUntil = now + 6000;
      return false;
    }
    const cabin = layout.cabins.find(c => c.id === field.cabinId)!;
    if (!insideSite(layout, cabin, worldPoint(a)) || !isWalkable(field.camp, layout, .4, cabin.deck, body)
      || (field.phase !== "patrol" && Math.hypot(worldPoint(a).x - field.camp.x, worldPoint(a).z - field.camp.z) > .1)) {
      plan(field.nextId); return true;
    }
    if (field.phase !== "patrol") field.phase = field.geared ? "blueprint" : "changing";
    else field.phase = SITE_ROUTINE[field.cycle++ % (SITE_ROUTINE.length - 1)];
  }
  a.state = "standing";
  if (field.phase === "changing") {
    if (field.time >= 1.8) { field.geared = true; field.phase = "blueprint"; field.time = 0; }
  } else if (!a.needsInput && field.time >= 4 + (seed + field.cycle) % 4) {
    field.phase = SITE_ROUTINE[field.cycle++ % SITE_ROUTINE.length]; field.time = 0;
    if (field.phase === "patrol") {
      const cabin = layout.cabins.find(c => c.id === field.cabinId)!;
      const point = sitePoint(layout, cabin, seed, field.cycle, body, point => !occupiedWaypoint(body, point, others));
      if (point && walkableSegment(worldPoint(a), point, layout, footingRadius(body.radius), a.deck)) { a.route = [point]; a.routeIndex = 0; }
    }
  }
  return true;
}

// Native task state changes the destination and pace, never the current position.
export function advanceCrew(crew: MovingAgent[], layout: ShipLayout, now: number, delta: number, chatAgentId?: string | null, companions: readonly CharacterBody[] = [], wallNow = Date.now()) {
  const dt = Math.min(delta, 0.05), allAmenities = layout.cabins.filter(c => ["garden", "lounge", "canteen", "gym", "observatory"].includes(c.kind));
  const bodies = crewBodies(crew, layout), others = [...bodies, ...companions];
  const byId = new Map(bodies.map(body => [body.id, body]));
  const breakRoom = layout.cabins.find(c => c.kind === "break");
  for (const a of crew) {
    const seat = layout.seats[a.id]; if (!seat) continue;
    a.frame += dt * 60;
    if (a.kirbyPose) continue;
    a.deck ??= seat.deck;
    const body = byId.get(a.id) || { id: a.id, position: worldPoint(a), radius: crewRadius(a), deck: a.deck };
    if (advanceHibernation(a, crew, layout, now, wallNow, dt, body, others)) continue;
    if (advanceFieldwork(a, layout, now, dt, body, others)) continue;
    const amenities = allAmenities.filter(c => c.deck === a.deck);
    body.position = moveCharacter(body, body.position, 0, others, true, layout);
    Object.assign(a, canvasPoint(body.position));
    if (a.id === chatAgentId && a.status === "idle" && !a.needsInput) { a.state = a.breakVisit && !a.route.length ? "sitting" : "standing"; continue; }
    const needsDesk = a.status === "working" || a.status === "error" || a.needsInput;
    if (!needsDesk && a.breakVisit && a.visiting && !a.route.length && now <= a.pauseUntil) {
      a.state = "sitting";
      const room = layout.cabins.find(c => c.id === a.breakVisit!.cabinId)!;
      a.breakVisit.chatting = hasBreakPartner(layout, room, a.breakVisit, others);
      a.facing = breakSeatPose(layout, room, a.breakVisit.seat).facing;
      continue;
    }
    const before=body.position;
    const p = !needsDesk && !a.route.length ? separateCharacter(body, dt * 1.05, others, layout,.2) : worldPoint(a);
    Object.assign(a, canvasPoint(p)); body.position = p;
    if (needsDesk && Math.hypot(p.x - a.home.x, p.z - a.home.z) < 0.02) {
      a.route = []; a.visiting = false; leaveBreakSeat(a, layout); body.reservedSeat = departureKey(a); Object.assign(a, canvasPoint(a.home)); a.facing = seat.facing;
      a.state = "sitting"; a.interactionTarget = "desk"; continue;
    }
    a.interactionTarget = undefined;
    if (needsDesk) {
      if (a.visiting) {
        // Retrace only the part already walked, even in the middle of a spoke.
        // Once at the amenity the same deterministic outward route is recreated.
        const outward = a.route.length ? a.route.slice(0, a.routeIndex)
          : a.breakVisit?.outward.slice() ?? routeBetweenCabins(layout, seat, amenities[hash(a.id) % amenities.length]);
        a.route = outward.reverse().concat([a.home]); a.routeIndex = 0; a.visiting = false;
        leaveBreakSeat(a, layout); body.reservedSeat = departureKey(a);
      } else if (!a.route.length) { a.route = [a.home]; a.routeIndex = 0; }
    } else if (!a.route.length && now > a.pauseUntil && amenities.length) {
      const destination = amenities[hash(a.id) % amenities.length];
      if (!a.visiting) {
        const outing = a.outings ?? 0;
        const breakSeat = breakRoom && breakRoom.deck === seat.deck && (hash(a.id) + outing) % 3 !== 0
          ? freeBreakSeat(layout, breakRoom, body, others, hash(a.id) % 4) : undefined;
        if (breakRoom && breakSeat !== undefined) {
          a.route = routeToBreakSeat(layout, seat, breakRoom, breakSeat);
          a.breakVisit = { cabinId: breakRoom.id, seat: breakSeat, action: BREAK_ACTIONS[(hash(a.id) + outing) % BREAK_ACTIONS.length], outward: a.route.slice() };
          body.reservedSeat = breakSeatKey(breakRoom.id, breakSeat);
        } else a.route = routeBetweenCabins(layout, seat, destination);
        a.outings = outing + 1;
      } else {
        a.route = [...(a.breakVisit?.outward ?? routeBetweenCabins(layout, seat, destination))].reverse().concat([a.home]);
        leaveBreakSeat(a, layout); body.reservedSeat = departureKey(a);
      }
      a.visiting = !a.visiting; a.routeIndex = 0;
    }
    const target = walkableWaypoint(body, a.route, a.routeIndex, layout);
    if (!target) {
      a.recovery=undefined;const moved=Math.hypot(p.x-before.x,p.z-before.z)>.00001;
      a.state=moved?"walking":"standing";if(moved)a.facing=Math.atan2(p.x-before.x,p.z-before.z);continue;
    }
    a.walkSpeed = needsDesk ? 2 : 1;
    a.frame += dt * 60 * (a.walkSpeed - 1);
    const dx = target.x - p.x, dz = target.z - p.z, distance = Math.hypot(dx, dz), stride = dt * 1.05 * a.walkSpeed;
    const finalBreakSeat = !!a.breakVisit && a.visiting && a.routeIndex === a.route.length - 1;
    if (finalBreakSeat && distance < body.radius * 3 + .3 && occupiedWaypoint(body, target, others) && !occupiedWaypoint(body, p, others)) {
      a.state = "standing"; continue;
    }
    a.state = "walking"; a.facing = Math.atan2(dx, dz);
    const next = walkCharacter(a, body, target, stride, dt, others, layout);
    Object.assign(a, canvasPoint(next));
    body.position = next;
    if (Math.hypot(next.x - p.x, next.z - p.z) < 1e-6) a.state = "standing";
    else a.facing=Math.atan2(next.x-p.x,next.z-p.z);
    const remaining = Math.hypot(next.x - target.x, next.z - target.z), reached = remaining < 1e-6;
    // Shared amenity waypoints can be occupied. Stop nearby, or continue to the
    // next waypoint, rather than walking into the character already there.
    const stopped = remaining >= distance - 1e-6 && !needsDesk && a.routeIndex === a.route.length - 1;
    const closeEnough = distance < body.radius * (stopped ? 4 : 2) + .15 && occupiedWaypoint(body, target, others)
      && !finalBreakSeat && !(needsDesk && a.routeIndex === a.route.length - 1)
      && (!a.route[a.routeIndex + 1] || walkableSegment(next, a.route[a.routeIndex + 1], layout, footingRadius(body.radius), body.deck));
    if (reached || closeEnough) {
      a.routeIndex += 1;
      if (a.routeIndex >= a.route.length) {
        a.route = []; a.pauseUntil = now + 16000 + hash(a.id) % 20000;
        a.state = needsDesk || finalBreakSeat ? "sitting" : "standing";
        if (finalBreakSeat && breakRoom) a.facing = breakSeatPose(layout, breakRoom, a.breakVisit!.seat).facing;
        if (needsDesk) { a.interactionTarget = "desk"; a.facing = seat.facing; }
      }
    }
  }
}
