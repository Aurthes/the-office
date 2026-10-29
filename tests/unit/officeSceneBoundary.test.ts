import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfficeSceneBoundary } from "@/features/office/components/OfficeSceneBoundary";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("office scene failure recovery", () => {
  it("keeps controls and an independent chat link usable after a rendering failure", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const UnavailableScene = () => { throw new Error("WebGL context unavailable"); };
    render(createElement("div", null,
      createElement("button", null, "Office controls"),
      createElement(OfficeSceneBoundary, null, createElement(UnavailableScene)),
    ));
    expect(screen.getByRole("button", { name: "Office controls" })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("continue in chat");
    expect(screen.getByRole("link", { name: "Open chat" })).toHaveAttribute("href", "/agents");
  });

  it("renders a working scene normally", () => {
    render(createElement(OfficeSceneBoundary, null,
      createElement("div", null, "Office loaded"),
    ));
    expect(screen.getByText("Office loaded")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
