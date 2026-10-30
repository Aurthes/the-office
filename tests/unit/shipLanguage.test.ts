import { afterEach, expect, it, vi } from "vitest";
import { buildShipGeometry, disposeShipGeometry } from "@/features/ring-ship/geometry";
import { buildShipLayout, shipDeck } from "@/features/ring-ship/layout";
import { paintCrewNameplate } from "@/features/ring-ship/crewNameplate";
import { translateUi } from "@/lib/i18n/messages";

afterEach(() => vi.restoreAllMocks());

it("translates cabin signage and activity labels while preserving project and crew names", () => {
  const fillText = vi.fn();
  const context = { fillText, fillRect: vi.fn(), clearRect: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as ReturnType<HTMLCanvasElement["getContext"]>);
  const layout = shipDeck(buildShipLayout({ projects: [{ id: "p", name: "Garden" }], members: [{ id: "a", projectId: "p" }] }), 0);
  const allocation = JSON.stringify(layout.allocation);
  const chinese = (text: string, values?: Record<string, string | number>) => translateUi(text, "zh-CN", values);
  const english = buildShipGeometry(layout);
  expect(fillText.mock.calls.map(([text]) => text)).toContain("Central lift");
  expect(fillText.mock.calls.map(([text]) => text)).toContain("Reserve cabin");
  disposeShipGeometry(english);
  fillText.mockClear();
  const translated = buildShipGeometry(layout, {}, chinese);
  const labels = fillText.mock.calls.map(([text]) => text);
  expect(labels).toContain("中央升降梯");
  expect(labels).toContain("预留舱");
  expect(labels).toContain("雨林生态舱");
  expect(labels).toContain("Garden");
  expect(labels).not.toContain("CENTRAL SHUTTLE");
  expect(JSON.stringify(layout.allocation)).toBe(allocation);
  disposeShipGeometry(translated);
  fillText.mockClear();
  paintCrewNameplate(document.createElement("canvas"), { name: "Working", color: "#123456", status: "idle" }, true, "", 0, chinese);
  expect(fillText.mock.calls.map(([text]) => text)).toEqual(["Working", "空闲"]);
});
