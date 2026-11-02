import { normalizeDuckAppearance } from "@/lib/avatars/duck";
import type { OfficeAgent } from "@/features/retro-office/core/types";
import type { ShipPoint } from "./layout";

export type CharacterBody = { id: string; position: ShipPoint; radius: number; deck: number };
const GAP = .03;

export function crewRadius(agent: Pick<OfficeAgent, "avatarProfile">) {
  const appearance = normalizeDuckAppearance(agent.avatarProfile?.duck);
  return .38 * Math.max(appearance.bodyWidth, appearance.bodyDepth) + .03;
}

export function occupiedWaypoint(body: CharacterBody, target: ShipPoint, others: readonly CharacterBody[]) {
  return others.some(other => other.id !== body.id && other.deck === body.deck
    && Math.hypot(target.x - other.position.x, target.z - other.position.z) < body.radius + other.radius + GAP);
}

export function separateCharacter(body: CharacterBody, stride: number, others: readonly CharacterBody[]): ShipPoint {
  const overlap = others.find(other => other.id !== body.id && other.deck === body.deck
    && Math.hypot(body.position.x - other.position.x, body.position.z - other.position.z) < body.radius + other.radius + GAP - 1e-6);
  if (!overlap) return body.position;
  let x = body.position.x - overlap.position.x, z = body.position.z - overlap.position.z;
  if (Math.hypot(x, z) < 1e-8) { x = body.id < overlap.id ? -1 : 1; z = 0; }
  return moveCharacter(body, { x: body.position.x + x, z: body.position.z + z }, stride, others);
}

// Walk on the ground plane. Try the direct step first, then slide around the
// occupied space, preferring the right side so approaching walkers can pass.
export function moveCharacter(body: CharacterBody, target: ShipPoint, stride: number, others: readonly CharacterBody[], slide = true): ShipPoint {
  const start = body.position, dx = target.x - start.x, dz = target.z - start.z;
  const distance = Math.hypot(dx, dz), step = Math.min(stride, distance);
  if (step <= 0 || distance < 1e-8) return { ...start };
  // Look past this frame's tiny step, so walkers choose a clear side instead
  // of repeatedly stepping into and backing out of the same blocked gap.
  const probe = slide ? Math.min(distance, Math.max(step, body.radius * .75)) : step;
  const nearby = others.filter(other => other.id !== body.id && other.deck === body.deck
    && Math.hypot(start.x - other.position.x, start.z - other.position.z) < body.radius + other.radius + GAP + probe);
  const direction = Math.atan2(dx, dz);
  // Keep the same preferred side, including a backstep when boxed in.
  const angles = slide ? [0, Math.PI / 12, Math.PI / 6, Math.PI / 4, Math.PI / 3, Math.PI / 2, Math.PI * 2 / 3, Math.PI * 5 / 6, Math.PI, -Math.PI / 12, -Math.PI / 6, -Math.PI / 4, -Math.PI / 3, -Math.PI / 2, -Math.PI * 2 / 3, -Math.PI * 5 / 6] : [0];
  for (const angle of angles) {
    const x = Math.sin(direction + angle) * probe, z = Math.cos(direction + angle) * probe;
    const next = { x: start.x + x * step / probe, z: start.z + z * step / probe };
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
