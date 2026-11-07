import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sessionListNeedsOverlay, sessionListWidth } from "@/features/office/operations/sessionListLayout";
import { useSessionListLayout } from "@/features/office/hooks/useSessionListLayout";
import { SessionListDivider } from "@/features/office/components/SessionListDivider";

let total = 960;
let listWidth = 240;
let coarse = false;
const observers = new Set<() => void>();
const pointerChanges = new Set<() => void>();
let disconnected = 0;
beforeEach(() => {
  total = 960; listWidth = 240; coarse = false; disconnected = 0;
  observers.clear(); pointerChanges.clear();
  vi.stubGlobal("ResizeObserver", class {
    constructor(readonly update: () => void) { observers.add(update); }
    observe() { this.update(); }
    disconnect() { observers.delete(this.update); disconnected++; }
  });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ get matches() { return coarse; }, addEventListener: (_: string, cb: () => void) => pointerChanges.add(cb), removeEventListener: (_: string, cb: () => void) => pointerChanges.delete(cb) })));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { width: this.dataset.layout === "container" ? total : this.dataset.layout === "list" ? listWidth : 0 } as DOMRect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Fixture({ enabled = true, divider = 8 }: { enabled?: boolean; divider?: number }) {
  const { container, ...layout } = useSessionListLayout(enabled);
  return React.createElement("div", { ref: container, "data-testid": "layout", "data-layout": "container", "data-mode": layout.overlay ? "overlay" : "split", style: { "--session-list-divider-width": `${divider}px` } as React.CSSProperties },
    React.createElement("aside", { "data-layout": "list" }, "Sessions"),
    React.createElement(SessionListDivider, { onResize: layout.update }),
    React.createElement("textarea", { "aria-label": "Draft", defaultValue: "Unsent draft" }));
}
const resize = () => act(() => { [...observers].forEach(update => update()); });

it.each([[688, undefined, 8, false], [687.5, undefined, 8, true], [692, undefined, 12, false], [691.5, undefined, 12, true], [600, 96, 8, false], [600, 200, 8, true], [760, 300, 12, false], [760, 320, 12, true]] as const)("reserves 440px of hypothetical chat at total=%s list=%s divider=%s", (width, preferred, divider, overlay) => {
  expect(sessionListNeedsOverlay(width, preferred, divider)).toBe(overlay);
});

it("keeps the existing clamp and default width rather than inventing another width preference", () => {
  expect(sessionListWidth(1000)).toBe(240);
  expect(sessionListWidth(500)).toBe(200);
  expect(sessionListWidth(1000, 900)).toBe(360);
  expect(sessionListWidth(500, 350)).toBe(250);
  expect(sessionListWidth(300, 350)).toBe(96);
  expect(sessionListWidth(960, 32)).toBe(96);
});

it("tracks real container width at the same viewport, preserves preferred width and ignores the overlay's actual list size", () => {
  const view = render(React.createElement(Fixture));
  const row = screen.getByTestId("layout"), input = screen.getByRole("textbox", { name: "Draft" });
  input.focus(); (input as HTMLTextAreaElement).setSelectionRange(2, 5);
  expect(row.dataset.mode).toBe("split");
  row.style.setProperty("--session-list-width", "300px");
  total = 740; resize(); expect(row.dataset.mode).toBe("overlay");
  listWidth = 360; resize(); resize(); expect(row.dataset.mode).toBe("overlay");
  total = 960; resize(); expect(row.dataset.mode).toBe("split");
  total = 740; resize(); expect(row.dataset.mode).toBe("overlay");
  total = 0; resize(); expect(row.dataset.mode).toBe("overlay"); // Hidden chat.
  total = 960; resize(); expect(row.dataset.mode).toBe("split");
  expect(row.style.getPropertyValue("--session-list-width")).toBe("300px");
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(input);
  expect(input).toHaveValue("Unsent draft"); expect(input).toHaveFocus();
  expect((input as HTMLTextAreaElement).selectionStart).toBe(2);
  view.unmount(); expect(pointerChanges.size).toBe(0); expect(observers.size).toBe(0); expect(disconnected).toBe(2);
});

it("updates immediately when the real divider changes the preference without a container resize", () => {
  total = 600; listWidth = 140;
  render(React.createElement(Fixture));
  const row = screen.getByTestId("layout"), divider = screen.getByRole("separator");
  row.style.setProperty("--session-list-width", "140px"); resize(); expect(row.dataset.mode).toBe("split");
  fireEvent.keyDown(divider, { key: "ArrowRight" });
  expect(row.style.getPropertyValue("--session-list-width")).toBe("156px");
  expect(row.dataset.mode).toBe("overlay");
  listWidth = 156; fireEvent.keyDown(divider, { key: "ArrowLeft" });
  expect(row.style.getPropertyValue("--session-list-width")).toBe("140px");
  expect(row.dataset.mode).toBe("split");
});

it("uses the measured 8/12px CSS divider even when only pointer mode changes", () => {
  total = 690;
  render(React.createElement(Fixture)); const row = screen.getByTestId("layout");
  expect(row.dataset.mode).toBe("split");
  act(() => { coarse = true; row.style.setProperty("--session-list-divider-width", "12px"); pointerChanges.forEach(update => update()); });
  expect(row.dataset.mode).toBe("overlay");
  act(() => { coarse = false; row.style.setProperty("--session-list-divider-width", "8px"); pointerChanges.forEach(update => update()); });
  expect(row.dataset.mode).toBe("split");
});
