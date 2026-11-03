import { routeBetweenCabins, type ShipLayout, type ShipPoint } from "./layout";
import { canvasPoint, type MovingAgent } from "./crewMotion";
import { cloningPoint } from "./cloningGeometry";
export { cloningPoint } from "./cloningGeometry";

export type CloneRequest = { agentId: string; requestId: string; name?: string; lastTurnId?: string };
export type CloneResult = { status: "pending" } | { status: "confirmed"; threadId: string; at: number } | { status: "failed"; error: string };
export type CloneStage = "synchronizing" | "opening" | "waking" | "stepping" | "returning" | "complete" | "failed";
export const CLONE_LABELS: Record<CloneStage, string> = {
  synchronizing: "Cloning conversation and personal settings…", opening: "Clone confirmed · Opening both pods", waking: "Two independent agents, ready for a new chapter",
  stepping: "Stepping out of the cloning pods", returning: "Returning to daily routines", complete: "Clone ready", failed: "Cloning was not confirmed",
};
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
export function cloneStage(seconds: number, result: CloneResult): CloneStage {
  if (result.status === "failed") return "failed";
  if (result.status !== "confirmed") return "synchronizing";
  return seconds < .8 ? "opening" : seconds < 2.1 ? "waking" : seconds < 3.8 ? "stepping" : seconds < 6 ? "returning" : "complete";
}
export function clonePose(seconds: number, index: number) {
  const t = Math.max(0, seconds - index * .13), rise = smooth((t - .65) / 1.35), step = smooth((t - 2) / 1.5), walk = smooth((t - 3.5) / 1.5);
  return { u: index ? 2 : -2, v: .4 - .3 * rise - 1.4 * step - 1.1 * walk,
    y: .66 - .58 * step, tilt: -Math.PI / 2 * (1 - rise), walking: t >= 2 && t < 5,
    door: smooth(seconds / .8) * (1 - smooth((seconds - 5.2) / .8)) };
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
  agent.route = [...(lab?[cloningPoint(layout,lab,0,-2.1),...route.slice(1)]:route),agent.home];
  agent.routeIndex=0;agent.visiting=false;agent.state="walking";agent.interactionTarget=undefined;
}
