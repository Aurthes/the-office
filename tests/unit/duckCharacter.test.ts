import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_DUCK_APPEARANCE, normalizeDuckAppearance } from "@/lib/avatars/duck";
import { createDefaultAgentAvatarProfile, normalizeAgentAvatarProfile } from "@/lib/avatars/profile";
import { defaultStudioSettings, mergeStudioSettings, normalizeStudioSettings, resolveAgentAvatarProfile } from "@/lib/studio/settings";
import { createDuckCrewFigure } from "@/features/ring-ship/duckCrewFigure";
import { DuckCharacterPanel } from "@/features/ring-ship/DuckCharacterPanel";
import { ExistingSessionPanel } from "@/features/office/components/ExistingSessionPanel";
import * as THREE from "three";

vi.mock("@/features/ring-ship/DuckCharacterPreview", () => ({ DuckCharacterPreview: ({ appearance }: { appearance: unknown }) => React.createElement("div", { "data-testid": "character-preview", "data-appearance": JSON.stringify(appearance) }) }));
afterEach(() => { cleanup(); localStorage.clear(); });
const info = { id: "original", name: "Scout", project: "Ship", workspace: "/project", status: "idle" as const };
const preview = () => JSON.parse(screen.getByTestId("character-preview").getAttribute("data-appearance")!);

it("persists character appearance through the existing gateway-scoped Studio settings round trip", () => {
  const profile = { ...createDefaultAgentAvatarProfile(info.id), duck: { ...DEFAULT_DUCK_APPEARANCE, featherColor: "#ece9d8", headwear: "helmet" as const, billShape: "sculpted" as const, billScale: 1.3 } };
  const settings = mergeStudioSettings(defaultStudioSettings(), { avatars: { gateway: { original: profile } } });
  const reloaded = normalizeStudioSettings(JSON.parse(JSON.stringify(settings)));
  expect(reloaded.avatars.gateway.original.duck).toEqual(profile.duck);
  expect(reloaded.avatars.otherGateway).toBeUndefined();
  const loopback = mergeStudioSettings(defaultStudioSettings(), { avatars: { "ws://127.0.0.1:1234": { original: profile } } });
  expect(resolveAgentAvatarProfile(normalizeStudioSettings(loopback), "ws://localhost:1234", "original")?.duck).toEqual(profile.duck);
  expect(normalizeAgentAvatarProfile(createDefaultAgentAvatarProfile("older"), "older").duck).toBeUndefined();
});
it("bounds malformed saved appearances and keeps generated geometry finite and disposable", () => {
  const style = normalizeDuckAppearance({ billScale: 100, featherColor: "url(secret)", headwear: "script" });
  expect(style.billScale).toBe(1.4); expect(style.featherColor).toBe(DEFAULT_DUCK_APPEARANCE.featherColor); expect(style.headwear).toBe("none");
  expect(normalizeDuckAppearance({ billScale: NaN }).billScale).toBe(1);
  for (const billShape of ["classic", "sculpted"] as const) for (const headwear of ["none", "cap", "helmet"] as const) {
    const figure = createDuckCrewFigure({ ...style, billShape, headwear, outfit: "vest" });
    figure.root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const values = object.geometry.getAttribute("position").array;
      expect(Array.from(values).every(Number.isFinite)).toBe(true);
      expect(object.geometry.getAttribute("color").count).toBe(object.geometry.getAttribute("position").count);
    });
    figure.dispose();
  }
});
it("previews a draft immediately and cancels without saving", () => {
  const onSave = vi.fn();
  render(React.createElement(DuckCharacterPanel, { info, status: "idle", onSave }));
  fireEvent.click(screen.getByRole("button", { name: "Edit character" }));
  fireEvent.click(screen.getByRole("button", { name: "Helmet" }));
  fireEvent.change(screen.getByRole("slider", { name: "Bill size" }), { target: { value: "130" } });
  expect(preview()).toMatchObject({ headwear: "helmet", billScale: 1.3 }); expect(onSave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(preview()).toEqual(DEFAULT_DUCK_APPEARANCE); expect(onSave).not.toHaveBeenCalled();
});
it("retains a failed draft, retries once, and prevents duplicate saves", async () => {
  let resolve!: () => void;
  const onSave = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  render(React.createElement(DuckCharacterPanel, { info, status: "idle", onSave }));
  fireEvent.click(screen.getByRole("button", { name: "Edit character" }));
  fireEvent.click(screen.getByRole("button", { name: "Utility vest" }));
  fireEvent.click(screen.getByRole("button", { name: "Save character" }));
  await screen.findByRole("alert"); expect(preview().outfit).toBe("vest");
  fireEvent.click(screen.getByRole("button", { name: "Save character" }));
  fireEvent.click(screen.getByRole("button", { name: "Saving…" })); expect(onSave).toHaveBeenCalledTimes(2);
  expect(onSave.mock.calls[1][0]).toMatchObject({ seed: "original", duck: { outfit: "vest" } });
  await act(async () => resolve()); await screen.findByRole("button", { name: "Edit character" });
});
it("keeps the chat mounted and reuses its metadata when opening and leaving the character page", async () => {
  const call = vi.fn(async (method: string) => method === "session.inspect" ? info : { threadId: info.id, messages: [{ id: "message", role: "assistant", content: "History stays here" }], nextCursor: null });
  const view = render(React.createElement(ExistingSessionPanel, { client: { call }, threadId: info.id, onSaveCharacter: vi.fn() }));
  await screen.findByText("History stays here");
  const scroller = screen.getByLabelText("Session history");
  fireEvent.click(screen.getByRole("button", { name: "Character" }));
  await screen.findByRole("button", { name: "Edit character" });
  fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
  await waitFor(() => expect(screen.getByLabelText("Session history")).toBe(scroller));
  expect(view.container.querySelector('[data-character-mode]')).toBeNull();
  expect(call.mock.calls.filter(([method]) => method === "session.inspect")).toHaveLength(1);
  expect(call.mock.calls.filter(([method]) => method === "session.history")).toHaveLength(1);
});
