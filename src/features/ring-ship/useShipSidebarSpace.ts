import { useLayoutEffect, type RefObject } from "react";

/** Reserve the left summary's visible height without counting the right HUD. */
export function useShipSidebarSpace(rootRef: RefObject<HTMLElement | null>, summaryRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const root = rootRef.current, summary = summaryRef.current;
    const hud = summary?.closest<HTMLElement>(".ship-bottom-hud");
    if (!root || !summary || !hud) return;
    const update = () => {
      const card = summary.getBoundingClientRect(), viewport = hud.getBoundingClientRect();
      const height = Math.max(0, Math.min(card.bottom, viewport.bottom) - Math.max(card.top, viewport.top));
      const value = `${Math.ceil(height)}px`;
      if (root.style.getPropertyValue("--ship-summary-height") !== value) root.style.setProperty("--ship-summary-height", value);
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(summary); observer?.observe(hud);
    hud.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect(); hud.removeEventListener("scroll", update); window.removeEventListener("resize", update);
      root.style.removeProperty("--ship-summary-height");
    };
  }, [rootRef, summaryRef]);
}
