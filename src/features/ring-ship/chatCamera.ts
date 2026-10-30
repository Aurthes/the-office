import { Vector3 } from "three";
import type { ShipPoint } from "./layout";

export function chatCameraPose(point: ShipPoint, width: number, height: number, panelLeft: number, floorY = 0) {
  // Frame the person in the uncovered part of the canvas, not behind the chat.
  const visible = panelLeft >= 160 ? Math.min(width, panelLeft) : width;
  const zoom = Math.max(18, Math.min(80, visible / 12, height / 10));
  const offset = new Vector3(12, 16, 16), right = new Vector3(offset.z, 0, -offset.x).normalize();
  const target = new Vector3(point.x, floorY + 0.6, point.z).addScaledVector(right, (width - visible) / (2 * zoom));
  return { target, position: target.clone().add(offset), zoom };
}
