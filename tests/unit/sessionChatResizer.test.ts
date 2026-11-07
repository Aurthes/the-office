import { createElement as h, useState, type CSSProperties } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionChatResizer } from "@/features/office/components/SessionChatResizer";
import { setUiLanguage } from "@/lib/i18n/ui-language";

let initial: DOMRect;
beforeEach(() => {
  setUiLanguage("en");
  vi.stubGlobal("innerWidth", 1200); vi.stubGlobal("innerHeight", 900); vi.stubGlobal("visualViewport", null);
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId || 1; }
  });
  initial = new DOMRect(300, 100, 600, 600);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture(expanded = false) {
  const start = vi.fn(); let renders = 0;
  function Frame() {
    renders++;
    const [full, setFull] = useState(expanded);
    return h("div", { "data-testid": "frame", "data-chat-expanded": String(full), style: { "--chat-gap": "12px" } as CSSProperties },
      h(SessionChatResizer, { onResizeStart: () => { start(); setFull(false); } }),
      h("textarea", { "aria-label": "Draft", defaultValue: "Unsent draft" }));
  }
  const view = render(h(Frame)), frame = screen.getByTestId("frame");
  const rect = () => {
    if (frame.dataset.chatExpanded === "true") return new DOMRect(12, 12, innerWidth - 24, innerHeight - 24);
    const width = parseFloat(frame.style.getPropertyValue("--chat-width")) || initial.width;
    const height = parseFloat(frame.style.getPropertyValue("--chat-height")) || initial.height;
    const right = frame.style.getPropertyValue("--chat-right");
    const top = frame.style.getPropertyValue("--chat-top");
    return new DOMRect(right ? innerWidth - parseFloat(right) - width : initial.left,
      top ? parseFloat(top) + (window.visualViewport?.offsetTop || 0) : initial.top, width, height);
  };
  vi.spyOn(frame, "getBoundingClientRect").mockImplementation(rect);
  const captures = new Map<HTMLElement, number>();
  for (const handle of frame.querySelectorAll("button")) {
    handle.setPointerCapture = vi.fn(id => { captures.set(handle, id); });
    handle.hasPointerCapture = vi.fn(id => captures.get(handle) === id);
    handle.releasePointerCapture = vi.fn(() => { captures.delete(handle); });
  }
  const handle = (edge: string) => frame.querySelector<HTMLButtonElement>(`.session-chat-resize-${edge}`)!;
  const down = (edge: string, id = 1, button = 0) => fireEvent.pointerDown(handle(edge), { button, pointerId: id, clientX: 500, clientY: 400 });
  const move = (edge: string, dx: number, dy: number, id = 1) => fireEvent.pointerMove(handle(edge), { pointerId: id, clientX: 500 + dx, clientY: 400 + dy });
  return { ...view, frame, rect, handle, down, move, start, renders: () => renders };
}

it.each([
  ["n", 300, 130, 600, 570], ["s", 300, 100, 600, 630],
  ["w", 340, 100, 560, 600], ["e", 300, 100, 640, 600],
  ["nw", 340, 130, 560, 570], ["ne", 300, 130, 640, 570],
  ["sw", 340, 100, 560, 630], ["se", 300, 100, 640, 630],
])("resizes %s while keeping the opposite edges fixed and retaining the draft DOM", (edge, x, y, width, height) => {
  const f = fixture(), input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Draft" });
  input.focus(); input.setSelectionRange(2, 5); const renders = f.renders();
  f.down(String(edge)); f.move(String(edge), 40, 30);
  expect(f.rect().toJSON()).toMatchObject({ x, y, width, height });
  expect(f.handle(String(edge)).setPointerCapture).toHaveBeenCalledWith(1);
  expect(f.renders()).toBe(renders);
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(input);
  expect(input).toHaveValue("Unsent draft"); expect(input).toHaveFocus(); expect(input.selectionStart).toBe(2);
  fireEvent.pointerUp(f.handle(String(edge)), { pointerId: 1 });
  expect(f.handle(String(edge)).releasePointerCapture).toHaveBeenCalledWith(1);
});

it("clamps minimum dimensions and viewport edges, including the visible mobile keyboard area", () => {
  const f = fixture(); f.down("nw"); f.move("nw", 10000, 10000);
  expect(f.rect().width).toBe(360); expect(f.rect().height).toBe(280);
  f.move("nw", -10000, -10000); expect(f.rect().left).toBe(12); expect(f.rect().top).toBe(12);
  fireEvent.pointerUp(f.handle("nw"), { pointerId: 1 });
  f.down("se"); f.move("se", 10000, 10000);
  expect(f.rect().right).toBe(1188); expect(f.rect().bottom).toBe(888);
  f.unmount();
  vi.stubGlobal("innerWidth", 390); vi.stubGlobal("innerHeight", 844);
  vi.stubGlobal("visualViewport", { height: 250, offsetTop: 100 });
  initial = new DOMRect(0, 100, 390, 250);
  const mobile = fixture(); mobile.frame.style.setProperty("--chat-gap", "0px");
  mobile.down("nw"); mobile.move("nw", 10000, 10000);
  expect(mobile.rect().width).toBe(360); expect(mobile.rect().height).toBe(250);
  expect(mobile.rect().top).toBe(100); expect(mobile.rect().bottom).toBe(350);
});

it("ignores secondary pointers/buttons, releases matching cancel/lost capture and cleans up on unmount", () => {
  const f = fixture(); f.down("e", 1, 2); expect(f.start).not.toHaveBeenCalled();
  f.down("e"); f.down("w", 2); expect(f.start).toHaveBeenCalledOnce();
  fireEvent.pointerUp(f.handle("e"), { pointerId: 2 });
  fireEvent.lostPointerCapture(f.handle("e"), { pointerId: 2 });
  f.move("e", 32, 0, 2); expect(f.rect().width).toBe(600);
  f.move("e", 48, 0); expect(f.rect().width).toBe(648);
  fireEvent.pointerCancel(f.handle("e"), { pointerId: 1 });
  f.move("e", 96, 0); expect(f.rect().width).toBe(648);
  expect(f.handle("e").releasePointerCapture).toHaveBeenCalledWith(1);
  f.down("e", 3); fireEvent.lostPointerCapture(f.handle("e"), { pointerId: 3 });
  f.move("e", 100, 0, 3); expect(f.rect().width).toBe(648);
  f.down("w", 4); const handle = f.handle("w"); f.unmount();
  expect(handle.releasePointerCapture).toHaveBeenCalledWith(4);
});

it("uses 16px keyboard steps on the relevant axes and begins an expanded resize at its displayed rectangle", () => {
  const f = fixture();
  fireEvent.keyDown(f.handle("e"), { key: "ArrowRight" }); expect(f.rect().width).toBe(616);
  fireEvent.keyDown(f.handle("n"), { key: "ArrowDown" }); expect(f.rect().top).toBe(116); expect(f.rect().bottom).toBe(700);
  fireEvent.keyDown(f.handle("w"), { key: "ArrowUp" }); expect(f.start).toHaveBeenCalledTimes(2);
  f.unmount(); const expanded = fixture(true); expanded.down("nw"); expanded.move("nw", 40, 30);
  expect(expanded.frame).toHaveAttribute("data-chat-expanded", "false");
  expect(expanded.rect().toJSON()).toMatchObject({ x: 52, y: 42, width: 1136, height: 846 });
});
