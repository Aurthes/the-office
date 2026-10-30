import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const asset = vi.hoisted(() => ({ fail: false }));
vi.mock("@react-three/drei", () => ({ Environment: () => {
  if (asset.fail) throw new Error("HDR download interrupted");
  return React.createElement("span", null, "environment ready");
} }));
import { OptionalEnvironment } from "../../src/features/retro-office/OptionalEnvironment";
afterEach(() => { cleanup(); vi.restoreAllMocks(); asset.fail = false; });
it("renders the light map when it loads", () => {
  render(React.createElement(OptionalEnvironment));
  expect(screen.getByText("environment ready")).toBeTruthy();
});
it("keeps the office mounted when the optional light map fails", () => {
  asset.fail = true; vi.spyOn(console, "error").mockImplementation(() => {});
  render(React.createElement(React.Fragment, null, React.createElement("span", null, "office floor"), React.createElement(OptionalEnvironment)));
  expect(screen.getByText("office floor")).toBeTruthy();
  expect(screen.queryByText("environment ready")).toBeNull();
});
