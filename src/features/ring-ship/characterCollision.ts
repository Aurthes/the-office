import { normalizeDuckAppearance } from "@/lib/avatars/duck";
import type { OfficeAgent } from "@/features/retro-office/core/types";
import type { ShipLayout, ShipPoint } from "./layout";
import { footingRadius, isWalkable, nearestWalkablePoint, walkableSegment } from "./walkableSurface";

export type CharacterBody = { id: string; position: ShipPoint; radius: number; deck: number };
export type CharacterRecovery = { goal: ShipPoint; best: number; stalled: number; attempts: number; retreat?: ShipPoint; remaining: number; wait: number };
type Walker = { recovery?: CharacterRecovery };
const GAP = .03;

export function crewRadius(agent: Pick<OfficeAgent, "avatarProfile">) {
  const appearance = normalizeDuckAppearance(agent.avatarProfile?.duck);
  return .38 * Math.max(appearance.bodyWidth, appearance.bodyDepth) + .03;
}

export function occupiedWaypoint(body: CharacterBody, target: ShipPoint, others: readonly CharacterBody[]) {
  return others.some(other => other.id !== body.id && other.deck === body.deck
    && Math.hypot(target.x - other.position.x, target.z - other.position.z) < body.radius + other.radius + GAP);
}

export function separateCharacter(body: CharacterBody, stride: number, others: readonly CharacterBody[], layout?: ShipLayout, clearance = 0): ShipPoint {
  if (layout && !isWalkable(body.position, layout, footingRadius(body.radius), body.deck)) return moveCharacter(body, body.position, 0, others, true, layout);
  const overlap = others.find(other => other.id !== body.id && other.deck === body.deck
    && Math.hypot(body.position.x - other.position.x, body.position.z - other.position.z) < body.radius + other.radius + GAP + clearance - 1e-6);
  if (!overlap) return body.position;
  let x = body.position.x - overlap.position.x, z = body.position.z - overlap.position.z;
  if (Math.hypot(x, z) < 1e-8) { x = body.id < overlap.id ? -1 : 1; z = 0; }
  return moveCharacter(body, { x: body.position.x + x, z: body.position.z + z }, stride, others, true, layout);
}

// Walk on the ground plane. Try the direct step first, then slide around the
// occupied space, preferring the right side so approaching walkers can pass.
export function moveCharacter(body: CharacterBody, target: ShipPoint, stride: number, others: readonly CharacterBody[], slide = true, layout?: ShipLayout): ShipPoint {
  const padding = footingRadius(body.radius);
  if (layout && !isWalkable(body.position, layout, padding, body.deck)) return nearestWalkablePoint(body.position, layout, padding, body.deck, point => !occupiedWaypoint(body, point, others));
  const start = body.position, dx = target.x - start.x, dz = target.z - start.z;
  const distance = Math.hypot(dx, dz), step = Math.min(stride, distance);
  if (step <= 0 || distance < 1e-8) return { ...start };
  // Look past this frame's tiny step, so walkers choose a clear side instead
  // of repeatedly stepping into and backing out of the same blocked gap.
  const probe = slide ? Math.min(distance, Math.max(step, body.radius * .75)) : step;
  const nearby = others.filter(other => other.id !== body.id && other.deck === body.deck
    && Math.hypot(start.x - other.position.x, start.z - other.position.z) < body.radius + other.radius + GAP + probe);
  const direction = Math.atan2(dx, dz);
  // Prefer the smallest detour; use the right side to break equal turns.
  const angles = slide ? [0, Math.PI / 12, -Math.PI / 12, Math.PI / 6, -Math.PI / 6, Math.PI / 4, -Math.PI / 4, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2, Math.PI * 2 / 3, -Math.PI * 2 / 3, Math.PI * 5 / 6, -Math.PI * 5 / 6, Math.PI] : [0];
  for (const angle of angles) {
    const x = Math.sin(direction + angle) * probe, z = Math.cos(direction + angle) * probe;
    const next = { x: start.x + x * step / probe, z: start.z + z * step / probe };
    if (layout && !walkableSegment(start, { x: start.x + x, z: start.z + z }, layout, padding, body.deck)) continue;
    if (nearby.every(other => {
      const radius = body.radius + other.radius + GAP;
      const ox = start.x - other.position.x, oz = start.z - other.position.z;
      const before = Math.hypot(ox, oz), after = Math.hypot(next.x - other.position.x, next.z - other.position.z);
      // Recover an existing overlap by moving out, never further into it.
      if (before < radius - 1e-7) return ox * x + oz * z >= -1e-9 && after > before + 1e-8;
      const t = Math.max(0, Math.min(1, -(ox * x + oz * z) / (probe * probe)));
      return Math.hypot(ox + x * t, oz + z * t) >= radius - 1e-7;
    })) return next;
  }
  return { ...start };
}

// Commit to a short retreat instead of oscillating against the same obstacle.
// Actor-owned state survives metadata refreshes; staggered retries avoid a crowd
// stepping backwards and forwards in sync. All movement still uses swept collision.
export function walkCharacter(owner: Walker, body: CharacterBody, target: ShipPoint, stride: number, delta: number, others: readonly CharacterBody[], layout: ShipLayout): ShipPoint {
  const dt=Math.min(Math.max(delta,0),.05),distance=Math.hypot(target.x-body.position.x,target.z-body.position.z);
  if(!dt||stride<=0)return body.position;
  if(!owner.recovery||Math.hypot(owner.recovery.goal.x-target.x,owner.recovery.goal.z-target.z)>.02){
    owner.recovery={goal:{...target},best:distance,stalled:0,attempts:0,remaining:0,wait:0};
  }
  const state=owner.recovery;
  let seed=0;for(const char of body.id)seed=(seed*31+char.charCodeAt(0))>>>0;
  if(state.retreat){
    const next=moveCharacter(body,state.retreat,stride,others,true,layout);state.remaining-=dt;
    if(Math.hypot(next.x-state.retreat.x,next.z-state.retreat.z)<.04||state.remaining<=0){
      state.retreat=undefined;state.wait=1+(seed%5)*.12;state.best=Math.hypot(target.x-next.x,target.z-next.z);state.stalled=0;
    }
    return next;
  }
  if(state.wait>0){state.wait-=dt;return separateCharacter(body,stride,others,layout);}
  const next=moveCharacter(body,target,stride,others,true,layout),remaining=Math.hypot(target.x-next.x,target.z-next.z);
  if(remaining<.02||remaining<state.best-.08){state.best=remaining;state.stalled=0;return next;}
  state.stalled+=dt;
  const threshold=.9+((seed+state.attempts*7)%6)*.1;
  if(state.stalled<threshold)return next;
  const nearby=others.filter(other=>other.id!==body.id&&other.deck===body.deck&&Math.hypot(other.position.x-body.position.x,other.position.z-body.position.z)<body.radius+other.radius+1.1);
  if(nearby.some(other=>other.id>body.id)&&state.stalled<threshold+.45)return next;
  const direction=Math.atan2(target.x-body.position.x,target.z-body.position.z),length=Math.min(1.25,body.radius*1.5+.35);
  state.attempts++;state.stalled=0;state.best=distance;
  let escape:ShipPoint|undefined,score=-Infinity;
  for(const scale of [1,.6])for(const angle of [Math.PI*.75,Math.PI/2,-Math.PI*.75,-Math.PI/2,Math.PI,Math.PI/4,-Math.PI/4,0]){
    const point={x:body.position.x+Math.sin(direction+angle)*length*scale,z:body.position.z+Math.cos(direction+angle)*length*scale};
    if(occupiedWaypoint(body,point,others))continue;
    const probe=moveCharacter(body,point,length*scale,others,false,layout);
    if(Math.hypot(probe.x-point.x,probe.z-point.z)>.001)continue;
    const clearance=others.reduce((gap,other)=>other.id===body.id||other.deck!==body.deck?gap:Math.min(gap,Math.hypot(point.x-other.position.x,point.z-other.position.z)-body.radius-other.radius),2);
    const value=clearance+.1*(Math.hypot(point.x-target.x,point.z-target.z)-distance);
    if(value>score){escape=point;score=value;}
  }
  if(escape){state.retreat=escape;state.remaining=Math.min(2.5,Math.hypot(escape.x-body.position.x,escape.z-body.position.z)/(stride/dt)+.4);return moveCharacter(body,escape,stride,others,true,layout);}
  state.wait=.3+(seed%5)*.1;
  return next;
}
