import React, { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_DUCK_APPEARANCE, normalizeDuckAppearance, createDuckAppearanceFromSeed } from "@/lib/avatars/duck";
import { createDefaultAgentAvatarProfile, normalizeAgentAvatarProfile } from "@/lib/avatars/profile";
import { defaultStudioSettings, mergeStudioSettings, normalizeStudioSettings, resolveAgentAvatarProfile } from "@/lib/studio/settings";
import { createDuckCrewFigure } from "@/features/ring-ship/duckCrewFigure";
import { DuckCharacterPanel, type CharacterMode } from "@/features/ring-ship/DuckCharacterPanel";
import { ExistingSessionPanel } from "@/features/office/components/ExistingSessionPanel";
import * as THREE from "three";

vi.mock("@/features/ring-ship/DuckCharacterPreview", () => ({ DuckCharacterPreview: ({ appearance }: { appearance: unknown }) => React.createElement("div", { "data-testid": "character-preview", "data-appearance": JSON.stringify(appearance) }) }));
afterEach(() => { cleanup(); localStorage.clear(); });
const info = { id: "original", name: "Scout", project: "Ship", workspace: "/project", status: "idle" as const };
const preview = () => JSON.parse(screen.getByTestId("character-preview").getAttribute("data-appearance")!);

function Editor({ onSave }: { onSave: (profile: ReturnType<typeof createDefaultAgentAvatarProfile>) => Promise<void> }) {
  const [mode, setMode] = useState<CharacterMode>("edit");
  return React.createElement(DuckCharacterPanel, { key: mode, info, status: "idle", onSave, mode, onModeChange: setMode });
}

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
  render(React.createElement(Editor, { onSave }));
  fireEvent.click(screen.getByRole("button", { name: "Helmet" }));
  fireEvent.click(screen.getByRole("tab", { name: "Face" }));
  fireEvent.change(screen.getByRole("slider", { name: "Bill size" }), { target: { value: "130" } });
  fireEvent.change(screen.getByRole("slider", { name: "Eye spacing" }), { target: { value: "120" } });
  fireEvent.click(screen.getByRole("tab", { name: "Body" }));
  fireEvent.change(screen.getByRole("slider", { name: "Body height" }), { target: { value: "125" } });
  expect(preview()).toMatchObject({ bodyHeight: 1.25, eyeSpacing: 1.2, headwear: "helmet", billScale: 1.3 }); expect(onSave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(preview()).toEqual(DEFAULT_DUCK_APPEARANCE); expect(onSave).not.toHaveBeenCalled();
});
it("retains a failed draft, retries once, and prevents duplicate saves", async () => {
  let resolve!: () => void;
  const onSave = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  render(React.createElement(Editor, { onSave }));
  fireEvent.click(screen.getByRole("tab", { name: "Gear" }));
  fireEvent.click(screen.getByRole("button", { name: "Utility vest" }));
  fireEvent.click(screen.getByRole("button", { name: "Save character" }));
  await screen.findByRole("alert"); expect(preview().outfit).toBe("vest");
  fireEvent.click(screen.getByRole("button", { name: "Save character" }));
  fireEvent.click(screen.getByRole("button", { name: "Saving…" })); expect(onSave).toHaveBeenCalledTimes(2);
  expect(onSave.mock.calls[1][0]).toMatchObject({ seed: "original", duck: { outfit: "vest" } });
  await act(async () => resolve()); await screen.findByText("CREW MEMBER");
});
it("keeps the chat mounted and reuses its metadata when opening and leaving the character page", async () => {
  const call = vi.fn(async (method: string) => method === "session.inspect" ? info : { threadId: info.id, messages: [{ id: "message", role: "assistant", content: "History stays here" }], nextCursor: null });
  const view = render(React.createElement(ExistingSessionPanel, { client: { call }, threadId: info.id, onSaveCharacter: vi.fn() }));
  await screen.findByText("History stays here");
  const scroller = screen.getByLabelText("Session history");
  fireEvent.click(view.container.querySelector("summary")!);
  fireEvent.click(screen.getByRole("button", { name: "Character" }));
  await screen.findByText("CREW MEMBER");
  fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
  await waitFor(() => expect(screen.getByLabelText("Session history")).toBe(scroller));
  expect(view.container.querySelector('[data-character-mode]')).toBeNull();
  expect(call.mock.calls.filter(([method]) => method === "session.inspect")).toHaveLength(1);
  expect(call.mock.calls.filter(([method]) => method === "session.history")).toHaveLength(1);
});

it("keeps character and archive actions inside one menu and renames the original session without saving cosmetics", async () => {
  let attempt = 0;
  const call = vi.fn(async (method: string, params: unknown) => {
    if (method === "session.inspect") return { ...info, controlsAvailable: true };
    if (method === "session.history") return { threadId: info.id, messages: [], nextCursor: null };
    if (method === "session.rename") { if (++attempt === 1) throw new Error("offline"); return { threadId: info.id, name: (params as { name: string }).name }; }
    return { connected: true, version: 1, activeTurnId: null, items: [], approvals: [] };
  });
  const onSaveCharacter = vi.fn(), onSessionRenamed = vi.fn();
  const view = render(React.createElement(ExistingSessionPanel, { client: { call }, threadId: info.id, onSaveCharacter, onSessionRenamed, onReturnToEarth: vi.fn() }));
  await screen.findByRole("heading", { name: "Scout" });
  const details = view.container.querySelector("details")!;
  expect(details.hasAttribute("open")).toBe(false);
  fireEvent.click(details.querySelector("summary")!);
  for (const label of ["Character", "Edit character", "Rename session"]) {
    expect(screen.getByRole("button", { name: label }).closest("details")).toBe(details);
  }
  expect(screen.getByRole("button", { name: /Return to Earth/ }).closest("details")).toBe(details);
  fireEvent.click(screen.getByRole("button", { name: "Rename session" }));
  expect(details.hasAttribute("open")).toBe(false);
  fireEvent.change(await screen.findByRole("textbox", { name: "Session name" }), { target: { value: " Captain " } });
  fireEvent.click(screen.getByRole("button", { name: "Save name" }));
  await screen.findByText("offline"); expect(screen.getByRole("textbox", { name: "Session name" })).toHaveValue(" Captain ");
  fireEvent.click(screen.getByRole("button", { name: "Save name" }));
  await waitFor(() => expect(onSessionRenamed).toHaveBeenCalledExactlyOnceWith("Captain"));
  expect(call).toHaveBeenCalledWith("session.rename", expect.objectContaining({ threadId: "original", name: "Captain", requestId: expect.any(String) }));
  expect(onSaveCharacter).not.toHaveBeenCalled();
});

it("reassigns from the character page, keeps a failed selection and preserves the chat and draft", async () => {
  let attempt = 0;
  const onSaveCharacter = vi.fn();
  const call = vi.fn(async (method: string, params: unknown) => {
    if (method === "session.inspect") return { ...info, projectId: "ship", controlsAvailable: true };
    if (method === "session.history") return { threadId: info.id, messages: [{ id: "message", role: "assistant", content: "Keep this history" }], nextCursor: null };
    if (method === "session.reassign") {
      if (!attempt++) throw new Error("offline");
      return { threadId: info.id, projectId: (params as { projectId: string }).projectId, project: "Research" };
    }
    return { connected: true, activeTurnId: null, approvals: [], items: [] };
  });
  const view = render(React.createElement(ExistingSessionPanel, { client: { call }, threadId: info.id, onSaveCharacter,
    projects: [{ id: "ship", name: "Ship" }, { id: "research", name: "Research" }] }));
  await screen.findByText("Keep this history");
  const scroller = screen.getByLabelText("Session history"), input = screen.getByLabelText("Send to session");
  fireEvent.change(input, { target: { value: "Keep this draft" } });
  fireEvent.click(view.container.querySelector("summary")!);
  fireEvent.click(screen.getByRole("button", { name: "Character" }));
  await screen.findByText("CREW MEMBER");
  fireEvent.click(within(view.container.querySelector('[data-character-mode="view"]') as HTMLElement).getByRole("button", { name: "Reassign" }));
  const select = screen.getByLabelText("Reassign to project");
  expect(screen.getByRole("button", { name: "Confirm reassignment" })).toBeDisabled();
  fireEvent.change(select, { target: { value: "research" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm reassignment" }));
  await screen.findByText("offline");
  expect(select).toHaveValue("research");
  fireEvent.click(screen.getByRole("button", { name: "Confirm reassignment" }));
  await waitFor(() => expect(view.container.querySelector('[data-character-mode="view"]')).not.toBeNull());
  expect(call).toHaveBeenCalledWith("session.reassign", expect.objectContaining({ threadId: info.id, projectId: "research", requestId: expect.any(String) }));
  fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
  expect(screen.getByLabelText("Session history")).toBe(scroller);
  expect(screen.getByLabelText("Send to session")).toBe(input);
  expect(input).toHaveValue("Keep this draft");
  expect(call.mock.calls.filter(([method]) => method === "session.history")).toHaveLength(1);
  expect(onSaveCharacter).not.toHaveBeenCalled();
});

it("uses a circular default torso section and independent width/depth/height scales", () => {
  for (const ratios of [{ bodyWidth: 1, bodyDepth: 1, bodyHeight: 1 }, { bodyWidth: 1.25, bodyDepth: .8, bodyHeight: 1.3 }]) {
    const figure = createDuckCrewFigure({ ...DEFAULT_DUCK_APPEARANCE, ...ratios });
    figure.root.updateMatrixWorld(true);
    const torso = figure.body.children.find(child => child instanceof THREE.Mesh)!;
    const y = .345 * ratios.bodyHeight;
    const x = new THREE.Raycaster(new THREE.Vector3(1, y, 0), new THREE.Vector3(-1, 0, 0)).intersectObject(torso)[0].point.x;
    const z = new THREE.Raycaster(new THREE.Vector3(0, y, 1), new THREE.Vector3(0, 0, -1)).intersectObject(torso)[0].point.z;
    expect(x / z).toBeCloseTo(ratios.bodyWidth / ratios.bodyDepth, 4);
    figure.dispose();
  }
  expect(normalizeDuckAppearance({ bodyWidth: 99, bodyHeight: NaN, eyeSpacing: -99, eyeHeight: Infinity })).toMatchObject({ bodyWidth: 1.3, bodyHeight: 1, eyeSpacing: .7, eyeHeight: 1 });
});

it("keeps repositioned eyes on the capsule surface at the slider extremes", () => {
  for (const eyeSpacing of [.7, 1.3]) for (const eyeHeight of [.9, 1.1]) {
    const figure = createDuckCrewFigure({ ...DEFAULT_DUCK_APPEARANCE, eyeSpacing, eyeHeight });
    figure.root.updateMatrixWorld(true);
    const torso = figure.body.children.find(child => child instanceof THREE.Mesh)!;
    const face = figure.root.getObjectByName("face")!;
    const eyes = face.children.find(child => child instanceof THREE.Mesh && (child.material as THREE.MeshStandardMaterial).roughness === .7) as THREE.Mesh;
    const positions = eyes.geometry.getAttribute("position"), center = new THREE.Vector3(); let count = 0;
    for (let i = 0; i < positions.count; i++) if (positions.getX(i) > 0) { center.add(new THREE.Vector3().fromBufferAttribute(positions, i)); count++; }
    center.divideScalar(count); eyes.localToWorld(center);
    const surface = new THREE.Raycaster(new THREE.Vector3(center.x, center.y, 1), new THREE.Vector3(0, 0, -1)).intersectObject(torso)[0];
    expect(surface).toBeDefined(); expect(center.z).toBeGreaterThan(surface.point.z);
    figure.dispose();
  }
});

it("keeps part edits while navigating tabs and resets only the selected part", async () => {
  const onSave = vi.fn<(profile: ReturnType<typeof createDefaultAgentAvatarProfile>) => Promise<void>>(async () => {});
  render(React.createElement(Editor, { onSave }));
  expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Head", "Face", "Body", "Wings", "Feet", "Tail", "Gear"]);
  fireEvent.click(screen.getByRole("button", { name: "Crown" }));
  fireEvent.click(screen.getByRole("tab", { name: "Wings" }));
  fireEvent.change(screen.getByRole("slider", { name: "Wing length" }), { target: { value: "140" } });
  fireEvent.click(screen.getByRole("button", { name: "Layered feathers" }));
  fireEvent.click(screen.getByRole("tab", { name: "Feet" }));
  fireEvent.click(screen.getByRole("button", { name: "Boots" }));
  fireEvent.click(screen.getByRole("tab", { name: "Wings" }));
  expect(preview()).toMatchObject({ headwear: "crown", wingLength: 1.4, wingStyle: "layered", footStyle: "boots" });
  fireEvent.click(screen.getByRole("button", { name: "Reset part" }));
  expect(preview()).toMatchObject({ headwear: "crown", wingLength: 1, wingStyle: "smooth", footStyle: "boots" });
  fireEvent.click(screen.getByRole("button", { name: "Save character" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0][0]).toMatchObject({ duck: { headwear: "crown", footStyle: "boots", wingLength: 1 } });
});

it("supports keyboard tab navigation and randomizes a part without replacing other edits", () => {
  render(React.createElement(Editor, { onSave: vi.fn() }));
  fireEvent.click(screen.getByRole("button", { name: "Helmet" }));
  const head = screen.getByRole("tab", { name: "Head" }); head.focus();
  fireEvent.keyDown(head, { key: "ArrowRight" });
  expect(screen.getByRole("tab", { name: "Face" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "Face" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Randomize part" }));
  expect(preview().headwear).toBe("helmet");
  const face = preview();
  fireEvent.click(screen.getByRole("tab", { name: "Head" }));
  expect(preview()).toEqual(face);
  fireEvent.click(screen.getByRole("button", { name: "Randomize character" }));
  expect(preview()).not.toEqual(face);
});

it("generates varied but repeatable, bounded recruit styles", () => {
  const styles = Array.from({ length: 30 }, (_, i) => createDuckAppearanceFromSeed(`recruit-${i}`));
  expect(new Set(styles.map(style => JSON.stringify(style))).size).toBe(30);
  expect(createDuckAppearanceFromSeed("recruit-4")).toEqual(styles[4]);
  for (const style of styles) expect(normalizeDuckAppearance(JSON.parse(JSON.stringify(style)))).toEqual(style);
});

it("renders independent wing, foot, head and tail choices without changing animation pivots", () => {
  const base = createDuckCrewFigure();
  const custom = createDuckCrewFigure({ ...DEFAULT_DUCK_APPEARANCE, headColor: "#aab8d4", headScale: 1.15, wingLength: 1.45, wingWidth: 1.4, wingSpread: 40, wingStyle: "layered", footStyle: "boots", footScale: 1.4, footSpacing: 1.35, tailStyle: "fan", tailScale: 1.5, headwear: "crown", eyewear: "round", backpack: true, bellyPatch: true, outfit: "scarf" });
  base.root.updateMatrixWorld(true); custom.root.updateMatrixWorld(true);
  expect(custom.wings.map(wing => wing.name)).toEqual(["left-wing", "right-wing"]);
  expect(custom.feet.map(foot => foot.name)).toEqual(["left-foot", "right-foot"]);
  expect(custom.feet[1].position.x).toBeGreaterThan(base.feet[1].position.x);
  expect(new THREE.Box3().setFromObject(custom.feet[0]).getSize(new THREE.Vector3()).x).toBeGreaterThan(new THREE.Box3().setFromObject(base.feet[0]).getSize(new THREE.Vector3()).x);
  expect(new THREE.Box3().setFromObject(custom.root).min.y).toBeGreaterThanOrEqual(0);
  for (const wing of custom.wings) expect(wing.getObjectByName("wing-shape")?.scale.y).toBe(1.45);
  for (const figure of [base, custom]) {
    const dispose = vi.fn(); const geometries: THREE.BufferGeometry[] = [];
    figure.root.traverse(object => { if (object instanceof THREE.Mesh) { expect(Array.from(object.geometry.getAttribute("position").array).every(Number.isFinite)).toBe(true); geometries.push(object.geometry); object.geometry.addEventListener("dispose", dispose); } });
    figure.dispose(); expect(dispose).toHaveBeenCalledTimes(geometries.length);
  }
});
