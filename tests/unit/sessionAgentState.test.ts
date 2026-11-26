import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SessionAgentState } from "@/features/office/components/SessionAgentState";
import { SessionWorkspace } from "@/features/office/components/SessionWorkspace";
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();});
const sections={focus:"Current essential direction",decisions:"Decision with reason",followUp:"Who owes what",links:"T247 / original"};
const row=(id="alice",revision=1)=>({id,revision,updatedAt:revision?"2026-11-26T08:00:00Z":null,sections});
it("shows actual saved sections/revision/time, edits explicitly and accepts only confirmed CAS save",async()=>{
 const client={call:vi.fn(async(method:string,p:unknown)=>method==="agent.state.get"?row():{...row("alice",2),sections:(p as {sections:unknown}).sections})};
 render(React.createElement(SessionAgentState,{client,agentId:"alice"}));
 expect(await screen.findByText(sections.focus)).toBeVisible();expect(screen.getByText(/Saved revision/)).toHaveTextContent("1");expect(document.querySelector("time")).toHaveAttribute("dateTime","2026-11-26T08:00:00Z");
 fireEvent.click(screen.getByRole("button",{name:"Edit Agent State"}));fireEvent.change(screen.getByLabelText("Current focus"),{target:{value:"Updated direction"}});
 fireEvent.click(screen.getByRole("button",{name:"Save Agent State"}));
 await waitFor(()=>expect(screen.getByText(/Saved revision/)).toHaveTextContent("2"));expect(screen.getByText("Updated direction")).toBeVisible();
 expect(client.call).toHaveBeenCalledWith("agent.state.save",{actorId:"alice",revision:1,sections:{...sections,focus:"Updated direction"}});
});
it("leaves conflict/unknown drafts visible without automatic retry or false saved claim",async()=>{
 const client={call:vi.fn(async(method:string)=>{if(method==="agent.state.get")return row();throw Error("409");})};
 render(React.createElement(SessionAgentState,{client,agentId:"alice"}));await screen.findByText(sections.focus);
 fireEvent.click(screen.getByText("Edit Agent State"));fireEvent.change(screen.getByLabelText("Current focus"),{target:{value:"My kept draft"}});fireEvent.click(screen.getByText("Save Agent State"));
 expect(await screen.findByRole("alert")).toHaveTextContent("Your draft is kept");expect(screen.getByLabelText("Current focus")).toHaveValue("My kept draft");expect(screen.getByText("Save Agent State")).toBeDisabled();expect(client.call.mock.calls.filter(([m])=>m==="agent.state.save")).toHaveLength(1);
});
it("switches employee without displaying previous state or accepting late load/save results",async()=>{
 let resolve!: (v:unknown)=>void;
 const client={call:vi.fn(async(_m:string,p:unknown)=>(p as {actorId:string}).actorId==="alice"?new Promise(r=>resolve=r):row("bob"))};
 const view=render(React.createElement(SessionAgentState,{client,agentId:"alice"}));
 view.rerender(React.createElement(SessionAgentState,{client,agentId:"bob"}));expect(await screen.findByText(sections.focus)).toBeVisible();
 await act(async()=>resolve({...row(),sections:{...sections,focus:"STALE ALICE"}}));expect(screen.queryByText("STALE ALICE")).toBeNull();expect(document.querySelector("[data-agent-state]")).toHaveAttribute("data-agent-state","bob");
});
it("exposes real empty and load failure/retry states without claiming saved memory",async()=>{
 const client={call:vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValue({...row("alice",0),sections:{focus:"",decisions:"",followUp:"",links:""}})};
 render(React.createElement(SessionAgentState,{client,agentId:"alice"}));expect(await screen.findByRole("alert")).toHaveTextContent("Could not load");expect(screen.getByText("Edit Agent State")).toBeDisabled();
 fireEvent.click(screen.getByText("Reload Agent State"));expect(await screen.findByText("No Agent State has been saved for this employee.")).toBeVisible();expect(screen.getByText(/Saved revision/)).toHaveTextContent("0");
});
it("adds Agent State inside the existing Workspace without borrowing Notes",async()=>{
 const client={call:vi.fn(async(method:string)=>method==="agent.state.get"?row():{path:"",entries:[]})};
 render(React.createElement(SessionWorkspace,{client,threadId:"alice",asset:null,assets:[],onSelectAsset:vi.fn(),onClose:vi.fn()}));
 fireEvent.click(screen.getByRole("tab",{name:"Agent State"}));expect(await screen.findByText(sections.focus)).toBeVisible();expect(screen.getByRole("tab",{name:"Notes"})).toBeTruthy();
 expect(client.call.mock.calls.some(([m])=>m.includes("send")||m.includes("notes"))).toBe(false);
});
it("does not let a late save acknowledgement replace another employee's current state",async()=>{
 let resolve!:(v:unknown)=>void;
 const client={call:vi.fn(async(m:string,p:unknown)=>m==="agent.state.save"?new Promise(r=>resolve=r):row((p as {actorId:string}).actorId))};
 const view=render(React.createElement(SessionAgentState,{client,agentId:"alice"}));await screen.findByText(sections.focus);
 fireEvent.click(screen.getByText("Edit Agent State"));fireEvent.change(screen.getByLabelText("Current focus"),{target:{value:"Alice only"}});fireEvent.click(screen.getByText("Save Agent State"));
 view.rerender(React.createElement(SessionAgentState,{client,agentId:"bob"}));await screen.findByText(sections.focus);
 await act(async()=>resolve({...row("alice",2),sections:{...sections,focus:"Alice only"}}));
 expect(screen.queryByText("Alice only")).toBeNull();expect(document.querySelector("[data-agent-state]")).toHaveAttribute("data-agent-state","bob");
});

it.each([false,true])("restores a dirty/failed-save draft after the real Workspace close button unmounts it (failed=%s)", async failed=>{
 const client={call:vi.fn(async(method:string)=>{if(method==="agent.state.get")return row();if(method==="agent.state.save")throw Error("409");return {path:"",entries:[]};})};
 function Host(){const[open,setOpen]=React.useState(true);return open?React.createElement(SessionWorkspace,{client,threadId:"alice",gateway:"fixture",asset:null,assets:[],onSelectAsset:()=>{},onClose:()=>setOpen(false)}):React.createElement("button",{onClick:()=>setOpen(true)},"Open workspace");}
 render(React.createElement(Host));fireEvent.click(screen.getByRole("tab",{name:"Agent State"}));await screen.findByText(sections.focus);fireEvent.click(screen.getByText("Edit Agent State"));fireEvent.change(screen.getByLabelText("Current focus"),{target:{value:"Must survive Workspace close"}});
 if(failed){fireEvent.click(screen.getByText("Save Agent State"));await screen.findByRole("alert");}
 fireEvent.click(screen.getByRole("button",{name:"Close workspace"}));fireEvent.click(screen.getByText("Open workspace"));fireEvent.click(screen.getByRole("tab",{name:"Agent State"}));await waitFor(()=>expect(screen.getByLabelText("Current focus")).toHaveValue("Must survive Workspace close"));
 expect(client.call.mock.calls.filter(([m])=>m==="agent.state.save")).toHaveLength(failed?1:0);
});
