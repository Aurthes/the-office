import type { OfficeAgent, RenderAgent } from "@/features/retro-office/core/types";
import { CANVAS_W, CANVAS_H, SCALE } from "@/features/retro-office/core/constants";
import { SHIP_WORKSTATION } from "./geometry";
import { routeBetweenCabins, type DeckIndex, type ShipCabin, type ShipLayout, type ShipPoint } from "./layout";
import { crewRadius, moveCharacter, occupiedWaypoint, separateCharacter, walkCharacter, type CharacterBody, type CharacterRecovery } from "./characterCollision";
import { resolveWorksite, siteJourney, sitePoint, type FieldworkState } from "./fieldwork";
import { footingRadius, walkableSegment } from "./walkableSurface";
import { BREAK_ACTIONS, breakSeatKey, breakSeatPose, type BreakVisit } from "./breakRoomLayout";
import { freeBreakSeat, hasBreakPartner, routeToBreakSeat } from "./breakRoomMotion";

export type KirbyCrewPose = ShipPoint & { y: number; scale: number; tilt: number; hidden: boolean };
export type MovingAgent = RenderAgent & OfficeAgent & { deck: DeckIndex; homeDeck?: DeckIndex; deckY?: number; fieldwork?: FieldworkState; worksite?: ShipCabin; route: ShipPoint[]; routeIndex: number; pauseUntil: number; home: ShipPoint; visiting: boolean; kirbyPose?: KirbyCrewPose; recovery?: CharacterRecovery; breakVisit?: BreakVisit; outings?: number };
export function canvasPoint(point: ShipPoint) { return { x: point.x / SCALE + CANVAS_W / 2, y: point.z / SCALE + CANVAS_H / 2 }; }
export function worldPoint(agent: RenderAgent): ShipPoint { return { x: (agent.x - CANVAS_W / 2) * SCALE, z: (agent.y - CANVAS_H / 2) * SCALE }; }
export function hash(value: string) { let result = 0; for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0; return result; }
export function crewBodies(crew: readonly RenderAgent[], layout: ShipLayout): CharacterBody[] {
  return crew.flatMap(agent => {
    const seat = layout.seats[agent.id];
    const pose = (agent as MovingAgent).kirbyPose;
    const deck = (agent as MovingAgent).deck ?? seat?.deck, visit = (agent as MovingAgent).breakVisit;
    return deck !== undefined && !pose?.hidden && (agent as MovingAgent).fieldwork?.phase !== "lift" ? [{ id: agent.id, position: pose || worldPoint(agent), radius: crewRadius("avatarProfile" in agent ? agent : {}) * (pose?.scale ?? 1), deck,
      reservedSeat: visit ? breakSeatKey(visit.cabinId, visit.seat) : undefined }] : [];
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
      workstation: { ...p, deskUid: seat.cabinId + agent.id, facing: seat.facing, pose: "sitting" as const, seatHeight: SHIP_WORKSTATION.seatHeight, surfaceHeight: SHIP_WORKSTATION.surfaceHeight },
      home: { x: seat.x, z: seat.z }, route: keepRoute ? previous.route : [], routeIndex: keepRoute ? previous.routeIndex : 0,
      visiting: keepRoute ? previous.visiting : false, pauseUntil: keepRoute ? previous.pauseUntil : now + 7000 + hash(agent.id) % 18000,
      homeDeck: seat.deck,
      worksite: agent.constructionWorker ? resolveWorksite(agent.siteTask, layout, seat.deck) : undefined,
      deck: unchanged ? previous.deck ?? seat.deck : seat.deck, deckY: unchanged ? previous.deckY : undefined, fieldwork: unchanged ? previous.fieldwork : undefined,
      kirbyPose: unchanged ? previous.kirbyPose : undefined, breakVisit: unchanged ? previous.breakVisit : undefined,
      recovery: unchanged ? previous.recovery : undefined, outings: previous?.outings ?? 0 }];
  });
}

const SITE_ROUTINE = ["blueprint", "notes", "survey", "measure", "patrol"] as const;
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
    field.cabinId = destination.id; field.camp = id ? sitePoint(layout, destination, seed) : a.home;
    field.afterTravel = id ? "changing" : "home"; field.time = 0;
    field.legs = siteJourney(layout, worldPoint(a), a.deck, destination, field.camp);
    a.route = field.legs.shift()!.points; a.routeIndex = 0; a.visiting = false; a.breakVisit = undefined; body.reservedSeat = undefined;
    field.phase = id ? "travelling" : "returning";
  };
  if (!field.cabinId) plan(desired!.id);
  if ((desired?.id || null) !== field.nextId) {
    field.nextId = desired?.id || null;
    if (field.phase !== "lift") {
      if (field.geared) { field.phase = "packing"; field.time = 0; a.route = []; }
      else plan(field.nextId);
    }
  }
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
  const target = a.route[a.routeIndex];
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
      const point = sitePoint(layout, cabin, seed, field.cycle);
      if (walkableSegment(worldPoint(a), point, layout, footingRadius(body.radius), a.deck)) { a.route = [point]; a.routeIndex = 0; }
    }
  }
  return true;
}

// Native task state changes the destination and pace, never the current position.
export function advanceCrew(crew: MovingAgent[], layout: ShipLayout, now: number, delta: number, chatAgentId?: string | null, companions: readonly CharacterBody[] = []) {
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
      a.route = []; a.visiting = false; a.breakVisit = undefined; body.reservedSeat = undefined; Object.assign(a, canvasPoint(a.home)); a.facing = seat.facing;
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
        a.breakVisit = undefined; body.reservedSeat = undefined;
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
        a.breakVisit = undefined; body.reservedSeat = undefined;
      }
      a.visiting = !a.visiting; a.routeIndex = 0;
    }
    const target = a.route[a.routeIndex];
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
