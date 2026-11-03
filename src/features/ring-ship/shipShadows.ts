const FAR_INTERVAL = 1 / 15;

// Zoom is measured in CSS pixels per world unit, independent of device DPR.
// Keep the original shadows in close views; hysteresis avoids resizing while
// the camera settles near the boundary.
export function createShipShadowSchedule() {
  let near = true, lastUpdate = -Infinity, previousView = NaN;
  return (time: number, pixelsPerUnit: number, view: number, travelling = false) => {
    const nextNear = travelling || pixelsPerUnit >= (near ? 20 : 24);
    const update = nextNear || near !== nextNear || view !== previousView ||
      time < lastUpdate || time - lastUpdate >= FAR_INTERVAL - 1e-6;
    near = nextNear; previousView = view;
    if (update) lastUpdate = time;
    return { size: near ? 2048 : 1024, update };
  };
}
