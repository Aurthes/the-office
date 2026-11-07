import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FillProbabilityDashboard } from "@/features/fill-probability/FillProbabilityDashboard";
import { MonitorDashboard } from "@/features/ring-ship/MonitorDashboard";
import { fillRow, fillSnapshot } from "../fixtures/fill-probability";

beforeEach(() => { localStorage.setItem("claw3d:ui-language", "en"); vi.spyOn(document, "hidden", "get").mockReturnValue(false); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("shows signed probability gaps, native C_A units, and honest missing stages", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fillSnapshot())));
  render(createElement(FillProbabilityDashboard));
  const table = await screen.findByRole("table", { name: "Fill probability stages" });
  const actual = within(table).getByRole("row", { name: /Actual EMA/ });
  expect(within(actual).getByText("0.0004")).toBeInTheDocument();
  expect(within(actual).getByText("-0.0006")).toBeInTheDocument();
  expect(within(actual).getByText("-60%")).toBeInTheDocument();
  expect(actual.querySelector(".fill-gap")).toHaveStyle({ color: "#a8b5bd" });
  const ca = within(table).getByRole("row", { name: /C_A · arrival-rate multiplier/ });
  expect(within(ca).getByText("0.8")).toBeInTheDocument();
  expect(within(ca).getByText("×")).toBeInTheDocument();
  expect(within(ca).getByText("—")).toBeInTheDocument();
  for (const stage of ["ca-probability", "before-normalize", "after-normalize", "before-guard", "guard", "final"]) {
    const element = table.querySelector(`[data-stage="${stage}"]`)!;
    expect(within(element as HTMLElement).getByText("N/A")).toBeInTheDocument();
    expect(element).toHaveAttribute("data-state", "unknown");
  }
  expect(screen.getByText(/EMA scope: symbol \+ side, shared across accounts/)).toBeInTheDocument();
  expect(screen.getByText("Not exported; unknown")).toBeInTheDocument();
  expect(screen.getByText("100 / 100 exposure seconds")).toBeInTheDocument();
});
it("filters account, symbol and side without inventing per-account EMA samples", async () => {
  const second = fillRow({ id: "second", account: "account-two", symbol: "venue.perp.b_usdt", side: "ask", schema: 9, clock: "trials" });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fillSnapshot([fillRow(), second]))));
  render(createElement(FillProbabilityDashboard));
  await screen.findByText(/venue.perp.a_usdt · Buy/);
  fireEvent.change(screen.getByRole("combobox", { name: "Account" }), { target: { value: "account-two" } });
  expect(screen.getByRole("heading", { name: "venue.perp.b_usdt · Sell / ask" })).toBeInTheDocument();
  expect(screen.getByText("100 / 100 trials")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Symbol" }), { target: { value: "missing" } });
  expect(screen.getByText("No matching probability records.")).toBeInTheDocument();
  expect(screen.queryByRole("table", { name: "Fill probability stages" })).toBeNull();
});
it("marks retained snapshots stale when refresh stalls and stops exposing current EMA numbers", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(fillSnapshot())).mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("fetch", fetcher);
  render(createElement(FillProbabilityDashboard)); await act(async () => {});
  expect(screen.getByText("0.0004")).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(30_001));
  expect(screen.queryByText("0.0004")).toBeNull();
  expect(screen.getByText("Snapshot expired or read failed")).toBeInTheDocument();
  expect(document.querySelector('[data-state="reference"]')).toBeNull();
});
it("pauses while hidden, resumes when visible, and aborts on unmount", async () => {
  vi.useFakeTimers(); let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const fetcher = vi.fn(async () => Response.json(fillSnapshot())); vi.stubGlobal("fetch", fetcher);
  const view = render(createElement(FillProbabilityDashboard)); await act(async () => {});
  expect(fetcher).toHaveBeenCalledTimes(1);
  hidden = true; fireEvent(document, new Event("visibilitychange"));
  await act(() => vi.advanceTimersByTimeAsync(20_000)); expect(fetcher).toHaveBeenCalledTimes(1);
  hidden = false; fireEvent(document, new Event("visibilitychange")); await act(async () => {});
  expect(fetcher).toHaveBeenCalledTimes(2);
  view.unmount(); await act(() => vi.advanceTimersByTimeAsync(20_000)); expect(fetcher).toHaveBeenCalledTimes(2);
  const signal = (fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].signal;
  expect(signal?.aborted).toBe(true);
});
it("opens the built-in probability view inside the control room on demand", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
  const fetcher = vi.fn(async (url: string) => Response.json(url.includes("/fill-probability") ? fillSnapshot() : { links: [] }));
  vi.stubGlobal("fetch", fetcher); const open = vi.spyOn(window, "open");
  render(createElement(MonitorDashboard, { open: true, onClose: vi.fn() }));
  expect(fetcher.mock.calls.some(([url]) => url.includes("/fill-probability"))).toBe(false);
  fireEvent.click(await screen.findByRole("button", { name: "Open monitor: Fill probability" }));
  await screen.findByRole("table", { name: "Fill probability stages" }); expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Back to monitors" }));
  expect(screen.queryByRole("region", { name: "Fill probability" })).toBeNull();
});
