import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OfficeOnboarding } from "@/features/onboarding/components/OfficeOnboarding";
import { OfficeCodexAccount } from "@/features/office/components/OfficeCodexAccount";
afterEach(cleanup);
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
