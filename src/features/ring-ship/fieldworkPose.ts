import type { createDuckCrewFigure } from "./duckCrewFigure";
import type { FieldworkState } from "./fieldwork";

export function animateFieldwork(figure: ReturnType<typeof createDuckCrewFigure>, field: FieldworkState, frame: number, walking: boolean) {
  const t = field.time, action = field.phase, tools = figure.fieldTools;
  if (!tools) return;
  Object.values(tools).forEach(tool => { tool.visible = false; });
  if (walking || action === "lift") return;
  figure.wings.forEach((wing, i) => { wing.rotation.x = -.65; wing.rotation.z = (i ? 1 : -1) * .16; });
  if (action === "changing" || action === "packing") {
    figure.root.position.y -= Math.sin(Math.min(1, t / 1.8) * Math.PI) * .055;
    figure.body.rotation.x = .1;
    figure.wings[1].rotation.x = -1.8 + Math.sin(t * 8) * .14;
    return;
  }
  if (action === "notes") {
    tools.notebook.visible = tools.pencil.visible = true;
    tools.pencil.position.x = .045 + Math.sin(frame * .21) * .025;
    tools.pencil.position.y = .34 + Math.sin(frame * .13) * .018;
    figure.body.rotation.x = .09; figure.body.rotation.y = 0;
    figure.wings[1].rotation.x = -1.05 + Math.sin(frame * .21) * .08;
  } else if (action === "blueprint") {
    tools.blueprint.visible = true;
    tools.blueprint.rotation.z = Math.sin(t * .8) * .05;
    figure.body.rotation.x = .08; figure.body.rotation.y = Math.sin(t * .6) * .08;
    figure.wings.forEach(wing => { wing.rotation.x = -.95; });
  } else if (action === "measure") {
    tools.tape.visible = true;
    figure.body.rotation.x = .16; figure.wings[1].rotation.x = -1.1;
    tools.tape.rotation.z = Math.sin(t * .7) * .12;
  } else {
    figure.body.rotation.y = Math.sin(t * .6) * .24;
    figure.body.rotation.x = -.035 + Math.sin(t * .8) * .025;
    figure.wings[1].rotation.x = -1.5 + Math.sin(t * .9) * .15;
  }
}
