import * as THREE from "three";
import type { ShipPoint } from "./layout";

export type LaunchOpening = ShipPoint & { radius: number };

// Cut a vertical launch shaft through a curved belly. The small boundary facets
// sit underneath its circular collar; all other vertex attributes stay intact.
export function cutLaunchOpening(geometry: THREE.BufferGeometry, opening: LaunchOpening) {
  const positions = geometry.getAttribute("position"), index = geometry.getIndex();
  const count = index ? index.count : positions.count, kept: number[] = [];
  const triangle = new THREE.Triangle(), center = new THREE.Vector3(opening.x, 0, opening.z), nearest = new THREE.Vector3();
  for (let i = 0; i < count; i += 3) {
    const ids = [0, 1, 2].map(j => index ? index.getX(i + j) : i + j);
    [triangle.a, triangle.b, triangle.c].forEach((p, j) => p.set(positions.getX(ids[j]), 0, positions.getZ(ids[j])));
    triangle.closestPointToPoint(center, nearest);
    if (nearest.distanceToSquared(center) > opening.radius ** 2) kept.push(...ids);
  }
  geometry.setIndex(kept);
  return geometry;
}

// A curved, tangent-continuous bullet nose, with its tip pointing down.
export function returnPodNose() {
  return new THREE.CubicBezierCurve(
    new THREE.Vector2(0, -3.65), new THREE.Vector2(.18, -3.65),
    new THREE.Vector2(.76, -3.12), new THREE.Vector2(.76, -2.25),
  ).getPoints(18);
}
