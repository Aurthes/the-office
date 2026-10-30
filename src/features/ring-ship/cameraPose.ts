import { Vector3 } from "three";
import { areaBounds, DECK_STEP, type DeckIndex, type ShipLayout } from "./layout";

export function shipCameraPose(layout: ShipLayout, width: number, height: number, deck: DeckIndex, whole = false, focus = "") {
  const bounds = areaBounds(layout, whole ? "" : focus), span = Math.max(bounds.width, bounds.depth);
  const target = new Vector3(bounds.x, (whole ? DECK_STEP : deck * DECK_STEP) - 0.3, bounds.z);
  const zoom = focus && !whole ? Math.min(width / (span * 1.35 + 7), height / (span * 0.8 + 8))
    : Math.min(width / (layout.radius * 2.65), height / (layout.radius * 1.82 + (whole ? DECK_STEP * 2 : 0)));
  const offset = new Vector3(70, 73, 94);
  if (focus && !whole) offset.set(25, 29, 38).applyAxisAngle(new Vector3(0, 1, 0), Math.atan2(bounds.x, bounds.z));
  return { target, position: target.clone().add(offset), zoom: Math.max(0.2, zoom * 0.92) };
}
