import { CLONING_AISLE_V, CLONING_POD, routeBetweenCabins, type ShipLayout, type ShipPoint } from "./layout";
import { canvasPoint, type MovingAgent } from "./crewMotion";
import { cloningPoint } from "./cloningGeometry";
export { cloningPoint } from "./cloningGeometry";

export type CloneRequest = { agentId: string; requestId: string; name?: string; lastTurnId?: string };
export type CloneResult = { status: "pending" } | { status: "confirmed"; threadId: string; at: number } | { status: "failed"; error: string };
export const CLONE_DURATION = 16;
export type CloneStage = "synchronizing" | "skeleton" | "tissue" | "skin" | "opening" | "waking" | "stepping" | "returning" | "complete" | "failed";
export const CLONE_LABELS: Record<CloneStage, string> = {
  skeleton: "Building the skeleton", tissue: "Growing muscle around the skeleton", skin: "Forming skin and feathers",
  synchronizing: "Cloning conversation and personal settings…", opening: "Clone confirmed · Opening both pods", waking: "Two independent agents, ready for a new chapter",
  stepping: "Stepping out of the cloning pods", returning: "Returning to daily routines", complete: "Clone ready", failed: "Cloning was not confirmed",
};
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
export function cloneStage(seconds: number, result: CloneResult): CloneStage {
  if (result.status === "failed") return "failed";
  if (result.status !== "confirmed") return "synchronizing";
  return seconds < 3.4 ? "skeleton" : seconds < 6.2 ? "tissue" : seconds < 9.2 ? "skin" : seconds < 10.5 ? "opening" : seconds < 12.1 ? "waking" : seconds < 13.8 ? "stepping" : seconds < CLONE_DURATION ? "returning" : "complete";
}
export function cloneAnatomy(seconds: number) {
  return { bone: smooth((seconds - .4) / 2.6), tissue: smooth((seconds - 3.4) / 2.5), skin: smooth((seconds - 6.2) / 2.6) };
}
export function clonePose(seconds: number, index: number) {
  const t = Math.max(0, seconds - 9.2 - index * .13), rise = smooth((t - 1.3) / 1.5), step = smooth((t - 2.9) / 1.5), walk = smooth((t - 4.5) / 1.5);
  return { u: index ? 2 : -2, v: CLONING_POD.v - .65 - .3 * rise - (CLONING_POD.v + .35) * step - 1.1 * walk,
    y: .9 - .82 * step, tilt: -Math.PI / 2 * (1 - rise), walking: t >= 2.9 && t < 6,
    door: smooth((seconds - 9.2) / 1.1) * (1 - smooth((seconds - 15.1) / .9)) };
}
export type CloneArrival = { point: ShipPoint; deck: number; cabinId?: string };
export function rejoinCrewAfterClone(agent: MovingAgent, layout: ShipLayout, arrival: CloneArrival) {
  const seat = layout.seats[agent.id], cabin = layout.cabins.find(c => c.id === seat?.cabinId);
  if (!seat || !cabin || seat.deck !== arrival.deck) return;
  const lab=layout.cabins.find(c=>c.id===arrival.cabinId&&c.kind==="cloning");
  const departure=lab?cloningPoint(layout,lab,0,0):arrival.point;
  const ring = [...layout.rings].sort((a,b)=>Math.abs(a.radius-Math.hypot(departure.x,departure.z))-Math.abs(b.radius-Math.hypot(departure.x,departure.z)))[0];
  Object.assign(agent,canvasPoint(arrival.point));
  const route=routeBetweenCabins(layout,{ring:ring.index,angle:Math.atan2(departure.x,departure.z)},cabin,seat.angle);
  agent.route = [...(lab?[cloningPoint(layout,lab,0,CLONING_AISLE_V),...route.slice(1)]:route),agent.home];
  agent.routeIndex=0;agent.visiting=false;agent.breakVisit=undefined;agent.state="walking";agent.interactionTarget=undefined;
}
