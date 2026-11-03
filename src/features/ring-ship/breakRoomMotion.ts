import { occupiedWaypoint, type CharacterBody } from "./characterCollision";
import { routeBetweenCabins, type ShipCabin, type ShipLayout, type ShipSeat } from "./layout";
import { footingRadius, isWalkable } from "./walkableSurface";
import { BREAK_ROOM, breakSeatKey, breakSeatPose, type BreakVisit } from "./breakRoomLayout";

export function freeBreakSeat(layout: ShipLayout, cabin: ShipCabin, body: CharacterBody, others: readonly CharacterBody[], start: number) {
  for (let i = 0; i < BREAK_ROOM.seats.length; i++) {
    const seat = (start + i) % BREAK_ROOM.seats.length, key = breakSeatKey(cabin.id, seat);
    const pose = breakSeatPose(layout, cabin, seat);
    if (others.some(other => other.id !== body.id && other.reservedSeat === key)) continue;
    if (occupiedWaypoint(body, pose.point, others) || !isWalkable(pose.point, layout, footingRadius(body.radius), cabin.deck, { ...body, reservedSeat: key })) continue;
    return seat;
  }
}
export function routeToBreakSeat(layout: ShipLayout, from: Pick<ShipSeat, "ring" | "angle">, cabin: ShipCabin, seat: number) {
  const pose = breakSeatPose(layout, cabin, seat);
  return [...routeBetweenCabins(layout, from, cabin), pose.approach, pose.point];
}
export function hasBreakPartner(layout: ShipLayout, cabin: ShipCabin, visit: BreakVisit, others: readonly CharacterBody[]) {
  const partner = visit.seat ^ 1, key = breakSeatKey(cabin.id, partner), point = breakSeatPose(layout, cabin, partner).point;
  return others.some(body => body.reservedSeat === key && Math.hypot(body.position.x - point.x, body.position.z - point.z) < .1);
}
