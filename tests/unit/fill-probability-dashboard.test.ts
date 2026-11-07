import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FillProbabilityDashboard } from "@/features/fill-probability/FillProbabilityDashboard";
import { MonitorDashboard } from "@/features/ring-ship/MonitorDashboard";
import { FILL_NOW, fillQuote, fillRow, fillSnapshot } from "../fixtures/fill-probability";
import type { FillRow, FillRecordSnapshot } from "@/lib/fill-probability/model";

function recordSnapshot(rows: FillRow[], row: FillRow | null = rows[0] || null): FillRecordSnapshot {
  const s=fillSnapshot(rows);
  return { configured:s.configured,serverTime:s.serverTime,sampledAt:s.sampledAt,sourceErrors:s.sourceErrors,view:"record",
    records:rows.map(({id,strategy,exchange,account,symbol,side})=>({id,strategy,exchange,account,symbol,side})),row };
}
function deferredResponse() {
  let resolve!: (value: Response) => void, reject!: (reason: Error) => void;
  const promise=new Promise<Response>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

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
  expect(await screen.findByRole("heading", { name: "venue.perp.b_usdt · Sell / ask" })).toBeInTheDocument();
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
  expect(screen.getByText("Snapshot expired or freshness unverified")).toBeInTheDocument();
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

it("shows offline candidate observation fields and colors original-ready EMA and current quote distances", async () => {
  const row = fillRow({ ready: true, observedAt: FILL_NOW, quote: fillQuote() });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fillSnapshot([row]))));
  render(createElement(FillProbabilityDashboard));
  const table = await screen.findByRole("table", { name: "Fill probability stages" });
  const stage = (key: string) => table.querySelector(`[data-stage="${key}"]`)! as HTMLElement;
  for (const key of ["base", "model", "actual", "ca-probability", "before-normalize", "after-normalize", "p1", "post-only", "p2", "final"]) {
    expect(stage(key)).toHaveAttribute("data-state", "current");
    expect(stage(key).querySelector(".fill-gap")).not.toHaveStyle({ color: "#a8b5bd" });
  }
  expect(within(stage("before-normalize")).getByText("0.0015")).toBeInTheDocument();
  expect(within(stage("after-normalize")).getByText("0.0012")).toBeInTheDocument();
  expect(within(stage("after-normalize")).getByText("Normalization: Enabled · scale 0.8")).toBeInTheDocument();
  expect(within(stage("ca-probability")).getByText("Reference price: 99.8")).toBeInTheDocument();
  expect(within(stage("p1")).getByText("Changed price")).toBeInTheDocument();
  expect(within(stage("final")).getByText("0.0009")).toBeInTheDocument();
  expect(screen.queryByText(/Quote observation has not been exported/)).toBeNull();
  expect(screen.getByText(/Quote and EMA clocks are separate/)).toBeInTheDocument();
});

it("distinguishes unchanged and not-run guards, disabled normalization and absent Pmax", async () => {
  const quote = fillQuote({ normalizationEnabled: false, normalizationScale: 1, pmax: null, beforeNormalize: .0015, afterNormalize: .0015, p1State: "unchanged", postOnlyState: "unchanged", p2State: "not-run", p2AfterProbability: null });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fillSnapshot([fillRow({ quote })]))));
  render(createElement(FillProbabilityDashboard));
  const table = await screen.findByRole("table", { name: "Fill probability stages" });
  expect(table.querySelector('[data-stage="pmax"] .fill-value')).toHaveTextContent("N/A");
  expect(table.querySelector('[data-stage="after-normalize"]')).toHaveTextContent("Normalization: Disabled · scale 1");
  expect(table.querySelector('[data-stage="post-only"]')).toHaveTextContent("Passed without price change");
  expect(table.querySelector('[data-stage="p2"]')).toHaveTextContent("Not run");
});

it("shows a rejected or disabled side as no quote, never zero final probability", async () => {
  const quote = fillQuote({ quoted: false, finalProbability: .0009, finalPrice: 99.5, p2State: "rejected", guardReason: "p2_ratio_unreachable", disabledMask: 4 });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fillSnapshot([fillRow({ quote })]))));
  render(createElement(FillProbabilityDashboard));
  const table = await screen.findByRole("table", { name: "Fill probability stages" });
  const final = table.querySelector('[data-stage="final"]')! as HTMLElement;
  expect(final.querySelector(".fill-value")).toHaveTextContent("N/A");
  expect(final).toHaveTextContent("No near quote");
  expect(final).toHaveTextContent("p2_ratio_unreachable · Risk blocked · Disable mask: 4");
  expect(table.querySelector('[data-stage="p2"]')).toHaveTextContent("Rejected");
});

it("keeps underflow targets distinct from an explicit disabled side", async () => {
  const quote = fillQuote({ underflow: true, afterNormalize: 0, logAfterNormalize: -800, quoted: true });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fillSnapshot([fillRow({ quote })]))));
  render(createElement(FillProbabilityDashboard));
  const table = await screen.findByRole("table", { name: "Fill probability stages" });
  expect(table.querySelector('[data-stage="after-normalize"]')).toHaveTextContent("Positive target below floating-point range");
  expect(table.querySelector('[data-stage="after-normalize"]')).toHaveTextContent("ln(p) -800");
  expect(screen.queryByText("No near quote")).toBeNull();
});

it("does not mix an expired quote with a current ready EMA", async () => {
  const row = fillRow({ ready: true, observedAt: FILL_NOW, quote: fillQuote({ at: FILL_NOW - 30_000 }) });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fillSnapshot([row]))));
  render(createElement(FillProbabilityDashboard));
  const table = await screen.findByRole("table", { name: "Fill probability stages" });
  expect(table.querySelector('[data-stage="actual"]')).toHaveAttribute("data-state", "current");
  expect(table.querySelector('[data-stage="final"] .fill-value')).toHaveTextContent("N/A");
  expect(screen.getByText("Quote observation expired or freshness unverified")).toBeInTheDocument();
});

it("distinguishes an observed but not-ready quote from telemetry that was never exported", async () => {
  const quote = fillQuote({ available: false, guardReason: "spread_not_ready", baseTarget: null, quoted: false });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fillSnapshot([fillRow({ quote })]))));
  render(createElement(FillProbabilityDashboard));
  await screen.findByRole("table", { name: "Fill probability stages" });
  expect(screen.getByText(/Quote was observed, but quote stages are unavailable/)).toHaveTextContent("spread_not_ready");
  expect(screen.queryByText(/Quote observation has not been exported by this producer/)).toBeNull();
  const sourceReason = screen.getByText("Quote source reason").parentElement!;
  expect(sourceReason).toHaveTextContent("spread_not_ready");
  expect(screen.getByText("Quote calculation time").parentElement).not.toHaveTextContent("N/A");
  expect(document.querySelector('[data-stage="final"] .fill-value')).toHaveTextContent("N/A");
});

it("does not describe an explicit zero target with no log target as positive underflow", async () => {
  const quote = fillQuote({ underflow: true, beforeNormalize: 0, afterNormalize: 0, logAfterNormalize: null, quoted: false, disabledMask: 1, guardReason: "side_disabled" });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fillSnapshot([fillRow({ quote })]))));
  render(createElement(FillProbabilityDashboard));
  const table = await screen.findByRole("table", { name: "Fill probability stages" });
  expect(table.querySelector('[data-stage="after-normalize"]')).not.toHaveTextContent("Positive target below floating-point range");
  expect(table.querySelector('[data-stage="after-normalize"]')).not.toHaveTextContent("ln(p)");
  expect(table.querySelector('[data-stage="final"]')).toHaveTextContent("Model disabled this side");
  expect(table.querySelector('[data-stage="final"]')).toHaveTextContent("No near quote");
});

it("maps all reported disable bits to their original meanings without inferring a blocker", async () => {
  const quote = fillQuote({ quoted: false, disabledMask: 31, guardReason: "side_disabled" });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fillSnapshot([fillRow({ quote })]))));
  render(createElement(FillProbabilityDashboard));
  const table = await screen.findByRole("table", { name: "Fill probability stages" });
  const final = table.querySelector('[data-stage="final"]')!;
  for (const reason of ["Model disabled this side", "Fee unavailable", "Risk blocked", "EV blocked", "Anti-arbitrage blocked", "Disable mask: 31"])
    expect(final).toHaveTextContent(reason);
});


it("accepts a cold producer response beyond one refresh interval without a false read failure", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
    const response = setTimeout(() => resolve(Response.json(fillSnapshot())), 12_000);
    options.signal?.addEventListener("abort", () => {
      clearTimeout(response);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  }));
  vi.stubGlobal("fetch", fetcher);
  render(createElement(FillProbabilityDashboard));
  await act(() => vi.advanceTimersByTimeAsync(12_000));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("table", { name: "Fill probability stages" })).toBeInTheDocument();
  expect(screen.getByText("0.0004")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("renders every probability node from a thin original row, including a real zero and native units", async () => {
  const q=fillQuote(),row=fillRow({ready:true,observedAt:FILL_NOW,actualEma:0,quote:q});
  const fetcher=vi.fn<(url:string)=>Promise<Response>>(async()=>Response.json(recordSnapshot([row])));vi.stubGlobal("fetch",fetcher);
  render(createElement(FillProbabilityDashboard));await screen.findByRole("table");
  const values={target:row.target,base:row.baseTheoreticalEma,model:row.theoreticalEma,actual:0,'base-reference':q.baseAtReferenceProbability,'ca-probability':q.currentCaProbability,'before-normalize':q.beforeNormalize,pmax:q.pmax,'after-normalize':q.afterNormalize,'before-guard':q.p1BeforeProbability,p1:q.p1AfterProbability,'post-only':q.postOnlyAfterProbability,p2:q.p2AfterProbability,final:q.finalProbability};
  for(const [stage,value] of Object.entries(values))expect(document.querySelector(`[data-stage="${stage}"] .fill-value strong`)).toHaveTextContent(Number(value!.toPrecision(6)).toString());
  expect(document.querySelector('[data-stage="actual"] .fill-gap strong')).toHaveTextContent("-0.001");
  expect(document.querySelector('[data-stage="actual"] .fill-gap small')).toHaveTextContent("-100%");
  expect(document.querySelector('[data-stage="actual"] .fill-gap')).not.toHaveStyle({color:"#a8b5bd"});
  expect(document.querySelector('[data-stage="ca"] .fill-gap')).toHaveTextContent("—");
  expect(new URL(fetcher.mock.calls[0][0] as string,"https://office.test").searchParams.get("view")).toBe("record");
});

it.each(["resolve","reject"] as const)("keeps only the latest A→B→C request when obsolete B later %ss", async mode => {
  const a=fillRow({id:"a",symbol:"venue.perp.a_usdt"}),b=fillRow({id:"b",symbol:"venue.perp.b_usdt"}),c=fillRow({id:"c",symbol:"venue.perp.c_usdt"});
  const pendingB=deferredResponse(),pendingC=deferredResponse();
  const fetcher=vi.fn<(url:string,options:RequestInit)=>Promise<Response>>(()=>Promise.resolve(Response.json(recordSnapshot([a,b,c],a))))
    .mockReturnValueOnce(Promise.resolve(Response.json(recordSnapshot([a,b,c],a)))).mockReturnValueOnce(pendingB.promise).mockReturnValueOnce(pendingC.promise);
  vi.stubGlobal("fetch",fetcher);render(createElement(FillProbabilityDashboard));await screen.findByRole("heading",{name:/a_usdt · Buy/});
  const select=screen.getByRole("combobox",{name:"Record (3)"});fireEvent.change(select,{target:{value:"b"}});fireEvent.change(select,{target:{value:"c"}});
  expect(fetcher.mock.calls[1][1].signal?.aborted).toBe(true);expect(screen.queryByRole("table")).toBeNull();
  await act(async()=>{if(mode==="resolve")pendingB.resolve(Response.json(recordSnapshot([a,b,c],b)));else pendingB.reject(new Error("old failed"));});
  expect(fetcher).toHaveBeenCalledTimes(3);expect(screen.queryByRole("table")).toBeNull();expect(screen.getByRole("status")).toBeInTheDocument();expect(screen.queryByRole("alert")).toBeNull();
  await act(async()=>pendingC.resolve(Response.json(recordSnapshot([a,b,c],c))));
  expect(screen.getByRole("heading",{name:/c_usdt · Buy/})).toBeInTheDocument();expect(screen.queryByRole("alert")).toBeNull();
  await act(async()=>{});expect(fetcher).toHaveBeenCalledTimes(3);
});

it("uses the latest filters after an in-flight selection and accepts an old full rollback response", async () => {
  const a=fillRow({id:"a"}),b=fillRow({id:"b",account:"two",symbol:"venue.perp.b_usdt"}),c=fillRow({id:"c",account:"three",symbol:"venue.perp.c_usdt",schema:9,clock:"trials"});
  const pending=deferredResponse();
  const fetcher=vi.fn<(url:string,options:RequestInit)=>Promise<Response>>(()=>Promise.resolve(Response.json(fillSnapshot([a,b,c]))))
   .mockReturnValueOnce(Promise.resolve(Response.json(recordSnapshot([a,b,c],a)))).mockReturnValueOnce(pending.promise);
  vi.stubGlobal("fetch",fetcher);render(createElement(FillProbabilityDashboard));await screen.findByRole("table");
  fireEvent.change(screen.getByRole("combobox",{name:"Record (3)"}),{target:{value:"b"}});
  fireEvent.change(screen.getByRole("combobox",{name:"Account"}),{target:{value:"three"}});
  await act(async()=>pending.resolve(Response.json(recordSnapshot([a,b,c],b))));
  expect(await screen.findByRole("heading",{name:/c_usdt · Buy/})).toBeInTheDocument();expect(screen.getByText("100 / 100 trials")).toBeInTheDocument();
  const url=new URL(fetcher.mock.calls[2][0],"https://office.test");expect(url.searchParams.get("account")).toBe("three");expect(fetcher).toHaveBeenCalledTimes(3);
});

it("updates dynamic membership and uses the first filtered fallback without a fetch loop", async () => {
  vi.useFakeTimers();const a=fillRow({id:"a"}),b=fillRow({id:"b",symbol:"venue.perp.b_usdt"}),c=fillRow({id:"c",symbol:"venue.perp.c_usdt"});
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json(recordSnapshot([a,b],a))).mockResolvedValueOnce(Response.json(recordSnapshot([a,b],b))).mockResolvedValueOnce(Response.json(recordSnapshot([c],c)));
  vi.stubGlobal("fetch",fetcher);render(createElement(FillProbabilityDashboard));await act(async()=>{});
  fireEvent.change(screen.getByRole("combobox",{name:"Record (2)"}),{target:{value:"b"}});await act(async()=>{});
  await act(()=>vi.advanceTimersByTimeAsync(10_000));
  expect(screen.getByRole("heading",{name:/c_usdt · Buy/})).toBeInTheDocument();expect(screen.getByRole("combobox",{name:"Record (1)"})).toHaveValue("c");expect(fetcher).toHaveBeenCalledTimes(3);
});

it("does not refetch an unchanged detail or truncate a long no-match search", async () => {
  vi.useFakeTimers();const a=fillRow({id:"a"}),b=fillRow({id:"b",account:"two"});
  const fetcher=vi.fn(async(url:string)=>Response.json(recordSnapshot([a,b],new URL(url,"https://office.test").searchParams.get("symbol")?null:a)));
  vi.stubGlobal("fetch",fetcher);render(createElement(FillProbabilityDashboard));await act(async()=>{});
  fireEvent.change(screen.getByRole("combobox",{name:"Account"}),{target:{value:a.account}});expect(fetcher).toHaveBeenCalledTimes(1);
  const symbol="x".repeat(100_000);fireEvent.change(screen.getByRole("textbox",{name:"Symbol"}),{target:{value:symbol}});
  expect(screen.getByText("No matching probability records.")).toBeInTheDocument();expect(fetcher).toHaveBeenCalledTimes(1);
  await act(()=>vi.advanceTimersByTimeAsync(10_000));
  expect(screen.getByRole("textbox",{name:"Symbol"})).toHaveValue(symbol);expect(new URL(fetcher.mock.calls[1][0],"https://office.test").searchParams.get("symbol")).toHaveLength(1025);
  expect(screen.queryByRole("table")).toBeNull();expect(screen.queryByRole("alert")).toBeNull();expect(within(screen.getByRole("combobox",{name:"Account"})).getByRole("option",{name:"two"})).toBeInTheDocument();
});

it("keeps the original twenty-second timeout and never labels another row as a failed selected detail", async () => {
  vi.useFakeTimers();const a=fillRow({id:"a"}),b=fillRow({id:"b",symbol:"venue.perp.b_usdt"});
  const fetcher=vi.fn((_url:string,options:RequestInit)=>new Promise<Response>((_resolve,reject)=>options.signal?.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true})))
   .mockResolvedValueOnce(Response.json(recordSnapshot([a,b],a)));
  vi.stubGlobal("fetch",fetcher);render(createElement(FillProbabilityDashboard));await act(async()=>{});
  fireEvent.change(screen.getByRole("combobox",{name:"Record (2)"}),{target:{value:"b"}});await act(()=>vi.advanceTimersByTimeAsync(20_001));
  expect(fetcher).toHaveBeenCalledTimes(2);expect(screen.getByRole("alert")).toHaveTextContent("Probability data could not be read");expect(screen.queryByRole("table")).toBeNull();
  expect(screen.getByRole("combobox",{name:"Record (2)"})).toHaveValue("b");
});

it("rejects a mismatched thin detail and marks retained facts unverified", async () => {
  vi.useFakeTimers();const a=fillRow({id:"a",ready:true,observedAt:FILL_NOW,quote:fillQuote()}),b=fillRow({id:"b",symbol:"venue.perp.b_usdt"});
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json(recordSnapshot([a,b],a))).mockResolvedValueOnce(Response.json(recordSnapshot([a,b],b)));
  vi.stubGlobal("fetch",fetcher);render(createElement(FillProbabilityDashboard));await act(async()=>{});await act(()=>vi.advanceTimersByTimeAsync(10_000));
  expect(screen.getByRole("alert")).toBeInTheDocument();expect(screen.getByText("Snapshot expired or freshness unverified")).toBeInTheDocument();expect(document.querySelector('[data-stage="actual"] .fill-value')).toHaveTextContent("N/A");
  expect(screen.queryByRole("heading",{name:/b_usdt · Buy/})).toBeNull();
});

it("includes nine seconds of request time for a twenty-six-second observation while aging quote separately", async () => {
  vi.useFakeTimers();let monotonic=0;vi.spyOn(performance,"now").mockImplementation(()=>monotonic);
  const row=fillRow({ready:true,observedAt:FILL_NOW-26_000,quote:fillQuote()});
  const fetcher=vi.fn(()=>new Promise<Response>(resolve=>setTimeout(()=>resolve(Response.json(recordSnapshot([row]))),9000)));
  vi.stubGlobal("fetch",fetcher);render(createElement(FillProbabilityDashboard));
  monotonic=9000;await act(()=>vi.advanceTimersByTimeAsync(9000));
  expect(screen.getByText("Snapshot expired or freshness unverified")).toBeInTheDocument();
  for(const stage of ["base","model","actual"])expect(document.querySelector(`[data-stage="${stage}"] .fill-value strong`)).toHaveTextContent("N/A");
  expect(document.querySelector('[data-stage="final"] .fill-value strong')).toHaveTextContent("0.0009");
  expect(screen.getByText("Current quote observation")).toBeInTheDocument();expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("Freshness includes request time; slow responses may appear gray.")).toBeInTheDocument();
});

it("keeps a fast response current then expires at the original thirty-second tick boundary", async () => {
  vi.useFakeTimers();let monotonic=0;vi.spyOn(performance,"now").mockImplementation(()=>monotonic);
  const row=fillRow({ready:true,observedAt:FILL_NOW-10_000,quote:fillQuote()});
  const fetcher=vi.fn(()=>new Promise<Response>(()=>{})).mockImplementationOnce(()=>new Promise(resolve=>setTimeout(()=>resolve(Response.json(recordSnapshot([row]))),1000)));
  vi.stubGlobal("fetch",fetcher);render(createElement(FillProbabilityDashboard));
  monotonic=1000;await act(()=>vi.advanceTimersByTimeAsync(1000));expect(document.querySelector('.fill-state')).toHaveAttribute("data-state","ready");
  monotonic=19_000;await act(()=>vi.advanceTimersByTimeAsync(18_000));expect(document.querySelector('.fill-state')).toHaveAttribute("data-state","ready");
  monotonic=20_000;await act(()=>vi.advanceTimersByTimeAsync(1000));expect(document.querySelector('.fill-state')).toHaveAttribute("data-state","stale");
  expect(document.querySelector('[data-stage="actual"] .fill-value strong')).toHaveTextContent("N/A");expect(screen.queryByRole("alert")).toBeNull();
});

it.each([365*86400_000,-365*86400_000])("ignores phone wall-clock jumps of %sms before and after receiving a sample", async offset => {
  vi.useFakeTimers();vi.setSystemTime(FILL_NOW);let monotonic=0;vi.spyOn(performance,"now").mockImplementation(()=>monotonic);
  const row=fillRow({ready:true,observedAt:FILL_NOW-10_000,quote:fillQuote()});
  const fetcher=vi.fn(()=>new Promise<Response>(()=>{})).mockImplementationOnce(()=>new Promise(resolve=>setTimeout(()=>resolve(Response.json(recordSnapshot([row]))),1000)));
  vi.stubGlobal("fetch",fetcher);render(createElement(FillProbabilityDashboard));
  vi.setSystemTime(FILL_NOW+offset);monotonic=1000;await act(()=>vi.advanceTimersByTimeAsync(1000));
  expect(document.querySelector('.fill-state')).toHaveAttribute("data-state","ready");
  vi.setSystemTime(FILL_NOW-offset);monotonic=19_000;await act(()=>vi.advanceTimersByTimeAsync(18_000));expect(document.querySelector('.fill-state')).toHaveAttribute("data-state","ready");
  vi.setSystemTime(FILL_NOW+offset);monotonic=20_000;await act(()=>vi.advanceTimersByTimeAsync(1000));expect(document.querySelector('.fill-state')).toHaveAttribute("data-state","stale");
});

it("does not reset a same-ID sample's age when its next read starts or fails", async () => {
  vi.useFakeTimers();let monotonic=0;vi.spyOn(performance,"now").mockImplementation(()=>monotonic);
  const row=fillRow({ready:true,observedAt:FILL_NOW-20_000,quote:fillQuote()});
  const next=deferredResponse();const fetcher=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>setTimeout(()=>resolve(Response.json(recordSnapshot([row]))),2000))).mockReturnValueOnce(next.promise);
  vi.stubGlobal("fetch",fetcher);render(createElement(FillProbabilityDashboard));
  monotonic=2000;await act(()=>vi.advanceTimersByTimeAsync(2000));expect(document.querySelector('.fill-state')).toHaveAttribute("data-state","ready");
  monotonic=10_000;await act(()=>vi.advanceTimersByTimeAsync(8000));expect(fetcher).toHaveBeenCalledTimes(2);expect(document.querySelector('.fill-state')).toHaveAttribute("data-state","stale");
  await act(async()=>next.reject(new Error("read failed")));expect(screen.getByRole("alert")).toBeInTheDocument();expect(document.querySelector('[data-stage="actual"] .fill-value')).toHaveTextContent("N/A");
});

it("anchors a queued latest selection to its own request, never the superseded request or response", async () => {
  vi.useFakeTimers();let monotonic=0;vi.spyOn(performance,"now").mockImplementation(()=>monotonic);
  const a=fillRow({id:"a",ready:true,observedAt:FILL_NOW}),b=fillRow({id:"b",symbol:"venue.perp.b_usdt"}),c=fillRow({id:"c",symbol:"venue.perp.c_usdt",ready:true,observedAt:FILL_NOW-24_000});
  const old=deferredResponse();const fetcher=vi.fn().mockResolvedValueOnce(Response.json(recordSnapshot([a,b,c],a))).mockReturnValueOnce(old.promise)
    .mockImplementationOnce(()=>new Promise(resolve=>setTimeout(()=>resolve(Response.json(recordSnapshot([a,b,c],c))),4000)));
  vi.stubGlobal("fetch",fetcher);render(createElement(FillProbabilityDashboard));await act(async()=>{});
  monotonic=1000;await act(()=>vi.advanceTimersByTimeAsync(1000));fireEvent.change(screen.getByRole("combobox",{name:"Record (3)"}),{target:{value:"b"}});
  monotonic=5000;await act(()=>vi.advanceTimersByTimeAsync(4000));fireEvent.change(screen.getByRole("combobox",{name:"Record (3)"}),{target:{value:"c"}});
  monotonic=6000;await act(()=>vi.advanceTimersByTimeAsync(1000));await act(async()=>old.resolve(Response.json(recordSnapshot([a,b,c],b))));
  expect(fetcher).toHaveBeenCalledTimes(3);expect(screen.getByRole("status")).toBeInTheDocument();
  monotonic=10_000;await act(()=>vi.advanceTimersByTimeAsync(4000));expect(screen.getByRole("heading",{name:/c_usdt · Buy/})).toBeInTheDocument();expect(document.querySelector('.fill-state')).toHaveAttribute("data-state","ready");
  monotonic=12_000;await act(()=>vi.advanceTimersByTimeAsync(2000));expect(document.querySelector('.fill-state')).toHaveAttribute("data-state","stale");expect(fetcher).toHaveBeenCalledTimes(3);
});

it("keeps old evidence stale through hide and resume until a newly bounded sample arrives", async () => {
  vi.useFakeTimers();let monotonic=0,hidden=false;vi.spyOn(performance,"now").mockImplementation(()=>monotonic);vi.spyOn(document,"hidden","get").mockImplementation(()=>hidden);
  const row=fillRow({ready:true,observedAt:FILL_NOW-20_000,quote:fillQuote()});const resumed=deferredResponse();
  const fetcher=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>setTimeout(()=>resolve(Response.json(recordSnapshot([row]))),1000))).mockReturnValueOnce(resumed.promise);
  vi.stubGlobal("fetch",fetcher);render(createElement(FillProbabilityDashboard));monotonic=1000;await act(()=>vi.advanceTimersByTimeAsync(1000));
  monotonic=4000;await act(()=>vi.advanceTimersByTimeAsync(3000));hidden=true;fireEvent(document,new Event("visibilitychange"));
  monotonic=11_000;await act(()=>vi.advanceTimersByTimeAsync(7000));expect(fetcher).toHaveBeenCalledTimes(1);expect(document.querySelector('.fill-state')).toHaveAttribute("data-state","stale");
  hidden=false;fireEvent(document,new Event("visibilitychange"));expect(fetcher).toHaveBeenCalledTimes(2);expect(document.querySelector('.fill-state')).toHaveAttribute("data-state","stale");
  monotonic=20_000;await act(()=>vi.advanceTimersByTimeAsync(9000));const reply=recordSnapshot([row]);reply.serverTime=FILL_NOW+11_000;
  await act(async()=>resumed.resolve(Response.json(reply)));expect(document.querySelector('.fill-state')).toHaveAttribute("data-state","stale");expect(screen.queryByRole("alert")).toBeNull();
});
