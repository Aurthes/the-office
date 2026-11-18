import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionListDivider } from "@/features/office/components/SessionListDivider";
let total = 1000;
beforeEach(() => {
  total = 1000;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("PointerEvent", class extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId || 1; } });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const width = this.dataset.testid === "split" ? total : this.classList.contains("session-list-divider") ? 8 : parseFloat(this.parentElement?.style.getPropertyValue("--session-conversation-width") || "46") / 100 * total;
    return { width } as DOMRect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture() {
  render(React.createElement("div", { "data-testid": "split" }, React.createElement("textarea", { defaultValue: "Unsent draft" }), React.createElement(SessionListDivider, { pane: "workspace" }), React.createElement("aside", null, "Workspace")));
  const divider = screen.getByRole("separator", { name: "Resize chat and workspace" });
  divider.setPointerCapture = vi.fn();
  return { divider, row: screen.getByTestId("split"), draft: screen.getByRole("textbox") };
}
it("drags the shared divider, preserves the draft and stops after cancellation", () => {
  const { divider, row, draft } = fixture();
  fireEvent.pointerDown(divider, { pointerId: 7, button: 0, clientX: 460 });
  fireEvent.pointerMove(divider, { pointerId: 7, clientX: 660 });
  expect(row.style.getPropertyValue("--session-conversation-width")).toBe("66%");
  expect(divider.setPointerCapture).toHaveBeenCalledWith(7);
  fireEvent.pointerCancel(divider, { pointerId: 7 });
  fireEvent.pointerMove(divider, { pointerId: 7, clientX: 100 });
  expect(row.style.getPropertyValue("--session-conversation-width")).toBe("66%");
  expect(draft).toHaveValue("Unsent draft");
});
it("keeps both sides usable at drag limits and supports keyboard adjustment", () => {
  const { divider, row } = fixture();
  fireEvent.pointerDown(divider, { pointerId: 1, button: 0, clientX: 460 });
  fireEvent.pointerMove(divider, { pointerId: 1, clientX: 9000 });
  expect(parseFloat(row.style.getPropertyValue("--session-conversation-width"))).toBeCloseTo(79.2);
  fireEvent.pointerUp(divider, { pointerId: 1 });
  fireEvent.keyDown(divider, { key: "ArrowLeft" });
  expect(parseFloat(row.style.getPropertyValue("--session-conversation-width"))).toBeCloseTo(77.6);
  fireEvent.pointerDown(divider, { pointerId: 2, button: 0, clientX: 0 });
  fireEvent.pointerMove(divider, { pointerId: 2, clientX: -9000 });
  expect(row.style.getPropertyValue("--session-conversation-width")).toBe("20%");
});
it("balances a narrow frame and ignores non-primary or zero-width drags", () => {
  const { divider, row } = fixture(); total = 300;
  fireEvent.keyDown(divider, { key: "ArrowRight" });
  expect(parseFloat(row.style.getPropertyValue("--session-conversation-width"))).toBeCloseTo(146 / 300 * 100);
  total = 0; fireEvent.keyDown(divider, { key: "ArrowLeft" });
  const value = row.style.getPropertyValue("--session-conversation-width");
  fireEvent.pointerDown(divider, { button: 2, pointerId: 3, clientX: 0 }); fireEvent.pointerMove(divider, { pointerId: 3, clientX: 200 });
  expect(row.style.getPropertyValue("--session-conversation-width")).toBe(value);
});
