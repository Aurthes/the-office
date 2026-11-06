import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CapacityDashboard } from "@/features/rate-limit-capacity/CapacityDashboard";
import { MonitorDashboard } from "@/features/ring-ship/MonitorDashboard";
import { producer, snapshot } from "../fixtures/capacity";

beforeEach(()=> { vi.spyOn(document,"hidden","get").mockReturnValue(false); });
afterEach(()=> { cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers(); });

it("shows separate Spot/Perp state and update times for each account",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json(snapshot([producer(),producer("low","perp")]))));
  render(createElement(CapacityDashboard));
  const row=await screen.findByRole("row",{name:/account-one/});
  expect(within(row).getByText("Normal capacity")).toBeInTheDocument();
  expect(within(row).getByText("Low capacity")).toBeInTheDocument();
  expect(within(row).getAllByText(/Capacity evidence/)).toHaveLength(2);
  expect(row.querySelectorAll("time[datetime]")).toHaveLength(2);
  expect(screen.getByRole("columnheader",{name:"Spot"})).toBeInTheDocument();
  expect(screen.getByRole("columnheader",{name:"Perp"})).toBeInTheDocument();
});
it("does not freeze a green badge when subsequent fetches never finish",async()=>{
  vi.useFakeTimers();
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json(snapshot())).mockImplementation(()=>new Promise(()=>{}));
  vi.stubGlobal("fetch",fetcher);
  render(createElement(CapacityDashboard));await act(async()=>{});
  expect(screen.getByText("Normal capacity")).toBeInTheDocument();
  await act(()=>vi.advanceTimersByTimeAsync(30_001));
  expect(screen.queryByText("Normal capacity")).toBeNull();
  expect(screen.getByText("Capacity data expired")).toBeInTheDocument();
  expect(document.querySelector("[data-state=normal]")).toBeNull();
});
it("retains account context but removes green status after a read failure",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json(snapshot())).mockRejectedValueOnce(new Error("offline"));
  vi.stubGlobal("fetch",fetcher);render(createElement(CapacityDashboard));
  await screen.findByText("Normal capacity");fireEvent.click(screen.getByRole("button",{name:"Refresh capacity status"}));
  await screen.findByRole("alert");
  expect(screen.getByText("account-one")).toBeInTheDocument();
  expect(screen.queryByText("Normal capacity")).toBeNull();
  expect(screen.getByText("Capacity data expired")).toBeInTheDocument();
});
it("does not poll hidden panels, resumes on visibility, and aborts when removed",async()=>{
  vi.useFakeTimers();let hidden=false;
  vi.spyOn(document,"hidden","get").mockImplementation(()=>hidden);
  const fetcher=vi.fn(async()=>Response.json(snapshot()));vi.stubGlobal("fetch",fetcher);
  const view=render(createElement(CapacityDashboard));await act(async()=>{});
  expect(fetcher).toHaveBeenCalledTimes(1);
  hidden=true;fireEvent(document,new Event("visibilitychange"));
  await act(()=>vi.advanceTimersByTimeAsync(15_000));expect(fetcher).toHaveBeenCalledTimes(1);
  hidden=false;fireEvent(document,new Event("visibilitychange"));await act(async()=>{});
  expect(fetcher).toHaveBeenCalledTimes(2);
  view.unmount();await act(()=>vi.advanceTimersByTimeAsync(10_000));expect(fetcher).toHaveBeenCalledTimes(2);
});
it("opens the built-in capacity monitor inside the console only on demand",async()=>{
  Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value(){this.open=true;}});
  Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value(){this.open=false;}});
  const fetcher=vi.fn(async(url:string)=>Response.json(url.includes("/rate-limit-capacity")?snapshot():{links:[]}));
  vi.stubGlobal("fetch",fetcher);const open=vi.spyOn(window,"open");
  render(createElement(MonitorDashboard,{open:true,onClose:vi.fn()}));
  fireEvent.click(await screen.findByRole("button",{name:"Open monitor: Order capacity"}));
  await screen.findByText("Normal capacity");expect(open).not.toHaveBeenCalled();
  const call=fetcher.mock.calls.find(([url])=>String(url).includes("/rate-limit-capacity"));
  expect(call).toBeDefined();
  fireEvent.click(screen.getByRole("button",{name:"Back to monitors"}));
  expect(screen.queryByRole("region",{name:"Account order capacity"})).toBeNull();
});
it("shows old or absent producer schema as unknown, never normal",async()=>{
  const p=producer("unknown");
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json(snapshot([p]))));
  render(createElement(CapacityDashboard));await screen.findByText("Capacity unknown");
  expect(screen.queryByText("Normal capacity")).toBeNull();
});
