import React from "react";
import { Box3, Vector3 } from "three";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ShipObjectCard } from "@/features/ring-ship/ShipObjectInteraction";
import { setUiLanguage } from "@/lib/i18n/ui-language";
import type { ShipObject } from "@/features/ring-ship/shipObjects";
const object: ShipObject = { id: "plant-1", kind: "pottedPlant", deck: 1, cabinId: "cabin", cabinName: "Rainforest Habitat", bounds: new Box3(new Vector3(), new Vector3(1, 1, 1)), parts: [] };
afterEach(() => { cleanup(); setUiLanguage("en"); });
it("uses the shared card for space discoveries without assigning them to a deck", () => {
  render(React.createElement(ShipObjectCard, { object: { ...object, kind: "asteroid", space: { kind: "asteroid", index: 0, seed: 0, generation: 0 } }, customRoom: false, onClose: vi.fn() }));
  expect(screen.getByRole("heading", { name: "Drifting asteroid" })).toBeVisible();
  expect(screen.getByText("Nearby space")).toBeVisible();
  expect(screen.queryByText(/L2/)).toBeNull();
});
it("shows the selected prop and its location, keeps its note stable, and closes with Escape or the close button", () => {
  const onClose = vi.fn();
  const view = render(React.createElement(ShipObjectCard, { object, customRoom: false, onClose }));
  expect(screen.getByRole("heading", { name: "Potted plant" })).toBeVisible();
  expect(screen.getByText(/L2 · Rainforest Habitat/)).toBeVisible();
  const note = screen.getByText("Crew note").parentElement!.textContent;
  view.rerender(React.createElement(ShipObjectCard, { object: { ...object }, customRoom: false, onClose }));
  expect(screen.getByText("Crew note").parentElement!.textContent).toBe(note);
  fireEvent.keyDown(window, { key: "Escape" }); expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Close object information" })); expect(onClose).toHaveBeenCalledTimes(2);
});
it("switches language and preserves a project's own name", () => {
  render(React.createElement(ShipObjectCard, { object: { ...object, cabinName: "Garden" }, customRoom: true, onClose: vi.fn() }));
  act(() => setUiLanguage("zh-CN"));
  expect(screen.getByRole("heading", { name: "盆栽" })).toBeVisible();
  expect(screen.getByText("L2 · Garden")).toBeVisible();
  expect(screen.getByText("全船最安静的船员。")).toBeVisible();
});
