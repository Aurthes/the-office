import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SpaceTrafficNotice } from "@/features/ring-ship/SpaceTrafficNotice";
import { emptySpaceEncounter, emptySpaceMotion, sampleSpaceEncounter } from "@/features/ring-ship/space-activity";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("appears only during an encounter, counts down on the scene clock, and respects dismiss for that encounter", () => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const motion = { current: emptySpaceMotion() }, seed = 2;
  const start = sampleSpaceEncounter(0, seed, emptySpaceEncounter()).trafficStartsIn;
  const view = render(React.createElement(SpaceTrafficNotice, { motion, seed, paused: false }));
  expect(screen.queryByLabelText("Space traffic alert")).toBeNull();
  const advance = (time: number) => act(() => { motion.current.elapsed = time; vi.advanceTimersByTime(250); });
  advance(start - 4);
  expect(screen.getByRole("status").textContent).toBe("Incoming space traffic");
  expect(screen.getByText("00:04")).toBeTruthy();
  advance(start - 3); expect(screen.getByText("00:03")).toBeTruthy();
  advance(start + 1); expect(screen.getByRole("status").textContent).toBe("Fleet passing by");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss traffic alert" }));
  advance(start + 2); expect(screen.queryByLabelText("Space traffic alert")).toBeNull();
  const nextStart = 80 + sampleSpaceEncounter(80, seed, emptySpaceEncounter()).trafficStartsIn;
  advance(nextStart - 2); expect(screen.getByLabelText("Space traffic alert")).toBeTruthy();
  view.rerender(React.createElement(SpaceTrafficNotice, { motion, seed, paused: true }));
  expect(screen.queryByLabelText("Space traffic alert")).toBeNull();
  view.rerender(React.createElement(SpaceTrafficNotice, { motion, seed, paused: false }));
  advance(nextStart + 40); expect(screen.queryByLabelText("Space traffic alert")).toBeNull();
  view.unmount(); expect(vi.getTimerCount()).toBe(0);
});
