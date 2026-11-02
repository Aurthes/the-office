import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OfficeOnboarding } from "@/features/onboarding/components/OfficeOnboarding";
import { CompanyActions } from "@/features/office/components/CompanyActions";
import { OfficeCodexAccount } from "@/features/office/components/OfficeCodexAccount";
afterEach(cleanup);
it("reads the shared account once on mount and checks again on reconnect or account changes",async()=>{
 let status!: (value:"connected"|"disconnected")=>void,notify!: (value:{event:string})=>void;
 const call=vi.fn(async()=>({loggedIn:true}));
 const client={call,onStatus:(listener:typeof status)=>{status=listener;listener("connected");return()=>{};},onEvent:(listener:typeof notify)=>{notify=listener;return()=>{};}};
 render(React.createElement(OfficeCodexAccount,{client,quiet:true}));await act(async()=>{});
 expect(call).toHaveBeenCalledExactlyOnceWith("office.account",{});
 await act(async()=>{status("disconnected");status("connected");});expect(call).toHaveBeenCalledTimes(2);
 await act(async()=>notify({event:"office.account"}));expect(call).toHaveBeenCalledTimes(3);
 expect(screen.queryByText("Checking Codex sign-in…")).not.toBeInTheDocument();
});
it("checks each chat quietly without starting another login",async()=>{
 const call=vi.fn(async()=>({loggedIn:true}));
 for(let opened=0;opened<2;opened++){
  const view=render(React.createElement(OfficeCodexAccount,{client:{call},quiet:true}));
  expect(screen.queryByText("Checking Codex sign-in…")).not.toBeInTheDocument();
  await act(async()=>{});
  expect(screen.queryByRole("button",{name:"Sign in with ChatGPT"})).not.toBeInTheDocument();view.unmount();
 }
 expect(call.mock.calls).toEqual([["office.account",{}],["office.account",{}]]);
});
it("still shows a real sign-in requirement after a quiet account check",async()=>{
 let finish!: (value:{loggedIn:boolean})=>void;
 const pending=new Promise(resolve=>{finish=resolve;});
 const call=vi.fn(async()=>pending);
 render(React.createElement(OfficeCodexAccount,{client:{call},quiet:true}));
 expect(screen.queryByText("Checking Codex sign-in…")).not.toBeInTheDocument();
 await act(async()=>finish({loggedIn:false}));
 expect(screen.getByRole("button",{name:"Sign in with ChatGPT"})).toBeInTheDocument();
 expect(call).toHaveBeenCalledExactlyOnceWith("office.account",{});
});
it("keeps account-check failures visible in quiet chats and reports deliberate retry progress",async()=>{
 let finish!: (value:{loggedIn:boolean})=>void;
 const call=vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 render(React.createElement(OfficeCodexAccount,{client:{call},quiet:true}));
 await screen.findByRole("alert");fireEvent.click(screen.getByRole("button",{name:"Retry"}));
 expect(screen.getByText("Checking Codex sign-in…")).toBeInTheDocument();
 await act(async()=>finish({loggedIn:true}));
 expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("uses the Office sign-in and recruitment path without OpenClaw setup",async()=>{
 let notify!: (value: {event:string})=>void;let signedIn=false;
 const call=vi.fn(async(method:string)=>method==="office.account"?{loggedIn:signedIn,loginFlow:"browser"}:{authUrl:"https://auth.openai.com/authorize"});
 render(React.createElement(OfficeOnboarding,{client:{call,onEvent:listener=>{notify=listener;return()=>{}}},connected:true,agentCount:0,onComplete:vi.fn()},React.createElement("button",null,"Recruit fixture")));
 await screen.findByRole("button",{name:"Sign in with ChatGPT"});expect(screen.queryByRole("button",{name:"Recruit fixture"})).not.toBeInTheDocument();
 expect(screen.getByRole("dialog").textContent).not.toMatch(/OpenClaw|gateway token|Node.js/);
 fireEvent.click(screen.getByRole("button",{name:"Sign in with ChatGPT"}));await screen.findByRole("link",{name:"Open OpenAI sign-in"});
 signedIn=true;await act(async()=>notify({event:"office.account"}));expect(screen.getByRole("button",{name:"Recruit fixture"})).toBeEnabled();
});
it("allows existing signed-in Office users to enter without creating another agent",async()=>{
 const done=vi.fn();render(React.createElement(OfficeOnboarding,{client:{call:async()=>({loggedIn:true})},connected:true,agentCount:2,onComplete:done},React.createElement("button",null,"Recruit fixture")));
 fireEvent.click(await screen.findByRole("button",{name:"Open your office"}));expect(done).toHaveBeenCalledTimes(1);expect(screen.queryByRole("button",{name:"Recruit fixture"})).not.toBeInTheDocument();
});
it("reports an account-read failure and retries without silently treating it as signed in",async()=>{
 const call=vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({loggedIn:false,loginFlow:"browser"});
 render(React.createElement(OfficeCodexAccount,{client:{call}}));await screen.findByRole("alert");fireEvent.click(screen.getByRole("button",{name:"Retry"}));await screen.findByRole("button",{name:"Sign in with ChatGPT"});expect(call).toHaveBeenCalledTimes(2);
 fireEvent.click(screen.getByRole("button",{name:"Use a sign-in code instead"}));await act(async()=>{});expect(call).toHaveBeenLastCalledWith("office.login",{flow:"device"});
});
it("rejects an unexpected sign-in destination",async()=>{
 const call=vi.fn(async(method:string)=>method==="office.account"?{loggedIn:false}:{authUrl:"https://untrusted.example/login"});render(React.createElement(OfficeCodexAccount,{client:{call}}));
 fireEvent.click(await screen.findByRole("button",{name:"Sign in with ChatGPT"}));expect(await screen.findByRole("alert")).toHaveTextContent("Invalid sign-in URL");expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("keeps recruitment editable after sign-in refresh with one account section",async()=>{
 let notify!: (value:{event:string})=>void;
 const client={call:vi.fn(async()=>({loggedIn:true})),onEvent:(listener:(value:{event:string})=>void)=>{notify=listener;return()=>{}}};
 const done=vi.fn();
 const view=()=>React.createElement(OfficeOnboarding,{client,connected:true,agentCount:0,onComplete:done},React.createElement(CompanyActions,{client,projects:[],showAccount:false,disabled:false,onCreated:async()=>{}}));
 const rendered=render(view());await screen.findByText("Codex is ready.");
 expect(screen.queryByText("Checking Codex sign-in…")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"+ Recruit agent"}));
 fireEvent.change(screen.getByLabelText("Name",{exact:true}),{target:{value:"First recruit"}});
 await act(async()=>notify({event:"office.account"}));rendered.rerender(view());
 expect(screen.getByLabelText("Name",{exact:true})).toHaveValue("First recruit");
 expect(screen.getByRole("dialog",{name:"Welcome to The Office"})).toBeInTheDocument();expect(done).not.toHaveBeenCalled();
});
