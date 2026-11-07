"use client";
import { useCallback, useRef, useState, type SetStateAction } from "react";
import { sessionListNeedsOverlay } from "../operations/sessionListLayout";

export function useSessionListLayout(enabled: boolean) {
  const container = useRef<HTMLDivElement>(null);
  const [overlay, setOverlay] = useState(false);
  const [collapsed, setCollapsedState] = useState(false);
  const openingChat = useRef(false);
  const setCollapsed = useCallback((next: SetStateAction<boolean>) => {
    openingChat.current = false; // A deliberate list action overrides pending navigation.
    setCollapsedState(next);
  }, []);
  const update = useCallback(() => {
    const node = container.current;
    if (!node || !enabled) return;
    const total = node.getBoundingClientRect().width;
    if (!total) return; // A closed chat retains its last measured mode and width.
    const preferred = parseFloat(node.style.getPropertyValue("--session-list-width"));
    const divider = parseFloat(getComputedStyle(node).getPropertyValue("--session-list-divider-width")) || 8;
    // Never use the overlay's actual list/chat width to decide the next mode.
    const nextOverlay = sessionListNeedsOverlay(total, Number.isFinite(preferred) ? preferred : undefined, divider);
    setOverlay(nextOverlay);
    if (openingChat.current) {
      openingChat.current = false;
      setCollapsedState(nextOverlay);
    }
  }, [enabled]);
  const openChat = useCallback(() => {
    if (!enabled) { setCollapsed(false); return; }
    // Hidden first openings have no width yet. Keep the selected chat clear until
    // the first real measurement; subsequent resizes preserve deliberate toggles.
    openingChat.current = true;
    setCollapsedState(true);
    update();
  }, [enabled, setCollapsed, update]);
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    container.current = node;
    if (!node || !enabled) return;
    // ResizeObserver also delivers the initial measurement, including on reopen.
    const observer = new ResizeObserver(update);
    observer.observe(node);
    const pointer = window.matchMedia("(pointer: coarse)");
    pointer.addEventListener("change", update);
    return () => { observer.disconnect(); pointer.removeEventListener("change", update); container.current = null; };
  }, [enabled, update]);
  return { container, containerRef, overlay, update, collapsed, setCollapsed, openChat };
}
