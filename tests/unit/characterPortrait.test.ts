import { createElement } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CharacterPortrait } from "@/features/office/components/CharacterPortrait";
import { characterPortrait } from "@/features/ring-ship/characterPortrait";
import { createDefaultAgentAvatarProfile } from "@/lib/avatars/profile";
import { DEFAULT_DUCK_APPEARANCE } from "@/lib/avatars/duck";
vi.mock("@/features/ring-ship/characterPortrait", () => ({ characterPortrait: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("photographs the stored character appearance and ignores a stale photo after an outfit change", async () => {
  const first = { ...createDefaultAgentAvatarProfile("worker"), duck: { ...DEFAULT_DUCK_APPEARANCE, featherColor: "#aabbcc" } };
  let finishFirst: (src: string) => void = () => {};
  vi.mocked(characterPortrait).mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; })).mockResolvedValueOnce("data:image/png;base64,bmV3");
  const { rerender } = render(createElement(CharacterPortrait, { name: "Worker", profile: first }));
  await waitFor(() => expect(characterPortrait).toHaveBeenCalledWith(expect.objectContaining({ featherColor: "#aabbcc" })));
  rerender(createElement(CharacterPortrait, { name: "Worker", profile: { ...first, duck: { ...first.duck, headwear: "helmet" } } }));
  await waitFor(() => expect(screen.getByRole("img", { name: "Portrait of Worker" }).querySelector("img")?.src).toBe("data:image/png;base64,bmV3"));
  await act(async () => finishFirst("data:image/png;base64,b2xk"));
  expect(screen.getByRole("img", { name: "Portrait of Worker" }).querySelector("img")?.src).toBe("data:image/png;base64,bmV3");
});
it("keeps a simple initial if the device cannot render a portrait", async () => {
  vi.mocked(characterPortrait).mockRejectedValue(new Error("WebGL unavailable"));
  render(createElement(CharacterPortrait, { name: "Worker" }));
  await waitFor(() => expect(characterPortrait).toHaveBeenCalled());
  expect(screen.getByRole("img", { name: "Portrait of Worker" }).textContent).toBe("W");
  expect(document.querySelector("img")).toBeNull();
});
