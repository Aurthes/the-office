"use client";

import { useLayoutEffect, useRef } from "react";
import { useUiText } from "@/lib/i18n/ui-language";
import { sessionListWidth } from "../operations/sessionListLayout";

export function SessionListDivider({ onResize, pane = "list" }: { onResize?: () => void; pane?: "list" | "workspace" }) {
  const t = useUiText();
  const handleRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const handle = handleRef.current, container = handle?.parentElement, list = handle?.previousElementSibling;
    if (!handle || !container || !list) return;
    const update = () => {
      const total = container.getBoundingClientRect().width - (pane === "workspace" ? handle.getBoundingClientRect().width : 0);
      if (!total) return;
      handle.setAttribute("aria-valuenow", String(Math.round(list.getBoundingClientRect().width / total * 100)));
      const minimum = pane === "workspace" ? Math.min(200, total / 2) : 96;
      const maximum = pane === "workspace" ? total - minimum : sessionListWidth(total, 360);
      handle.setAttribute("aria-valuemin", String(Math.round(minimum / total * 100)));
      handle.setAttribute("aria-valuemax", String(Math.round(maximum / total * 100)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container); observer.observe(list);
    return () => observer.disconnect();
  }, [pane]);
  const resize = (handle: HTMLDivElement, width: number) => {
    const container = handle.parentElement;
    if (!container) return;
    const total = container.getBoundingClientRect().width;
    if (!total) return;
    if (pane === "workspace") {
      const available = Math.max(0, total - handle.getBoundingClientRect().width);
      const minimum = Math.min(200, available / 2);
      const next = Math.max(minimum, Math.min(width, available - minimum));
      // Percentages follow later frame resizes without a new saved preference.
      container.style.setProperty("--session-conversation-width", `${next / total * 100}%`);
    } else {
      container.style.setProperty("--session-list-width", `${sessionListWidth(total, width)}px`);
    }
    onResize?.();
  };

  return <div ref={handleRef} role="separator" aria-label={t(pane === "workspace" ? "Resize chat and workspace" : "Resize session list")} aria-orientation="vertical"
    aria-valuemin={0} aria-valuemax={pane === "workspace" ? 100 : 50} aria-valuenow={40} tabIndex={0} className={`session-list-divider${pane === "workspace" ? " session-workspace-divider" : ""}`}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag.current = { id: event.pointerId, x: event.clientX, width: event.currentTarget.previousElementSibling?.getBoundingClientRect().width ?? 240 };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (start?.id === event.pointerId) resize(event.currentTarget, start.width + event.clientX - start.x);
    }}
    onPointerUp={() => { drag.current = null; }}
    onPointerCancel={() => { drag.current = null; }}
    onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const width = event.currentTarget.previousElementSibling?.getBoundingClientRect().width ?? 240;
      resize(event.currentTarget, width + (event.key === "ArrowRight" ? 16 : -16));
    }} />;
}
