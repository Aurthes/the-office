import { AGENT_SCALE } from "@/features/retro-office/core/constants";
import type { createDuckCrewFigure } from "./duckCrewFigure";
import type { CeoState } from "./ceoMotion";
import { BREAK_ROOM, breakAction } from "./breakRoomLayout";
import { applyBreakPose } from "./breakPose";

export function animateCeoFigure(rig: ReturnType<typeof createDuckCrewFigure>, state: CeoState, seatHeight: number, delta: number) {
  const moving = !!state.route.length, walking = state.walking, takingBreak = !moving && !!state.breakVisit;
  const seated = !moving && (state.action === "monitor" || takingBreak);
  const t = state.time, stride = Math.sin(state.elapsed * 8), rate = 1 - Math.exp(-Math.min(delta, .05) * 12);
  const blend = (old: number, target: number) => old + (target - old) * rate;
  const coffee = !moving && state.action === "coffee";
  const sip = coffee ? Math.pow(.5 + .5 * Math.sin(t * 1.8), 4) : 0;
  const stretch = !moving && state.action === "stretch" ? Math.sin(Math.PI * Math.min(1, t / state.duration)) : 0;
  const review = !moving && state.action === "review", thinking = !moving && state.action === "think";
  const dance = !moving && state.action === "celebrate", greet = !moving && state.action === "patrol";
  const height = seated ? Math.max(0, ((takingBreak ? BREAK_ROOM.seatHeight : seatHeight) - .08) / AGENT_SCALE - .065) : 0;
  rig.root.position.y = blend(rig.root.position.y, height + (walking ? Math.abs(stride) * .015 : dance ? Math.abs(Math.sin(t * 9)) * .045 : Math.sin(state.elapsed * 2) * .003));
  rig.body.rotation.x = blend(rig.body.rotation.x, seated ? .07 + Math.sin(t * 1.4) * .025 : review ? .1 : sip * .06 - stretch * .12);
  rig.body.rotation.y = blend(rig.body.rotation.y, seated ? Math.sin(t * .7) * .12 : dance ? Math.sin(t * 6) * .25 : Math.sin(state.elapsed * .7) * .045);
  rig.body.rotation.z = blend(rig.body.rotation.z, walking ? stride * .05 : dance ? Math.sin(t * 9) * .12 : thinking ? .07 : 0);
  rig.wings.forEach((wing, index) => {
    const side = index ? 1 : -1;
    const x = walking ? side * stride * .34 : seated ? -.9 + Math.sin(t * 8 + index * Math.PI) * .07
      : review ? -1.5 + (index ? Math.sin(t * 6) * .1 : 0) : thinking && index ? -1.7 : coffee && !index ? -.9 - sip * 1.55 : 0;
    const spread = stretch * 2.05 + (dance ? 2.2 + Math.sin(t * 9) * .18 : greet && index ? 1.9 + Math.sin(t * 8) * .2 : review ? .12 : -.45 * sip + .03);
    wing.rotation.x = blend(wing.rotation.x, x); wing.rotation.z = blend(wing.rotation.z, side * spread);
    wing.position.y = blend(wing.position.y, .30 + (!index ? .035 * sip : 0));
    wing.position.z = blend(wing.position.z, review ? .065 : .008);
  });
  rig.feet.forEach((foot, index) => {
    const step = (index ? -1 : 1) * stride;
    foot.rotation.x = blend(foot.rotation.x, walking ? step * .48 : seated ? -.5 : dance ? Math.sin(t * 9 + index * Math.PI) * .3 : 0);
    foot.position.y = blend(foot.position.y, .075 + (walking ? Math.max(0, step) * .024 : dance ? Math.max(0, Math.sin(t * 9 + index * Math.PI)) * .035 : seated ? .015 : 0));
  });
  if (takingBreak) applyBreakPose(rig, breakAction(state.breakVisit!), state.time);
  return { sip, tablet: review, cup: !moving && state.action === "coffee" };
}
