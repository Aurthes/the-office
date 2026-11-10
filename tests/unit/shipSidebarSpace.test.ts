import React, { useRef } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useShipSidebarSpace } from "@/features/ring-ship/useShipSidebarSpace";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture() {
  let card = { top: 800, bottom: 900 }, hud = { top: 600, bottom: 900 };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const box = this.className === "ship-summary" ? card : hud;
    return { ...box, height: box.bottom - box.top } as DOMRect;
  });
  let update = () => {};
  const observe = vi.fn(), disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { update = callback; } observe = observe; disconnect = disconnect; });
  function View() {
    const root = useRef<HTMLDivElement>(null), summary = useRef<HTMLDivElement>(null);
    useShipSidebarSpace(root, summary);
    return React.createElement("div", { ref: root, className: "ship-office" },
      React.createElement("div", { className: "ship-bottom-hud" }, React.createElement("div", { ref: summary, className: "ship-summary" }), React.createElement("div", { className: "ship-bottom-right" })));
  }
  const view = render(React.createElement(View)), root = view.container.firstElementChild as HTMLElement;
  return { view, root, observe, disconnect, update: () => update(), change: (a: typeof card, b = hud) => { card = a; hud = b; } };
}
it("reserves the left summary rather than the height of an unrelated right card", () => {
  const f = fixture();
  expect(f.root.style.getPropertyValue("--ship-summary-height")).toBe("100px");
  expect(f.observe).toHaveBeenCalledTimes(2);
  f.change({ top: 750, bottom: 900 }); f.update();
  expect(f.root.style.getPropertyValue("--ship-summary-height")).toBe("150px");
});
it("reserves only the part visible inside a clipped HUD and updates on scrolling", () => {
  const f = fixture(); f.change({ top: 580, bottom: 900 }, { top: 700, bottom: 900 }); f.update();
  expect(f.root.style.getPropertyValue("--ship-summary-height")).toBe("200px");
  f.change({ top: 550, bottom: 750 }, { top: 700, bottom: 900 });
  f.root.querySelector(".ship-bottom-hud")!.dispatchEvent(new Event("scroll"));
  expect(f.root.style.getPropertyValue("--ship-summary-height")).toBe("50px");
});
it("updates on viewport resize and removes observers, listeners and its local property on unmount", () => {
  const f = fixture(); f.change({ top: 820, bottom: 900 }); window.dispatchEvent(new Event("resize"));
  expect(f.root.style.getPropertyValue("--ship-summary-height")).toBe("80px");
  f.view.unmount(); expect(f.disconnect).toHaveBeenCalledOnce();
  expect(f.root.style.getPropertyValue("--ship-summary-height")).toBe("");
  window.dispatchEvent(new Event("resize")); expect(f.root.style.getPropertyValue("--ship-summary-height")).toBe("");
});
