import { AGENT_RADIUS } from "../core/constants";
import type { CanvasPoint, RenderAgent } from "../core/types";
import type { CollisionWorld } from "../core/collision";

export const actorSeatPermission = (agent: RenderAgent) => {
  const seat = agent.workstation;
  return seat?.chairUid && agent.interactionTarget === "desk"
    && (agent.state === "sitting" || Math.hypot(agent.targetX - seat.x, agent.targetY - seat.y) < 1)
    ? seat.chairUid : undefined;
};
const anchored = (agent: RenderAgent) => agent.state === "sitting" || agent.state === "working_out" || agent.state === "dancing"
  || (agent.state === "standing" && agent.status === "working" && agent.interactionTarget === "desk"
    && Math.hypot(agent.x - agent.targetX, agent.y - agent.targetY) < 1);
const pairs = (agents: RenderAgent[], before?: Map<string, RenderAgent>) => {
  const buckets = new Map<string, number[]>(), result: [number, number][] = [], seen = new Set<string>(), size = AGENT_RADIUS * 4;
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i], old = before?.get(a.id) ?? a;
    for (let y = Math.floor((Math.min(a.y, old.y) - AGENT_RADIUS) / size); y <= Math.floor((Math.max(a.y, old.y) + AGENT_RADIUS) / size); y++) {
      for (let x = Math.floor((Math.min(a.x, old.x) - AGENT_RADIUS) / size); x <= Math.floor((Math.max(a.x, old.x) + AGENT_RADIUS) / size); x++) {
        const key = `${x}:${y}`, bucket = buckets.get(key) ?? [];
        for (const j of bucket) {
          const pairKey = `${j}:${i}`;
          if (!seen.has(pairKey)) { seen.add(pairKey); result.push([j, i]); }
        }
        bucket.push(i); buckets.set(key, bucket);
      }
    }
  }
  return result;
};

/** Continuous body sweeps + separation, constrained by the same static world. */
export function resolveAgentCollisions({ agents, previous, world }: {
  agents: RenderAgent[]; previous: RenderAgent[]; world: CollisionWorld;
}): { agents: RenderAgent[]; blocked: Set<string> } {
  const before = new Map(previous.map(a => [a.id, a])), blocked = new Set<string>();
  const moved = agents.map(a => {
    const old = before.get(a.id), ignore = actorSeatPermission(a);
    const p = old ? world.move(old, a, ignore) : world.resolve(a, ignore);
    if (Math.hypot(p.x - a.x, p.y - a.y) > .01) blocked.add(a.id);
    return { ...a, x: p.x, y: p.y };
  });
  const diameter = AGENT_RADIUS * 2;
  for (const [i, j] of pairs(moved, before)) {
    const a = moved[i], b = moved[j], oldA = before.get(a.id) ?? a, oldB = before.get(b.id) ?? b;
    const x = oldA.x - oldB.x, y = oldA.y - oldB.y;
    const dx = a.x - oldA.x - b.x + oldB.x, dy = a.y - oldA.y - b.y + oldB.y;
    const aa = dx * dx + dy * dy, bb = 2 * (x * dx + y * dy), cc = x * x + y * y - diameter * diameter;
    const disc = bb * bb - 4 * aa * cc;
    if (cc < 0 || aa < 1e-10 || bb >= 0 || disc < 0) continue;
    const t = (-bb - Math.sqrt(disc)) / (2 * aa);
    if (t < 0 || t > 1) continue;
    const safeT = Math.max(0, t - .001);
    for (const [agent, old] of [[a, oldA], [b, oldB]]) {
      agent.x = old.x + (agent.x - old.x) * safeT;
      agent.y = old.y + (agent.y - old.y) * safeT;
      blocked.add(agent.id);
    }
  }
  for (let pass = 0; pass < 8; pass++) {
    let overlap = false;
    for (const [i, j] of pairs(moved)) {
      const a = moved[i], b = moved[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
      if (d >= diameter + .01) continue;
      overlap = true; blocked.add(a.id); blocked.add(b.id);
      const nx = d > 1e-6 ? dx / d : (i % 2 ? 0 : 1), ny = d > 1e-6 ? dy / d : (i % 2 ? 1 : 0);
      const fixedA = anchored(a), fixedB = anchored(b), shareA = fixedA ? 0 : fixedB ? 1 : .5;
      const push = diameter + .02 - d;
      const shift = (actor: RenderAgent, x: number, y: number) => {
        const p = world.move(actor, { x, y }, actorSeatPermission(actor)); actor.x = p.x; actor.y = p.y;
      };
      if (shareA) shift(a, a.x + nx * push * shareA, a.y + ny * push * shareA);
      shift(b, b.x - nx * push * (1 - shareA), b.y - ny * push * (1 - shareA));
      // If a wall stopped one half of the correction, give the other body the
      // remaining room instead of pushing either one into that wall.
      const remaining = diameter + .02 - Math.hypot(a.x - b.x, a.y - b.y);
      if (remaining > .01 && !fixedA) shift(a, a.x + nx * remaining, a.y + ny * remaining);
      if (remaining > .01 && (!fixedB || fixedA)) shift(b, b.x - nx * remaining, b.y - ny * remaining);
    }
    if (!overlap) break;
  }
  // Resolve coincident spawns and bodies trapped in a corner. This runs only
  // for actual residual overlaps, never for normal walking frames.
  for (const i of moved.map((_, i) => i).sort((i, j) => Number(anchored(moved[i])) - Number(anchored(moved[j])))) {
    const a = moved[i];
    const occupied = (p: CanvasPoint) => moved.some((b, j) => i !== j && Math.hypot(p.x - b.x, p.y - b.y) < diameter);
    if (!occupied(a)) continue;
    let found: CanvasPoint | undefined;
    for (let ring = 1; ring <= 20 && !found; ring++) for (let angle = 0; angle < 24; angle++) {
      const p = { x: a.x + Math.cos(angle * Math.PI / 12) * ring * AGENT_RADIUS, y: a.y + Math.sin(angle * Math.PI / 12) * ring * AGENT_RADIUS };
      if (world.clear(p, actorSeatPermission(a)) && !occupied(p)) { found = p; break; }
    }
    if (found) { a.x = found.x; a.y = found.y; blocked.add(a.id); }
  }
  for (const a of moved) {
    const desired = agents.find(source => source.id === a.id)!;
    if (Math.hypot(a.x - desired.x, a.y - desired.y) > .05 && a.state !== "walking") a.state = "standing";
  }
  return { agents: moved, blocked };
}
