import type { OfficeAgent, RenderAgent } from "@/features/retro-office/core/types";
import { CANVAS_W, CANVAS_H, SCALE } from "@/features/retro-office/core/constants";
import { routeBetweenCabins, type ShipLayout, type ShipPoint } from "./layout";

export type MovingAgent = RenderAgent & OfficeAgent & { route: ShipPoint[]; routeIndex: number; pauseUntil: number; home: ShipPoint; visiting: boolean };
export function canvasPoint(point: ShipPoint) { return { x: point.x / SCALE + CANVAS_W / 2, y: point.z / SCALE + CANVAS_H / 2 }; }
export function worldPoint(agent: RenderAgent): ShipPoint { return { x: (agent.x - CANVAS_W / 2) * SCALE, z: (agent.y - CANVAS_H / 2) * SCALE }; }
export function hash(value: string) { let result = 0; for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0; return result; }

// Native task state changes the destination and pace, never the current position.
export function advanceCrew(crew: MovingAgent[], layout: ShipLayout, now: number, delta: number, chatAgentId?: string | null) {
  const dt = Math.min(delta, 0.05), amenities = layout.cabins.filter(c => ["garden", "lounge", "canteen", "gym", "observatory"].includes(c.kind));
  for (const a of crew) {
    const seat = layout.seats[a.id]; if (!seat) continue;
    a.frame += dt * 60;
    if (a.id === chatAgentId && a.status === "idle" && !a.needsInput) { a.state = "standing"; continue; }
    const needsDesk = a.status === "working" || a.status === "error" || a.needsInput;
    const p = worldPoint(a);
    if (needsDesk && Math.hypot(p.x - a.home.x, p.z - a.home.z) < 0.02) {
      a.route = []; a.visiting = false; Object.assign(a, canvasPoint(a.home)); a.facing = seat.facing;
      a.state = "sitting"; a.interactionTarget = "desk"; continue;
    }
    a.interactionTarget = undefined;
    if (needsDesk) {
      if (a.visiting) {
        // Retrace only the part already walked, even in the middle of a spoke.
        // Once at the amenity the same deterministic outward route is recreated.
        const outward = a.route.length ? a.route.slice(0, a.routeIndex)
          : routeBetweenCabins(layout, seat, amenities[hash(a.id) % amenities.length]);
        a.route = outward.reverse().concat([a.home]); a.routeIndex = 0; a.visiting = false;
      } else if (!a.route.length) { a.route = [a.home]; a.routeIndex = 0; }
    } else if (!a.route.length && now > a.pauseUntil && amenities.length) {
      const destination = amenities[hash(a.id) % amenities.length];
      if (!a.visiting) a.route = routeBetweenCabins(layout, seat, destination);
      else a.route = [...routeBetweenCabins(layout, seat, destination)].reverse().concat([a.home]);
      a.visiting = !a.visiting; a.routeIndex = 0;
    }
    const target = a.route[a.routeIndex];
    if (!target) { a.state = "standing"; continue; }
    a.walkSpeed = needsDesk ? 2 : 1;
    a.frame += dt * 60 * (a.walkSpeed - 1);
    const dx = target.x - p.x, dz = target.z - p.z, distance = Math.hypot(dx, dz), stride = dt * 1.05 * a.walkSpeed;
    a.state = "walking"; a.facing = Math.atan2(dx, dz);
    const next = distance <= stride ? target : { x: p.x + dx / distance * stride, z: p.z + dz / distance * stride };
    Object.assign(a, canvasPoint(next));
    if (distance <= stride) {
      a.routeIndex += 1;
      if (a.routeIndex >= a.route.length) {
        a.route = []; a.pauseUntil = now + 16000 + hash(a.id) % 20000;
        a.state = needsDesk ? "sitting" : "standing";
        if (needsDesk) { a.interactionTarget = "desk"; a.facing = seat.facing; }
      }
    }
  }
}
