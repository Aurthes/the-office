import { cabinAngle, routeBetweenCabins, shipPoint, type DeckIndex, type ShipLayout, type ShipPoint, type ShipSeat } from "./layout";

export type ReturnStage = "walking" | "transferring" | "boarding" | "sealing" | "waiting" | "launching" | "done" | "failed";
export type ArchiveResult = { status: "pending" | "confirmed" | "failed"; at?: number; error?: string };
export type ReturnTransfer = { startedAt?: number; completedAt?: number };
export type ReturnLeg = { deck: DeckIndex; points: ShipPoint[]; duration: number };
// Scene units/second: an ejection impulse, then constant motor acceleration.
const launchSpeed = 18, launchAcceleration = 48, launchDistance = 16;
export const RETURN_LAUNCH_DURATION = (Math.sqrt(launchSpeed ** 2 + 2 * launchAcceleration * launchDistance) - launchSpeed) / launchAcceleration;
export function returnLaunchDistance(seconds: number) {
  const t = Math.max(0, Math.min(RETURN_LAUNCH_DURATION, seconds));
  return launchSpeed * t + .5 * launchAcceleration * t * t;
}
export const RETURN_LABELS: Record<ReturnStage, string> = {
  walking: "Clocking out! Heading to the return bay", transferring: "Taking the central lift to the main deck", boarding: "Boarding the return pod", sealing: "Closing the hatch · Preparing to eject",
  waiting: "Waiting for Codex to confirm archive · Holding launch", launching: "Archive confirmed · See you on Earth!", done: "Returned to Earth · Original session archived", failed: "Archive not confirmed · No launch",
};
export function returnRoute(layout: ShipLayout, seat: ShipSeat, current: ShipPoint) {
  const bay = layout.cabins.find(c => c.kind === "return" && c.deck === 0);
  if (!bay) throw new Error("返航舱尚未就绪");
  const angle = cabinAngle(layout, bay.slot), pod = shipPoint(layout.rings[bay.ring].radius + 1.8, angle);
  const entry = shipPoint(layout.rings[bay.ring].radius - 0.15, angle);
  // Enter the circulation lane before following the existing ring/spoke route.
  const currentRadius = Math.hypot(current.x, current.z), currentAngle = Math.atan2(current.x, current.z);
  const nearestRing = [...layout.rings].sort((a,b) => Math.abs(a.radius-currentRadius)-Math.abs(b.radius-currentRadius))[0];
  const from = { ...seat, ...current, ring: nearestRing.index, angle: currentAngle };
  const origin={x:current.x,z:current.z};
  const leg = (deck: DeckIndex, points: ShipPoint[], max: number): ReturnLeg => {
    const length = points.reduce((n,p,i) => i ? n+Math.hypot(p.x-points[i-1].x,p.z-points[i-1].z) : 0, 0);
    return { deck, points, duration: Math.max(1,Math.min(max,length/8)) };
  };
  const legs: ReturnLeg[] = [];
  if (seat.deck !== 0) {
    // Use an existing radial corridor and the central shuttle, not a vertical
    // shortcut through the intervening offices and their floors.
    const spoke = [...layout.spokes].sort((a,b) => Math.abs(Math.atan2(Math.sin(a-currentAngle),Math.cos(a-currentAngle))) - Math.abs(Math.atan2(Math.sin(b-currentAngle),Math.cos(b-currentAngle))))[0];
    const corridor = { ...bay, ring: 0 as const, slot: Math.round(spoke*layout.allocation.sectors/(Math.PI*2)) };
    const core = shipPoint(3.8,spoke), inner = shipPoint(layout.rings[0].radius,spoke);
    // routeBetweenCabins ends at a bay center. Use the spoke itself as the
    // exact final lane angle before walking inward toward the lift entrance.
    const toInner = routeBetweenCabins(layout,from,corridor);
    const spokeSeat = { ...seat,...inner,ring:0 as const,angle:spoke,deck:0 as const };
    legs.push(leg(seat.deck,[origin,...toInner,inner,core],5));
    legs.push(leg(0,[core,inner,...routeBetweenCabins(layout,spokeSeat,bay),entry],7));
  } else legs.push(leg(0,[origin,...routeBetweenCabins(layout,from,bay),entry],10));
  return { bayId: bay.id, pod, entry, angle, legs, sourceDeck: seat.deck, duration: legs.reduce((n,l)=>n+l.duration,0) };
}
export function routePoint(points: ShipPoint[], progress: number): ShipPoint {
  if(progress<=0) return points[0];
  if(progress>=1) return points[points.length-1];
  const lengths = points.slice(1).map((p,i) => Math.hypot(p.x-points[i].x,p.z-points[i].z));
  let distance = lengths.reduce((a,b)=>a+b,0) * Math.max(0,Math.min(1,progress));
  for (let i=0;i<lengths.length;i++) {
    if (distance<=lengths[i]) { const p=lengths[i] ? distance/lengths[i] : 0; return {x:points[i].x+(points[i+1].x-points[i].x)*p,z:points[i].z+(points[i+1].z-points[i].z)*p}; }
    distance-=lengths[i];
  }
  return points[points.length-1];
}
export function returnStage(elapsed: number, walk: number, result: ArchiveResult): {stage: ReturnStage; launch: number} {
  if (result.status === "failed") return {stage:"failed",launch:0};
  if (elapsed<walk) return {stage:"walking",launch:0};
  if (elapsed<walk+1.2) return {stage:"boarding",launch:0};
  if (elapsed<walk+2) return {stage:"sealing",launch:0};
  if (result.status!=="confirmed") return {stage:"waiting",launch:0};
  const launch=Math.max(0,Math.min(1,(elapsed-Math.max(walk+2,result.at??0))/RETURN_LAUNCH_DURATION));
  return {stage:launch>=1?"done":"launching",launch};
}
