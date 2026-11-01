"use client";

import { useLayoutEffect, useRef } from "react";
import { useUiText } from "@/lib/i18n/ui-language";

export function SessionListDivider() {
  const t = useUiText();
  const handleRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const handle = handleRef.current, container = handle?.parentElement, list = handle?.previousElementSibling;
    if (!handle || !container || !list) return;
    const update = () => {
      const total = container.getBoundingClientRect().width;
      if (!total) return;
      handle.setAttribute("aria-valuenow", String(Math.round(list.getBoundingClientRect().width / total * 100)));
      handle.setAttribute("aria-valuemin", String(Math.round(96 / total * 100)));
      handle.setAttribute("aria-valuemax", String(Math.round(Math.max(96, Math.min(360, total / 2, total - 212)) / total * 100)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container); observer.observe(list);
    return () => observer.disconnect();
  }, []);
  const resize = (handle: HTMLDivElement, width: number) => {
    const container = handle.parentElement;
    if (!container) return;
    const total = container.getBoundingClientRect().width;
    const next = Math.max(96, Math.min(width, 360, total / 2, total - 212));
    container.style.setProperty("--session-list-width", `${next}px`);
  };

  return <div ref={handleRef} role="separator" aria-label={t("Resize session list")} aria-orientation="vertical"
    aria-valuemin={0} aria-valuemax={50} aria-valuenow={40} tabIndex={0} className="session-list-divider"
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
