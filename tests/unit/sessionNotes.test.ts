import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionClient } from "@/features/office/components/SessionControls";
import { SessionNotes } from "@/features/office/components/SessionNotes";
import { SessionWorkspace } from "@/features/office/components/SessionWorkspace";
const id="10000000-0000-4000-8000-000000000001", target="20000000-0000-4000-8000-000000000002";
let stored:{id:string;text:string;revision:number;updatedAt:string|null};
let fetcher:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 localStorage.clear();stored={id,text:"before SELECTED after",revision:0,updatedAt:null};
 fetcher=vi.fn(async(_url:string,init?:RequestInit)=>{if(init?.method==="PUT"){const input=JSON.parse(String(init.body));if(input.revision!==stored.revision)return Response.json({}, {status:409});stored={...stored,...input,revision:stored.revision+1,updatedAt:new Date().toISOString()};}return Response.json({note:stored});});vi.stubGlobal("fetch",fetcher);
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const props=(call: SessionClient["call"]=vi.fn(async()=>({status:"started",turnId:"turn-1"})))=>({client:{call},threadId:id,gateway:"ws://fixture",agents:[{id,name:"worker4",status:"idle"},{id:target,name:"worker1",status:"running"}]});
async function editor(){return await screen.findByRole("textbox",{name:"Notes text"}) as HTMLTextAreaElement;}
function select(area:HTMLTextAreaElement,start=7,end=15){area.focus();area.setSelectionRange(start,end);fireEvent.select(area);}
describe("per-agent Notes",()=>{
 it("defaults to the current agent and preserves a manual recipient across roster refreshes",async()=>{
  const p=props();const view=render(React.createElement(SessionNotes,p));
  const area=await editor();await waitFor(()=>expect(area).not.toBeDisabled());
  expect(screen.getByLabelText("Send notes to agent")).toHaveValue(id);
  select(area);fireEvent.click(screen.getByRole("button",{name:"Send selection"}));
  await waitFor(()=>expect(p.client.call).toHaveBeenCalledWith("session.send",expect.objectContaining({threadId:id,message:"SELECTED"})));
  fireEvent.change(screen.getByLabelText("Send notes to agent"),{target:{value:target}});
  view.rerender(React.createElement(SessionNotes,{...p,agents:[...p.agents]}));
  expect(screen.getByLabelText("Send notes to agent")).toHaveValue(target);
 });
 it("resets the recipient to the new current agent when Workspace changes chats",async()=>{
  const p=props();p.client.call=vi.fn(async()=>({path:"",entries:[]}));
  fetcher.mockImplementation(async(url:string)=>Response.json({note:{...stored,id:url.includes(target)?target:id}}));
  const workspace={...p,noteAgents:p.agents,asset:null,assets:[],onSelectAsset:vi.fn(),onClose:vi.fn()};
  const view=render(React.createElement(SessionWorkspace,{...workspace,key:id}));
  fireEvent.click(screen.getByRole("tab",{name:"Notes"}));await waitFor(()=>expect(screen.getByLabelText("Send notes to agent")).toHaveValue(id));
  // ExistingSessionPanel already keys Workspace by threadId.
  view.rerender(React.createElement(SessionWorkspace,{...workspace,key:target,threadId:target}));
  fireEvent.click(screen.getByRole("tab",{name:"Notes"}));
  await waitFor(()=>expect(screen.getByLabelText("Send notes to agent")).toHaveValue(target));
 });
 it("sends only exact selected text to the UUID, freezes selection, preserves the note, uses ordinary steer receipts",async()=>{
  let resolve!:(v:unknown)=>void;const call=vi.fn(()=>new Promise(r=>{resolve=r}));
  render(React.createElement(SessionNotes,props(call as ReturnType<typeof props>["client"]["call"])));
  const area=await editor();await waitFor(()=>expect(area).not.toBeDisabled());select(area);
  fireEvent.change(screen.getByLabelText("Send notes to agent"),{target:{value:target}});
  fireEvent.click(screen.getByRole("button",{name:"Send selection"}));fireEvent.click(screen.getByRole("button",{name:"Sending…"}));
  expect(call).toHaveBeenCalledTimes(1);expect(call).toHaveBeenCalledWith("session.send",expect.objectContaining({threadId:target,message:"SELECTED",attachments:[],references:[],requestId:expect.any(String)}));
  fireEvent.change(area,{target:{value:"new draft"}});
  await act(async()=>resolve({status:"steered",turnId:"turn-2"}));
  expect(await screen.findByText("Sent as a follow-up to worker1")).toBeTruthy();expect(area.value).toBe("new draft");
  expect(call.mock.calls[0]).toEqual(["session.send",expect.objectContaining({message:"SELECTED"})]);expect(fetcher.mock.calls.some(([,init])=>init?.method==="PUT")).toBe(false);
 });
 it("explicitly saves for another device, removes saved local draft, and reopens the server version",async()=>{
  const view=render(React.createElement(SessionNotes,props()));const area=await editor();await waitFor(()=>expect(area).not.toBeDisabled());
  fireEvent.change(area,{target:{value:"  中文\nnew note  "}});expect(screen.getByText("Unsaved changes")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Save notes"}));await waitFor(()=>expect(stored.revision).toBe(1));await waitFor(()=>expect(localStorage.length).toBe(0));
  view.unmount();stored={...stored,text:"other device saved",revision:2};render(React.createElement(SessionNotes,props()));expect(await screen.findByDisplayValue("other device saved")).toBeTruthy();
 });
 it("restores unsaved drafts after close, but never overwrites another device on revision conflict",async()=>{
  const view=render(React.createElement(SessionNotes,props()));const area=await editor();await waitFor(()=>expect(area).not.toBeDisabled());fireEvent.change(area,{target:{value:"my unsaved draft"}});view.unmount();
  stored={...stored,text:"other device",revision:2};render(React.createElement(SessionNotes,props()));expect(await screen.findByDisplayValue("my unsaved draft")).toBeTruthy();expect(screen.getByText(/Notes changed on another device/)).toBeTruthy();expect(screen.getByRole("button",{name:"Save notes"})).toBeDisabled();
  expect(stored.text).toBe("other device");
 });
 it("keeps a 409 draft, and an unknown send is not retried automatically or by double click",async()=>{
  const call=vi.fn(async()=>{throw Error("offline")});render(React.createElement(SessionNotes,props(call)));
  const area=await editor();await waitFor(()=>expect(area).not.toBeDisabled());fireEvent.change(area,{target:{value:"MY DRAFT"}});stored.revision=1;
  fireEvent.click(screen.getByRole("button",{name:"Save notes"}));await screen.findByText(/Notes changed on another device/);expect(area.value).toBe("MY DRAFT");
  select(area,0,8);fireEvent.change(screen.getByLabelText("Send notes to agent"),{target:{value:target}});fireEvent.click(screen.getByRole("button",{name:"Send selection"}));
  await screen.findByText(/Delivery unconfirmed/);expect(call).toHaveBeenCalledTimes(1);expect(screen.getByRole("button",{name:"Send selection"})).toBeDisabled();expect(area.value).toBe("MY DRAFT");
 });
 it("guards empty/oversize Chinese selections and unavailable UUIDs",async()=>{
  stored.text="中".repeat(11000);const p=props();render(React.createElement(SessionNotes,p));const area=await editor();await waitFor(()=>expect(area).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText("Send notes to agent"),{target:{value:target}});expect(screen.getByRole("button",{name:"Send selection"})).toBeDisabled();
  select(area,0,11000);expect(screen.getByText(/Selection exceeds/)).toBeTruthy();expect(screen.getByRole("button",{name:"Send selection"})).toBeDisabled();expect(p.client.call).not.toHaveBeenCalled();
 });
 it("offers Notes without a special preset and keeps its draft while changing workspace tabs",async()=>{
  const p=props();p.client.call=vi.fn(async()=>({path:"",entries:[]}));
  render(React.createElement(SessionWorkspace,{...p,noteAgents:p.agents,asset:null,assets:[],onSelectAsset:vi.fn(),onClose:vi.fn()}));
  expect(fetcher).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("tab",{name:"Notes"}));const area=await editor();await waitFor(()=>expect(area).not.toBeDisabled());fireEvent.change(area,{target:{value:"tab draft"}});
  fireEvent.click(screen.getByRole("tab",{name:"Files"}));fireEvent.click(screen.getByRole("tab",{name:"Notes"}));expect(screen.getByDisplayValue("tab draft")).toBeTruthy();expect(fetcher).toHaveBeenCalledTimes(1);
 });
});
