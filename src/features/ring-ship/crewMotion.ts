import type { OfficeAgent, RenderAgent } from "@/features/retro-office/core/types";
import { CANVAS_W, CANVAS_H, SCALE } from "@/features/retro-office/core/constants";
import { SHIP_WORKSTATION } from "./geometry";
import { routeBetweenCabins, type ShipLayout, type ShipPoint } from "./layout";
import { crewRadius, moveCharacter, occupiedWaypoint, separateCharacter, type CharacterBody } from "./characterCollision";
import { footingRadius, walkableSegment } from "./walkableSurface";
import { BREAK_ACTIONS, breakSeatKey, breakSeatPose, type BreakVisit } from "./breakRoomLayout";
import { freeBreakSeat, hasBreakPartner, routeToBreakSeat } from "./breakRoomMotion";

export type KirbyCrewPose = ShipPoint & { y: number; scale: number; tilt: number; hidden: boolean };
export type MovingAgent = RenderAgent & OfficeAgent & { route: ShipPoint[]; routeIndex: number; pauseUntil: number; home: ShipPoint; visiting: boolean; kirbyPose?: KirbyCrewPose; breakVisit?: BreakVisit; outings?: number };
export function canvasPoint(point: ShipPoint) { return { x: point.x / SCALE + CANVAS_W / 2, y: point.z / SCALE + CANVAS_H / 2 }; }
export function worldPoint(agent: RenderAgent): ShipPoint { return { x: (agent.x - CANVAS_W / 2) * SCALE, z: (agent.y - CANVAS_H / 2) * SCALE }; }
export function hash(value: string) { let result = 0; for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0; return result; }
export function crewBodies(crew: readonly RenderAgent[], layout: ShipLayout): CharacterBody[] {
  return crew.flatMap(agent => {
    const seat = layout.seats[agent.id];
    const pose = (agent as MovingAgent).kirbyPose;
    const visit = (agent as MovingAgent).breakVisit;
    return seat && !pose?.hidden ? [{ id: agent.id, position: pose || worldPoint(agent), radius: crewRadius("avatarProfile" in agent ? agent : {}) * (pose?.scale ?? 1), deck: seat.deck,
      reservedSeat: visit ? breakSeatKey(visit.cabinId, visit.seat) : undefined }] : [];
  });
}

// Metadata refreshes must preserve the pose until the next animation frame.
export function syncCrew(agents: OfficeAgent[], layout: ShipLayout, previousById: ReadonlyMap<string, RenderAgent>, now: number): MovingAgent[] {
  return agents.flatMap(agent => {
    const seat = layout.seats[agent.id]; if (!seat) return [];
    const previous = previousById.get(agent.id) as MovingAgent | undefined, p = canvasPoint(seat);
    const unchanged = previous && Math.hypot(previous.home.x - seat.x, previous.home.z - seat.z) < 0.01;
    const keepRoute = unchanged;
    return [{ ...agent, x: unchanged ? previous.x : p.x, y: unchanged ? previous.y : p.y, targetX: p.x, targetY: p.y,
      path: [], facing: unchanged ? previous.facing : seat.facing, frame: previous?.frame || hash(agent.id) % 100, state: unchanged ? previous.state : "standing" as const,
      walkSpeed: unchanged ? previous.walkSpeed : 1, phaseOffset: hash(agent.id) % 100, interactionTarget: unchanged ? previous.interactionTarget : undefined,
      workstation: { ...p, deskUid: seat.cabinId + agent.id, facing: seat.facing, pose: "sitting" as const, seatHeight: SHIP_WORKSTATION.seatHeight, surfaceHeight: SHIP_WORKSTATION.surfaceHeight },
      home: { x: seat.x, z: seat.z }, route: keepRoute ? previous.route : [], routeIndex: keepRoute ? previous.routeIndex : 0,
      visiting: keepRoute ? previous.visiting : false, pauseUntil: keepRoute ? previous.pauseUntil : now + 7000 + hash(agent.id) % 18000,
      kirbyPose: unchanged ? previous.kirbyPose : undefined, breakVisit: unchanged ? previous.breakVisit : undefined,
      outings: previous?.outings ?? 0 }];
  });
}

// Native task state changes the destination and pace, never the current position.
export function advanceCrew(crew: MovingAgent[], layout: ShipLayout, now: number, delta: number, chatAgentId?: string | null, companions: readonly CharacterBody[] = []) {
  const dt = Math.min(delta, 0.05), amenities = layout.cabins.filter(c => ["garden", "lounge", "canteen", "gym", "observatory"].includes(c.kind));
  const bodies = crewBodies(crew, layout), others = [...bodies, ...companions];
  const byId = new Map(bodies.map(body => [body.id, body]));
  const breakRoom = layout.cabins.find(c => c.kind === "break");
  for (const a of crew) {
    const seat = layout.seats[a.id]; if (!seat) continue;
    a.frame += dt * 60;
    if (a.kirbyPose) continue;
    const body = byId.get(a.id)!;
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
    const p = !needsDesk && !a.route.length ? separateCharacter(body, dt * 1.05, others, layout) : worldPoint(a);
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
    if (!target) { a.state = "standing"; continue; }
    a.walkSpeed = needsDesk ? 2 : 1;
    a.frame += dt * 60 * (a.walkSpeed - 1);
    const dx = target.x - p.x, dz = target.z - p.z, distance = Math.hypot(dx, dz), stride = dt * 1.05 * a.walkSpeed;
    const finalBreakSeat = !!a.breakVisit && a.visiting && a.routeIndex === a.route.length - 1;
    if (finalBreakSeat && distance < body.radius * 3 + .3 && occupiedWaypoint(body, target, others) && !occupiedWaypoint(body, p, others)) {
      a.state = "standing"; continue;
    }
    a.state = "walking"; a.facing = Math.atan2(dx, dz);
    const next = moveCharacter(body, target, stride, others, true, layout);
    Object.assign(a, canvasPoint(next));
    body.position = next;
    if (Math.hypot(next.x - p.x, next.z - p.z) < 1e-6) a.state = "standing";
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
