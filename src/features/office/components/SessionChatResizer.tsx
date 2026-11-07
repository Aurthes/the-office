"use client";

import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useUiText } from "@/lib/i18n/ui-language";

const edges = [
  ["n", "Resize chat from top edge"], ["s", "Resize chat from bottom edge"],
  ["w", "Resize chat from left edge"], ["e", "Resize chat from right edge"],
  ["nw", "Resize chat from top left corner"], ["ne", "Resize chat from top right corner"],
  ["sw", "Resize chat from bottom left corner"], ["se", "Resize chat from bottom right corner"],
] as const;
type Edge = typeof edges[number][0];
type Drag = { id: number; x: number; y: number; rect: DOMRect; edge: Edge; handle: HTMLButtonElement };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

// Keep pixel updates on the existing frame; dragging must not re-render the chat.
function resize(handle: HTMLButtonElement, rect: DOMRect, edge: Edge, dx: number, dy: number) {
  const frame = handle.parentElement;
  if (!frame) return;
  const viewport = window.innerWidth < 768 ? window.visualViewport : null;
  const offset = viewport?.offsetTop || 0, height = viewport?.height || window.innerHeight;
  const gap = parseFloat(getComputedStyle(frame).getPropertyValue("--chat-gap")) || 0;
  const minWidth = Math.min(360, window.innerWidth - gap * 2), minHeight = Math.min(280, height - gap * 2);
  let { left, right, top, bottom } = rect;
  if (edge.includes("w")) left = clamp(left + dx, gap, right - minWidth);
  if (edge.includes("e")) right = clamp(right + dx, left + minWidth, window.innerWidth - gap);
  if (edge.includes("n")) top = clamp(top + dy, offset + gap, bottom - minHeight);
  if (edge.includes("s")) bottom = clamp(bottom + dy, top + minHeight, offset + height - gap);
  frame.style.setProperty("--chat-width", `${right - left}px`);
  frame.style.setProperty("--chat-height", `${bottom - top}px`);
  frame.style.setProperty("--chat-top", `${top - offset}px`);
  frame.style.setProperty("--chat-right", `${window.innerWidth - right}px`);
}

export function SessionChatResizer({ onResizeStart }: { onResizeStart: () => void }) {
  const t = useUiText(), drag = useRef<Drag | null>(null);
  const finish = (id: number) => {
    const active = drag.current;
    if (active?.id !== id) return;
    drag.current = null;
    if (active.handle.hasPointerCapture(id)) active.handle.releasePointerCapture(id);
  };
  useEffect(() => () => {
    const active = drag.current;
    drag.current = null;
    if (active?.handle.hasPointerCapture(active.id)) active.handle.releasePointerCapture(active.id);
  }, []);
  const start = (event: PointerEvent<HTMLButtonElement>, edge: Edge) => {
    if (event.button !== 0 || drag.current || !event.currentTarget.parentElement) return;
    event.preventDefault();
    const rect = event.currentTarget.parentElement.getBoundingClientRect();
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, rect, edge, handle: event.currentTarget };
    resize(event.currentTarget, rect, edge, 0, 0);
    onResizeStart();
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const key = (event: KeyboardEvent<HTMLButtonElement>, edge: Edge) => {
    const horizontal = edge.includes("w") || edge.includes("e"), vertical = edge.includes("n") || edge.includes("s");
    const dx = horizontal ? event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0 : 0;
    const dy = vertical ? event.key === "ArrowUp" ? -16 : event.key === "ArrowDown" ? 16 : 0 : 0;
    const frame = event.currentTarget.parentElement;
    if ((!dx && !dy) || !frame) return;
    event.preventDefault();
    resize(event.currentTarget, frame.getBoundingClientRect(), edge, dx, dy);
    onResizeStart();
  };
  return edges.map(([edge, label]) => <button key={edge} type="button" className={`session-chat-resize session-chat-resize-${edge}`} aria-label={t(label)} title={t(label)}
    onPointerDown={event => start(event, edge)} onPointerMove={event => {
      const from = drag.current;
      if (from?.id === event.pointerId) resize(event.currentTarget, from.rect, from.edge, event.clientX - from.x, event.clientY - from.y);
    }} onPointerUp={event => finish(event.pointerId)} onPointerCancel={event => finish(event.pointerId)} onLostPointerCapture={event => finish(event.pointerId)}
    onKeyDown={event => key(event, edge)} />);
}
