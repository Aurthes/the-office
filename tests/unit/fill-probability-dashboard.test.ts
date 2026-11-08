import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FillProbabilityDashboard } from "@/features/fill-probability/FillProbabilityDashboard";
import { MonitorDashboard } from "@/features/ring-ship/MonitorDashboard";
import { FILL_DEFAULT_COLUMNS, projectFillTable, type FillRow, type FillColumn } from "@/lib/fill-probability/model";
import { FILL_NOW, fillQuote, fillRow, fillSnapshot } from "../fixtures/fill-probability";

function pair(symbol="venue.perp.a_usdt", bid=.0018, ask=.0018, changes:Partial<FillRow>={}) {
  return [fillRow({id:symbol+":bid",symbol,ready:true,observedAt:FILL_NOW,quote:fillQuote({currentCaProbability:bid}),...changes}),
    fillRow({id:symbol+":ask",symbol,side:"ask",ready:true,observedAt:FILL_NOW,quote:fillQuote({currentCaProbability:ask}),...changes})];
}
function deferred() { let resolve!:(r:Response)=>void,reject!:(e:Error)=>void;const promise=new Promise<Response>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; }
const table=()=>screen.getByRole("table",{name:"Fill probability symbols"});
const row=(symbol:string)=>Array.from(table().querySelectorAll<HTMLTableRowElement>("tbody>tr")).find(r=>r.dataset.symbol===symbol)!;
const cell=(symbol:string,column:FillColumn,side="bid")=>row(symbol).querySelector<HTMLElement>(`[data-column="${column}"] [data-side="${side}"]`)!;
const order=()=>Array.from(table().querySelectorAll<HTMLTableRowElement>("tbody>tr")).map(r=>r.dataset.symbol);
const tick=async(ms:number)=>{await act(()=>vi.advanceTimersByTimeAsync(ms));};
const load=async(rows=pair())=>{const fetcher=vi.fn<(url:string,options?:RequestInit)=>Promise<Response>>(async()=>Response.json(fillSnapshot(rows)));vi.stubGlobal("fetch",fetcher);const view=render(createElement(FillProbabilityDashboard));await screen.findByRole("table",{name:"Fill probability symbols"});return {view,fetcher};};
const toggle=(name:string)=>fireEvent.click(screen.getByRole("checkbox",{name}));

beforeEach(()=>{localStorage.setItem("claw3d:ui-language","en");vi.spyOn(document,"hidden","get").mockReturnValue(false);});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

it("shows exactly five default metric columns with paired original values, gaps and native CA",async()=>{
  const rows=pair();rows[0].theoreticalEma=.00091;rows[0].ca=999;rows[0].quote!.ca=2;
  const {fetcher}=await load(rows);expect(table().querySelectorAll("thead th")).toHaveLength(6);
  expect(within(cell(rows[0].symbol,"model")).getByText("0.00091")).toBeInTheDocument();
  expect(within(cell(rows[0].symbol,"ca")).getByText("2")).toBeInTheDocument();
  expect(cell(rows[0].symbol,"ca").textContent).toContain("×");expect(cell(rows[0].symbol,"ca").querySelector(".fill-gap")).toBeNull();
  expect(cell(rows[0].symbol,"model").querySelector(".fill-gap")?.textContent).toContain("-9%");
  expect(cell(rows[0].symbol,"model").querySelector(".fill-gap")).toHaveStyle({color:"hsl(109.2 65% 70%)"});
  expect(new URL(fetcher.mock.calls[0][0] as unknown as string,"https://test").searchParams.get("view")).toBe("table");
  expect(screen.queryByRole("combobox",{name:/Record/})).toBeNull();expect(document.body.textContent).not.toMatch(/score/i);
  expect(screen.getAllByRole("checkbox")).toHaveLength(17);expect(screen.getAllByRole("checkbox").filter(i=>(i as HTMLInputElement).checked)).toHaveLength(5);
});
it("uses both absolute deviations, keeps zero valid, and has no score control or cell",async()=>{
  await load([...pair("A",.0018,.0018),...pair("B",.002,.001),...pair("zero",0,0),...pair("hit",.001,.001),...pair("missing",.9,.9)] .map(r=>r.symbol==="missing"&&r.side==="ask"?{...r,quote:null}:r));
  expect(order()).toEqual(["zero","A","B","hit","missing"]);
  fireEvent.change(screen.getByRole("combobox",{name:"Side"}),{target:{value:"bid"}});
  expect(order()).toEqual(["zero","A","B","hit","missing"]);expect(table().querySelector('[data-side="ask"]')).toBeNull();
  await act(async()=>toggle("Fill prob/s after c_A"));expect(order()).toEqual(["zero","A","B","hit","missing"]);
  expect(table().querySelector('[data-column="ca-probability"]')).toBeNull();expect(document.body.textContent).not.toMatch(/score/i);
});
it("ages either quote out of ordering while stale EMA alone leaves quotes usable",async()=>{
  vi.useFakeTimers();const rows=[...pair("A",.0018,.0018),...pair("B",.002,.001)];
  rows[1].quote!.at=FILL_NOW-29_000;rows[2].observedAt=FILL_NOW-60_000;
  const fetcher=vi.fn(async()=>Response.json(fillSnapshot(rows)));vi.stubGlobal("fetch",fetcher);render(createElement(FillProbabilityDashboard));await act(async()=>{});
  expect(order()).toEqual(["A","B"]);expect(cell("B","model").textContent).toContain("N/A");expect(cell("B","ca-probability").textContent).toContain("0.002");
  await tick(1001);expect(order()).toEqual(["B","A"]);expect(fetcher).toHaveBeenCalledTimes(1);
});
it("keeps strategy/exchange/account/instance groups distinct and filters locally with full options",async()=>{
  const rows=[...pair("a"),...pair("b",.001,.001,{account:"two",strategy:"second",exchange:"other",instance:"6"})];
  const {fetcher}=await load(rows);
  fireEvent.change(screen.getByRole("combobox",{name:"Account"}),{target:{value:"two"}});expect(order()).toEqual(["b"]);
  expect(within(screen.getByRole("combobox",{name:"Account"})).getByRole("option",{name:"account-one"})).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox",{name:"Symbol"}),{target:{value:"x".repeat(1025)}});expect(screen.getByText("No matching probability records.")).toBeInTheDocument();expect(fetcher).toHaveBeenCalledTimes(1);
});
it("never substitutes feedback CA when applied quote CA is missing or expired",async()=>{
  const rows=pair();rows[0].ca=123;rows[0].quote!.ca=null;rows[1].quote!.at=FILL_NOW-31_000;
  await load(rows);expect(cell(rows[0].symbol,"ca").textContent).toContain("N/A");expect(cell(rows[0].symbol,"ca","ask").textContent).toContain("N/A");expect(cell(rows[0].symbol,"ca").textContent).not.toContain("123");
});
it("supports custom/all/empty columns and preserves underflow, guards, disabled masks and no-quote",async()=>{
  const rows=pair();rows[0].quote=fillQuote({afterNormalize:0,underflow:true,logAfterNormalize:-800,p1State:"not-run",quoted:false,finalProbability:null,disabledMask:31});
  await load(rows);
  await act(async()=>{for(const checkbox of screen.getAllByRole("checkbox")) if(!(checkbox as HTMLInputElement).checked) fireEvent.click(checkbox);});
  expect(table().querySelectorAll("thead th")).toHaveLength(18);expect(cell(rows[0].symbol,"after-normalize").textContent).toContain("ln(p) -800");
  expect(cell(rows[0].symbol,"p1").textContent).toContain("N/A");expect(cell(rows[0].symbol,"final").textContent).toContain("Fee unavailable");expect(cell(rows[0].symbol,"final").textContent).toContain("Risk blocked");
  await act(async()=>{for(const checkbox of screen.getAllByRole("checkbox")) if((checkbox as HTMLInputElement).checked) fireEvent.click(checkbox);});
  expect(table().querySelectorAll("thead th")).toHaveLength(1);expect(order()).toEqual([rows[0].symbol]);
});
it("keeps raw true zero and historical EMA gray, Exposure and Trials evidence distinct",async()=>{
  const rows=pair();rows[0].actualEma=0;rows[0].ready=null;rows[0].observedAt=null;rows[1].schema=9;rows[1].clock="trials";
  await load(rows);expect(within(cell(rows[0].symbol,"actual")).getByText("0")).toBeInTheDocument();expect(cell(rows[0].symbol,"actual").querySelector(".fill-gap")).toHaveStyle({color:"#a8b5bd"});
  expect(row(rows[0].symbol).textContent).toContain("exposure_seconds");expect(row(rows[0].symbol).textContent).toContain("trials");
});
it("honors disabled normalization and not-run actions without claiming positive underflow",async()=>{
  const rows=pair();rows[0].quote=fillQuote({normalizationEnabled:false,pmax:null,afterNormalize:0,underflow:false,logAfterNormalize:null,postOnlyState:"not-run",p2State:"unchanged"});
  await load(rows);await act(async()=>{toggle("Reachable maximum probability");toggle("After normalization");toggle("Guard action · post-only / P2");});
  expect(cell(rows[0].symbol,"pmax").textContent).toContain("N/A");expect(cell(rows[0].symbol,"after-normalize").textContent).not.toContain("ln(p)");expect(cell(rows[0].symbol,"guard").textContent).toContain("Not run");expect(cell(rows[0].symbol,"guard").textContent).toContain("Passed without price change");
});
it("accepts a thin reply and full-server rollback, rejects incomplete record replies",async()=>{
  const rows=pair(),snapshot=fillSnapshot(rows);const fetcher=vi.fn(async()=>Response.json(projectFillTable(snapshot,FILL_DEFAULT_COLUMNS)));vi.stubGlobal("fetch",fetcher);
  const view=render(createElement(FillProbabilityDashboard));await screen.findByRole("table",{name:"Fill probability symbols"});view.unmount();
  fetcher.mockImplementation(async()=>Response.json({view:"record",records:[],row:rows[0],configured:true,serverTime:FILL_NOW,sampledAt:FILL_NOW,sourceErrors:0}));render(createElement(FillProbabilityDashboard));expect(await screen.findByRole("alert")).toBeInTheDocument();expect(fetcher).toHaveBeenCalledTimes(2);
});
it("rejects mismatched table identity or duplicate side IDs as unverified",async()=>{
  const reply=projectFillTable(fillSnapshot(pair()),FILL_DEFAULT_COLUMNS);reply.rows[0].id="wrong";vi.stubGlobal("fetch",vi.fn(async()=>Response.json(reply)));render(createElement(FillProbabilityDashboard));expect(await screen.findByRole("alert")).toBeInTheDocument();expect(screen.queryByRole("table")).toBeNull();
});
it("serializes rapid column changes and never installs superseded results or catches",async()=>{
  const pending=deferred();let calls=0;
  const fetcher=vi.fn(async()=>++calls===1?Response.json(fillSnapshot(pair())):calls===2?pending.promise:Response.json(fillSnapshot(pair("new"))));vi.stubGlobal("fetch",fetcher);
  render(createElement(FillProbabilityDashboard));await screen.findByRole("table",{name:"Fill probability symbols"});
  toggle("Base theoretical EMA");toggle("After normalization");toggle("Base theoretical EMA");
  expect(fetcher).toHaveBeenCalledTimes(2);await act(async()=>pending.resolve(Response.json(fillSnapshot(pair("obsolete")))));
  expect(fetcher).toHaveBeenCalledTimes(3);expect(order()).toEqual(["new"]);expect(screen.queryByRole("alert")).toBeNull();
  expect(table().querySelector('[data-column="base"]')).toBeNull();expect(table().querySelector('[data-column="after-normalize"]')).not.toBeNull();
});
it("keeps the original twenty-second timeout and old facts gray on failure",async()=>{
  vi.useFakeTimers();let signal:AbortSignal|undefined;
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json(fillSnapshot(pair()))).mockImplementation((_url:string,options:RequestInit)=>new Promise((_resolve,reject)=>{signal=options.signal!;signal!.addEventListener("abort",()=>reject(new Error("abort")));}));vi.stubGlobal("fetch",fetcher);
  render(createElement(FillProbabilityDashboard));await act(async()=>{});await tick(10_000);await tick(19_999);expect(signal?.aborted).toBe(false);await tick(1);expect(signal?.aborted).toBe(true);expect(screen.getByRole("alert")).toBeInTheDocument();expect(cell("venue.perp.a_usdt","model").textContent).toContain("N/A");
});
it("uses request-start elapsed for slow responses and independent quote time",async()=>{
  vi.useFakeTimers();const pending=deferred(),rows=pair();for(const r of rows) {r.observedAt=FILL_NOW-26_000;r.quote!.at=FILL_NOW;}
  vi.stubGlobal("fetch",vi.fn(()=>pending.promise));render(createElement(FillProbabilityDashboard));await tick(9000);await act(async()=>pending.resolve(Response.json(fillSnapshot(rows))));
  expect(cell(rows[0].symbol,"model").textContent).toContain("N/A");expect(cell(rows[0].symbol,"ca-probability").textContent).toContain("0.0018");expect(row(rows[0].symbol).querySelector('[data-ema-state="stale"]')).not.toBeNull();
});
it.each([-365,365])("ignores phone wall-clock shift %s days and expires on the original tick",async(days)=>{
  vi.useFakeTimers();const rows=pair();rows.forEach(r=>r.observedAt=FILL_NOW-29_000);
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json(fillSnapshot(rows))));render(createElement(FillProbabilityDashboard));await act(async()=>{});
  expect(cell(rows[0].symbol,"model").textContent).toContain("0.0009");vi.setSystemTime(new Date(FILL_NOW+days*86400_000));await tick(1000);expect(cell(rows[0].symbol,"model").textContent).toContain("N/A");
});
it("does not reset same-ID age on next-read failure and keeps original epochs",async()=>{
  vi.useFakeTimers();const rows=pair();rows.forEach(r=>r.observedAt=FILL_NOW-25_000);const fetcher=vi.fn().mockResolvedValueOnce(Response.json(fillSnapshot(rows))).mockRejectedValue(new Error());vi.stubGlobal("fetch",fetcher);
  render(createElement(FillProbabilityDashboard));await act(async()=>{});await tick(10_000);expect(cell(rows[0].symbol,"model").textContent).toContain("N/A");expect(row(rows[0].symbol).textContent).toContain("stale");expect(screen.getByRole("alert")).toBeInTheDocument();
});
it("pauses hidden, preserves aged evidence on resume, and aborts on unmount",async()=>{
  vi.useFakeTimers();let hidden=false;vi.spyOn(document,"hidden","get").mockImplementation(()=>hidden);const pending=deferred();
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json(fillSnapshot(pair()))).mockImplementation(()=>pending.promise);vi.stubGlobal("fetch",fetcher);
  const view=render(createElement(FillProbabilityDashboard));await act(async()=>{});hidden=true;fireEvent(document,new Event("visibilitychange"));await tick(35_000);expect(fetcher).toHaveBeenCalledTimes(1);
  hidden=false;fireEvent(document,new Event("visibilitychange"));expect(cell("venue.perp.a_usdt","model").textContent).toContain("N/A");const signal=fetcher.mock.calls[1][1].signal;view.unmount();expect(signal.aborted).toBe(true);
});
it("anchors the queued latest sample to its own request, not old response completion",async()=>{
  vi.useFakeTimers();const a=deferred(),b=deferred();let calls=0;
  vi.stubGlobal("fetch",vi.fn(()=>++calls===1?a.promise:b.promise));render(createElement(FillProbabilityDashboard));await tick(5000);toggle("Base theoretical EMA");await act(async()=>a.resolve(Response.json(fillSnapshot(pair("old")))));
  await tick(9000);const rows=pair("new");rows.forEach(r=>r.observedAt=FILL_NOW-26_000);const snapshot=fillSnapshot(rows);snapshot.serverTime=FILL_NOW+5000;
  await act(async()=>b.resolve(Response.json(snapshot)));expect(order()).toEqual(["new"]);expect(cell("new","model").textContent).toContain("N/A");
});
it("replaces dynamic membership on automatic poll without a fetch loop",async()=>{
  vi.useFakeTimers();const fetcher=vi.fn().mockResolvedValueOnce(Response.json(fillSnapshot(pair("old")))).mockResolvedValue(Response.json(fillSnapshot(pair("new"))));vi.stubGlobal("fetch",fetcher);
  render(createElement(FillProbabilityDashboard));await act(async()=>{});await tick(10_000);expect(order()).toEqual(["new"]);expect(fetcher).toHaveBeenCalledTimes(2);
});
it("opens the normal built-in table in the control room on demand",async()=>{
  Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value(){this.open=true;}});Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value(){this.open=false;}});
  const fetcher=vi.fn(async(url:string)=>Response.json(url.includes("/fill-probability")?fillSnapshot(pair()):{links:[]}));vi.stubGlobal("fetch",fetcher);const open=vi.spyOn(window,"open");
  render(createElement(MonitorDashboard,{open:true,onClose:vi.fn()}));expect(fetcher.mock.calls.some(([url])=>url.includes("/fill-probability"))).toBe(false);
  fireEvent.click(await screen.findByRole("button",{name:"Open monitor: Fill probability"}));await screen.findByRole("table",{name:"Fill probability symbols"});expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Back to monitors"}));expect(screen.queryByRole("region",{name:"Fill probability"})).toBeNull();
});
