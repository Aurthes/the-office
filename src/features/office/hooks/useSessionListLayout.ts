"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { sessionListNeedsOverlay } from "../operations/sessionListLayout";

export function useSessionListLayout(enabled: boolean) {
  const container = useRef<HTMLDivElement>(null);
  const [overlay, setOverlay] = useState(false);
  const update = useCallback(() => {
    const node = container.current;
    if (!node || !enabled) return;
    const total = node.getBoundingClientRect().width;
    if (!total) return; // A closed chat retains its last measured mode and width.
    const preferred = parseFloat(node.style.getPropertyValue("--session-list-width"));
    const divider = parseFloat(getComputedStyle(node).getPropertyValue("--session-list-divider-width")) || 8;
    // Never use the overlay's actual list/chat width to decide the next mode.
    setOverlay(sessionListNeedsOverlay(total, Number.isFinite(preferred) ? preferred : undefined, divider));
  }, [enabled]);
  useLayoutEffect(() => {
    const node = container.current;
    if (!node || !enabled) return;
    // ResizeObserver also delivers the initial measurement, including on reopen.
    const observer = new ResizeObserver(update);
    observer.observe(node);
    const pointer = window.matchMedia("(pointer: coarse)");
    pointer.addEventListener("change", update);
    return () => { observer.disconnect(); pointer.removeEventListener("change", update); };
  }, [enabled, update]);
  return { container, overlay, update };
}
