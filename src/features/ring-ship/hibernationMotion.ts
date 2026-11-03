import type { ShipPoint } from "./layout";
import { HIBERNATION } from "./hibernationLayout";

export type SleepPose = ShipPoint & { y: number; tilt: number };
export type HibernationState = {
  cabinId: string; pod: number; phase: "travelling" | "entering" | "sleeping" | "waking" | "leaving" | "returning";
  time: number; wakeFrom?: SleepPose;
};
export function insideHibernation(state?: HibernationState) {
  return !!state && !["travelling", "returning"].includes(state.phase);
}
const ease = (t: number) => { const p = Math.max(0, Math.min(1, t)); return p * p * (3 - 2 * p); };
function mix(a: SleepPose, b: SleepPose, t: number): SleepPose {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: a.y + (b.y - a.y) * t, tilt: a.tilt + (b.tilt - a.tilt) * t };
}
export function sleepPose(state: HibernationState, pod: { entry: ShipPoint; rest: ShipPoint }): SleepPose | undefined {
  const entry = { ...pod.entry, y: .08, tilt: 0 }, standing = { ...pod.rest, y: HIBERNATION.bedHeight, tilt: 0 };
  const resting = { ...standing, tilt: -Math.PI / 2 };
  if (state.phase === "entering") {
    return state.time < .8 ? mix(entry, standing, ease(state.time / .8)) : mix(standing, resting, ease((state.time - .8) / .8));
  }
  if (state.phase === "sleeping") return resting;
  if (state.phase === "waking") {
    const from = state.wakeFrom ?? resting;
    return mix(from, { ...from, tilt: 0 }, ease((state.time - .2) / .8));
  }
  if (state.phase === "leaving") return mix(state.wakeFrom ?? standing, entry, ease(state.time / 1));
}
export function sleepLid(state?: HibernationState) {
  if (!state || state.phase === "travelling" || state.phase === "returning" || state.phase === "leaving") return 1;
  if (state.phase === "sleeping") return 0;
  if (state.phase === "waking") return ease(state.time / .25);
  return 1 - ease((state.time - 1.35) / .45);
}
