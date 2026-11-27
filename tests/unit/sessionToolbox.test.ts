import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionToolbox } from "@/features/office/components/SessionToolbox";
import { SessionWorkspace } from "@/features/office/components/SessionWorkspace";
import { CEO_ID, OPEN_DEPARTMENT_ID, type OrganizationView } from "@/lib/office/organization";
import { setUiLanguage } from "@/lib/i18n/ui-language";
const tool = { kind: "tool" as const, name: "Duration report", summary: "Check a finished job", instructions: "An ordinary tutorial. ".repeat(60)+"\n\n```sh\nreadonly-report --job "+"x".repeat(1600)+"\n```", source: "javascript:unsafe()", version: "9fbb5ae3", status: "active" as const };
function organization(scope="A"): OrganizationView {
  return { people: [{id:"ll",name:"Same name",department:"LeadLag",departmentId:"LL",title:"Worker",reportsTo:[]},{id:"office",name:"Same name",department:"Office",departmentId:"Office",title:"Worker",reportsTo:[]},{id:"ow",name:"Unassigned",department:"Open Workspace",departmentId:null,title:"Worker",reportsTo:[]},{id:CEO_ID,name:"CEO",department:"Company",departmentId:null,title:"CEO",reportsTo:[]}],ceoAvatar:null,savePosition:vi.fn(),departmentAssetsState:{scope,ready:true,error:""}, departmentAssets:{LL:{one:tool,guide:{...tool,kind:"guideline",name:"Hidden guide"},draft:{...tool,name:"Draft tool",status:"draft"},old:{...tool,name:"Old tool",status:"deprecated"}},Office:{one:{...tool,name:"Office only"}},[OPEN_DEPARTMENT_ID]:{one:{...tool,name:"OW only"}}} };
}
beforeEach(()=>setUiLanguage("en"));afterEach(()=>{cleanup();vi.restoreAllMocks();});
it("uses this panel's exact thread, retains statuses, only shows tools and has no write or execution actions", async()=>{
 const org=organization(),v=render(h(SessionToolbox,{threadId:"ll",organization:org}));
 expect(screen.getByText("Duration report")).toBeVisible();expect(screen.getByText(/Draft ·/)).toBeVisible();expect(screen.getByText(/Deprecated ·/)).toBeVisible();expect(screen.queryByText("Hidden guide")).toBeNull();
 const details=screen.getByText("Duration report").closest("details")!;details.open=true;fireEvent(details,new Event("toggle"));
 expect(await screen.findByText(/An ordinary tutorial/)).toBeVisible();expect(screen.getByText(/readonly-report --job/)).toBeVisible();expect(screen.getByText("javascript:unsafe()")).toBeVisible();expect(screen.queryByRole("link")).toBeNull();expect(screen.queryByRole("button",{name:/Add|Edit|Deprecate|Run|Execute/})).toBeNull();
 v.rerender(h(SessionToolbox,{threadId:"office",organization:org}));expect(screen.getByText("Office only")).toBeVisible();expect(screen.queryByText("Duration report")).toBeNull();expect(screen.queryByText(/readonly-report --job/)).toBeNull();
 v.rerender(h(SessionToolbox,{threadId:"ow",organization:org}));expect(screen.getByText("OW only")).toBeVisible();
 for(const threadId of [CEO_ID,"missing"]){v.rerender(h(SessionToolbox,{threadId,organization:org}));expect(screen.getByText(/No department could be identified/)).toBeVisible();expect(screen.queryByText("OW only")).toBeNull();}
});
it("distinguishes loading, failure and confirmed empty, and resets details across department/gateway changes",async()=>{
 const org=organization();const v=render(h(SessionToolbox,{threadId:"ll"}));expect(screen.getByRole("status")).toHaveTextContent("Loading");
 v.rerender(h(SessionToolbox,{threadId:"ll",organization:{...org,departmentAssetsState:{scope:"B",ready:false,error:""},departmentAssets:{}}}));expect(screen.getByRole("status")).toBeVisible();expect(screen.queryByText("Duration report")).toBeNull();
 v.rerender(h(SessionToolbox,{threadId:"ll",organization:{...org,departmentAssetsState:{scope:"B",ready:false,error:"Disconnected"}}}));expect(screen.getByRole("alert")).toHaveTextContent("Disconnected");expect(screen.queryByText(/No assets/)).toBeNull();
 v.rerender(h(SessionToolbox,{threadId:"ll",organization:{...org,departmentAssets:{}}}));expect(screen.getAllByText("No assets registered yet.").length).toBeGreaterThan(0);
 v.rerender(h(SessionToolbox,{threadId:"ll",organization:org}));let details=screen.getByText("Duration report").closest("details")!;details.open=true;fireEvent(details,new Event("toggle"));await screen.findByText(/readonly-report/);
 v.rerender(h(SessionToolbox,{threadId:"ll",organization:organization("B")}));details=screen.getByText("Duration report").closest("details")!;expect(details.open).toBe(false);expect(screen.queryByText(/readonly-report/)).toBeNull();
 const moved={...org,people:org.people.map(p=>p.id==="ll"?{...p,departmentId:"Office"}:p)};v.rerender(h(SessionToolbox,{threadId:"ll",organization:moved}));expect(screen.getByText("Office only")).toBeVisible();
 v.rerender(h(SessionToolbox,{threadId:"ll",organization:{...moved,departmentAssetsState:{scope:"A",ready:true,error:"Refresh failed"}}}));expect(screen.getByRole("alert")).toHaveTextContent("Refresh failed");expect(screen.getByText("Office only")).toBeVisible();
});
it("adds one common keyboard tab without model/settings RPC, preserving preview/progress and close", async()=>{
 const call=vi.fn(async(method:string)=>{if(method!=="session.workspace.list")throw Error("Unexpected RPC");return {path:"",entries:[]};}),close=vi.fn();const props={client:{call},threadId:"ll",asset:null,assets:[],onSelectAsset:vi.fn(),onClose:close,toolbox:h(SessionToolbox,{threadId:"ll",organization:organization()}),taskProgress:h("p",null,"Current work")};
 const v=render(h(SessionWorkspace,props));await waitFor(()=>expect(call).toHaveBeenCalledTimes(1));fireEvent.click(screen.getByRole("tab",{name:"Toolbox"}));expect(screen.getByText("Duration report")).toBeVisible();fireEvent.keyDown(screen.getByRole("tablist"),{key:"ArrowRight"});expect(screen.getByRole("tab",{name:"Library"})).toHaveFocus();fireEvent.keyDown(screen.getByRole("tablist"),{key:"ArrowRight"});expect(screen.getByRole("tab",{name:"Task progress"})).toHaveFocus();expect(screen.getByText("Current work")).toBeVisible();
 v.rerender(h(SessionWorkspace,{...props,progressRequest:1}));expect(screen.getByRole("tab",{name:"Task progress"})).toHaveAttribute("aria-selected","true");
 fireEvent.click(screen.getByRole("button",{name:"Close workspace"}));expect(close).toHaveBeenCalledOnce();expect(call.mock.calls.every(([m])=>m==="session.workspace.list")).toBe(true);
});
it('shares the company catalog with two departments and CEO while keeping exact departmental content and read-only actions',()=>{const org={...organization(),companyTools:{core:{...tool,name:'Company ranking'}}};const v=render(h(SessionToolbox,{gateway:'A',threadId:'ll',organization:org}));expect(screen.getByText('Company ranking')).toBeVisible();expect(screen.getByText('Duration report')).toBeVisible();v.rerender(h(SessionToolbox,{gateway:'A',threadId:'office',organization:org}));expect(screen.getByText('Company ranking')).toBeVisible();expect(screen.getByText('Office only')).toBeVisible();expect(screen.queryByText('Duration report')).toBeNull();v.rerender(h(SessionToolbox,{gateway:'A',threadId:CEO_ID,organization:org}));expect(screen.getByText('Company ranking')).toBeVisible();expect(screen.queryByText('OW only')).toBeNull();expect(screen.queryByRole('button',{name:/Add|Edit|Run|Execute/})).toBeNull();v.rerender(h(SessionToolbox,{gateway:'B',threadId:CEO_ID,organization:org}));expect(screen.queryByText('Company ranking')).toBeNull();expect(screen.getByRole('status')).toBeVisible();});
