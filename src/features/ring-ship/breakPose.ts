import type { createDuckCrewFigure } from "./duckCrewFigure";
import type { BreakAction } from "./breakRoomLayout";

export type BreakPoseState = { action: BreakAction | null; time: number };
export function applyBreakPose(rig: ReturnType<typeof createDuckCrewFigure>, action: BreakAction, time: number) {
  const sip = Math.pow(.5 + .5 * Math.sin(time * 1.6), 5), talking = action === "chat";
  rig.body.rotation.x = sip * .045;
  rig.body.rotation.y = talking ? Math.sin(time * 1.5) * .1 : Math.sin(time * .5) * .04;
  rig.wings[0].rotation.x = -.85 - sip * (action === "snack" ? 1.1 : 1.45);
  rig.wings[0].rotation.z = .12 + sip * .3;
  rig.wings[1].rotation.x = talking ? -.7 + Math.sin(time * 3) * .35 : -.2;
  rig.wings[1].rotation.z = talking ? .7 + Math.sin(time * 2.4) * .25 : -.03;
}
