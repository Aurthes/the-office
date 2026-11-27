import { cleanup, renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useOfficeOrganization } from "@/features/office/hooks/useOfficeOrganization";
import { CEO_ID, OPEN_DEPARTMENT_ID, reconcileOrganization } from "@/lib/office/organization";
import { defaultStudioSettings, mergeStudioSettings, sanitizeStudioSettings, type StudioSettingsPatch } from "@/lib/studio/settings";
import { StudioSettingsCoordinator } from "@/lib/studio/coordinator";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const roster = { projects: [], members: [{ id: "firefighter", projectId: null }, { id: "ranger", projectId: null }] };
function fixture() {
  let settings = mergeStudioSettings(defaultStudioSettings(), { office: { gateway: { organization: reconcileOrganization({}, roster, { [OPEN_DEPARTMENT_ID]: "ranger" }) } } });
  const updateSettings = vi.fn(async (patch: StudioSettingsPatch) => { settings = mergeStudioSettings(settings, patch); return { settings: sanitizeStudioSettings(settings) }; });
  const fetchSettings = vi.fn(async () => ({ settings: sanitizeStudioSettings(settings) }));
  const coordinator = new StudioSettingsCoordinator({ updateSettings, fetchSettings });
  const props = { roster, names: new Map([["ranger", "Ranger"], ["firefighter", "Firefighter"]]), coordinator, gatewayUrl: "gateway", enabled: true };
  return { props, coordinator, updateSettings, fetchSettings };
}
it("persists one default CEO appearance and reuses it after remount without creating an agent", async () => {
  const f = fixture(), first = renderHook(() => useOfficeOrganization(f.props));
  await waitFor(() => expect(first.result.current.ceoAvatar?.seed).toBe(CEO_ID));
  const avatar = first.result.current.ceoAvatar;
  expect(first.result.current.people.find(person => person.id === "firefighter")?.reportsTo).toEqual(["ranger"]);
  expect(f.updateSettings).toHaveBeenCalledTimes(1);
  expect(f.updateSettings.mock.calls[0][0].avatars?.gateway?.[CEO_ID]).toEqual(avatar);
  first.unmount(); const second = renderHook(() => useOfficeOrganization(f.props));
  await waitFor(() => expect(second.result.current.ceoAvatar).toEqual(avatar));
  expect(f.updateSettings).toHaveBeenCalledTimes(1);
  expect(roster.members).toHaveLength(2); second.unmount(); f.coordinator.dispose();
});
it("assigns a new shared-space worker to Ranger and saves an edited title and multiple managers", async () => {
  const f = fixture(), hook = renderHook(props => useOfficeOrganization(props), { initialProps: f.props });
  await waitFor(() => expect(hook.result.current.ceoAvatar).not.toBeNull());
  hook.rerender({ ...f.props, roster: { projects: [], members: [...roster.members, { id: "new", projectId: null }] } });
  await waitFor(() => expect(hook.result.current.people.find(person => person.id === "new")?.reportsTo).toEqual(["ranger"]));
  await act(() => hook.result.current.savePosition("new", { title: "Engineer", reportsTo: ["ranger", CEO_ID] }));
  expect(hook.result.current.people.find(person => person.id === "new")).toMatchObject({ title: "Engineer", reportsTo: ["ranger", CEO_ID] });
  await expect(hook.result.current.savePosition("ranger", { title: "Head", reportsTo: ["firefighter"] })).rejects.toThrow("cycle");
  hook.unmount(); f.coordinator.dispose();
});
it("keeps the existing organization when a later settings read fails", async () => {
  const f = fixture(), hook = renderHook(() => useOfficeOrganization(f.props));
  await waitFor(() => expect(hook.result.current.ceoAvatar).not.toBeNull());
  const avatar = hook.result.current.ceoAvatar; vi.spyOn(console, "error").mockImplementation(() => {});
  f.fetchSettings.mockRejectedValueOnce(new Error("temporary failure"));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(hook.result.current.ceoAvatar).toEqual(avatar);
  expect(hook.result.current.people.find(person => person.id === "ranger")?.reportsTo).toEqual([CEO_ID]);
  expect(f.updateSettings).toHaveBeenCalledTimes(1);
  hook.unmount(); f.coordinator.dispose();
});
it("removes an archived manager's layer and persists it without repeatedly rewriting settings", async () => {
  const f = fixture(), hook = renderHook(props => useOfficeOrganization(props), { initialProps: f.props });
  await waitFor(() => expect(hook.result.current.ceoAvatar).not.toBeNull());
  hook.rerender({ ...f.props, roster: { projects: [], members: [{ id: "firefighter", projectId: null }] } });
  await waitFor(() => expect(hook.result.current.people.find(person => person.id === "firefighter")).toMatchObject({ title: "Worker", reportsTo: [CEO_ID] }));
  expect(f.updateSettings.mock.calls.at(-1)?.[0].office?.gateway?.organization?.ranger).toBeNull();
  const writes = f.updateSettings.mock.calls.length;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(f.updateSettings).toHaveBeenCalledTimes(writes);
  hook.unmount(); f.coordinator.dispose();
});
it("persists a restored Manager and its new reports together, then retains them after remount", async () => {
  const f = fixture(), hook = renderHook(props => useOfficeOrganization(props), { initialProps: f.props });
  await waitFor(() => expect(hook.result.current.ceoAvatar).not.toBeNull());
  const flatRoster = { projects: [], members: [{ id: "firefighter", projectId: null }, { id: "new-manager", projectId: null }] };
  hook.rerender({ ...f.props, roster: flatRoster });
  await waitFor(() => expect(hook.result.current.people.find(person => person.id === "new-manager")?.reportsTo).toEqual([CEO_ID]));
  await act(() => hook.result.current.savePosition("new-manager", { title: "Manager", reportsTo: [CEO_ID] }));
  const patch = f.updateSettings.mock.calls.at(-1)![0].office!.gateway!.organization!;
  expect(patch).toEqual({ "new-manager": { title: "Manager", reportsTo: [CEO_ID] }, firefighter: { title: "Worker", reportsTo: ["new-manager"] } });
  hook.unmount(); const next = renderHook(() => useOfficeOrganization({ ...f.props, roster: flatRoster }));
  await waitFor(() => expect(next.result.current.people.find(person => person.id === "firefighter")?.reportsTo).toEqual(["new-manager"]));
  const writes = f.updateSettings.mock.calls.length;
  await act(async () => window.dispatchEvent(new Event("focus"))); expect(f.updateSettings).toHaveBeenCalledTimes(writes);
  next.unmount(); f.coordinator.dispose();
});


it("saves department assets through the real coordinator, preserves siblings and reloads on a new member view", async () => {
  const f=fixture(), hook=renderHook(()=>useOfficeOrganization(f.props));
  await waitFor(()=>expect(hook.result.current.departments?.length).toBeGreaterThan(0));
  const asset={kind:"workflow" as const,name:"Existing workflow",summary:"When needed",instructions:"Read only",source:"inline",version:"1",status:"active" as const};
  await act(async()=>{await hook.result.current.saveDepartmentAsset!(OPEN_DEPARTMENT_ID,"one",asset);});
  await act(async()=>{await hook.result.current.saveDepartmentAsset!(OPEN_DEPARTMENT_ID,"two",{...asset,name:"Other"});});
  expect(hook.result.current.departmentAssets?.[OPEN_DEPARTMENT_ID]).toEqual({one:asset,two:{...asset,name:"Other"}});
  expect(f.updateSettings).toHaveBeenLastCalledWith({office:{gateway:{departmentAssets:{[OPEN_DEPARTMENT_ID]:{two:{...asset,name:"Other"}}}}}});
  hook.unmount();const next=renderHook(()=>useOfficeOrganization(f.props));
  await waitFor(()=>expect(next.result.current.departmentAssets?.[OPEN_DEPARTMENT_ID]?.one).toEqual(asset));
});

function deferred<T>() { let resolve!: (value:T)=>void, reject!: (error:Error)=>void; const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; }
it("scopes assets immediately on gateway switch and ignores old successful or failed reads", async()=>{
 const f=fixture();const reads=[deferred<ReturnType<typeof sanitizeStudioSettings>>(),deferred<ReturnType<typeof sanitizeStudioSettings>>()];let i=0;
 const fake={loadSettings:vi.fn(()=>reads[i++].promise),applyPatchNow:vi.fn(async()=>{})} as unknown as StudioSettingsCoordinator;
 const hook=renderHook(props=>useOfficeOrganization(props),{initialProps:{...f.props,coordinator:fake}});
 expect(hook.result.current.departmentAssetsState).toMatchObject({ready:false,scope:"gateway"});
 hook.rerender({...f.props,coordinator:fake,gatewayUrl:"other"});expect(hook.result.current.departmentAssets).toEqual({});expect(hook.result.current.departmentAssetsState).toMatchObject({ready:false,scope:"other"});
 const asset={kind:"tool" as const,name:"B tool",summary:"B",instructions:"B",source:"B",version:"1",status:"active" as const};
 await act(async()=>reads[1].resolve(sanitizeStudioSettings(mergeStudioSettings(defaultStudioSettings(),{office:{other:{departmentAssets:{[OPEN_DEPARTMENT_ID]:{b:asset}}}}}))));
 await waitFor(()=>expect(hook.result.current.departmentAssetsState?.ready).toBe(true));
 await act(async()=>reads[0].resolve(sanitizeStudioSettings(mergeStudioSettings(defaultStudioSettings(),{office:{gateway:{departmentAssets:{[OPEN_DEPARTMENT_ID]:{a:{...asset,name:"OLD"}}}}}}))));
 expect(hook.result.current.departmentAssets?.[OPEN_DEPARTMENT_ID]).toEqual({b:asset});
 hook.unmount();f.coordinator.dispose();
});
it("reports asset read failure instead of an empty registry, keeps same-scope data on refresh failure",async()=>{
 const f=fixture();vi.spyOn(console,"error").mockImplementation(()=>{});f.fetchSettings.mockRejectedValueOnce(new Error("offline"));
 const hook=renderHook(()=>useOfficeOrganization(f.props));await waitFor(()=>expect(hook.result.current.departmentAssetsState?.error).toBeTruthy());expect(hook.result.current.departmentAssetsState?.ready).toBe(false);
 await act(async()=>window.dispatchEvent(new Event("focus")));await waitFor(()=>expect(hook.result.current.departmentAssetsState?.ready).toBe(true));
 f.fetchSettings.mockRejectedValueOnce(new Error("offline"));await act(async()=>window.dispatchEvent(new Event("focus")));await waitFor(()=>expect(hook.result.current.departmentAssetsState?.error).toBeTruthy());expect(hook.result.current.departmentAssetsState?.ready).toBe(true);
 hook.unmount();f.coordinator.dispose();
});
it("does not leak an old gateway save acknowledgement into the new asset snapshot",async()=>{
 const f=fixture(),save=deferred<void>();
 const hook=renderHook(props=>useOfficeOrganization(props),{initialProps:f.props});await waitFor(()=>expect(hook.result.current.departmentAssetsState?.ready).toBe(true));
 vi.spyOn(f.coordinator,"applyPatchNow").mockImplementationOnce(()=>save.promise as ReturnType<StudioSettingsCoordinator["applyPatchNow"]>);
 const asset={kind:"tool" as const,name:"Old save",summary:"s",instructions:"i",source:"s",version:"1",status:"active" as const};let pending!:Promise<void>;
 act(()=>{pending=hook.result.current.saveDepartmentAsset!(OPEN_DEPARTMENT_ID,"old",asset);});
 hook.rerender({...f.props,gatewayUrl:"new"});await waitFor(()=>expect(hook.result.current.departmentAssetsState).toMatchObject({scope:"new",ready:true}));
 await act(async()=>{save.resolve();await pending;});expect(hook.result.current.departmentAssets).toEqual({});
 hook.rerender({...f.props,enabled:false});expect(hook.result.current.departmentAssets).toEqual({});expect(hook.result.current.departmentAssetsState?.scope).toBe("");hook.unmount();f.coordinator.dispose();
});
it("keeps both same-scope save acknowledgements while rejecting a save from a previous visit to that gateway",async()=>{
 const f=fixture(),hook=renderHook(props=>useOfficeOrganization(props),{initialProps:f.props});await waitFor(()=>expect(hook.result.current.departmentAssetsState?.ready).toBe(true));
 const a=deferred<void>(),b=deferred<void>();vi.spyOn(f.coordinator,"applyPatchNow").mockImplementationOnce(()=>a.promise).mockImplementationOnce(()=>b.promise);
 const asset={kind:"tool" as const,name:"Tool",summary:"s",instructions:"i",source:"s",version:"1",status:"active" as const};let pa!:Promise<void>,pb!:Promise<void>;
 act(()=>{pa=hook.result.current.saveDepartmentAsset!(OPEN_DEPARTMENT_ID,"a",asset);pb=hook.result.current.saveDepartmentAsset!(OPEN_DEPARTMENT_ID,"b",asset);});
 await act(async()=>{a.resolve();await pa;b.resolve();await pb;});expect(Object.keys(hook.result.current.departmentAssets![OPEN_DEPARTMENT_ID]).sort()).toEqual(["a","b"]);
 const stale=deferred<void>();vi.spyOn(f.coordinator,"applyPatchNow").mockImplementationOnce(()=>stale.promise);let pending!:Promise<void>;act(()=>{pending=hook.result.current.saveDepartmentAsset!(OPEN_DEPARTMENT_ID,"stale",asset);});
 hook.rerender({...f.props,gatewayUrl:"other"});await waitFor(()=>expect(hook.result.current.departmentAssetsState).toMatchObject({scope:"other",ready:true}));
 hook.rerender(f.props);await waitFor(()=>expect(hook.result.current.departmentAssetsState).toMatchObject({scope:"gateway",ready:true}));
 await act(async()=>{stale.resolve();await pending;});expect(hook.result.current.departmentAssets?.[OPEN_DEPARTMENT_ID]?.stale).toBeUndefined();hook.unmount();f.coordinator.dispose();
});
it('persists company tools in the same scoped load and hides them immediately across Office switches',async()=>{const tool={kind:'tool' as const,name:'Core',summary:'Offline',instructions:'ranking-report',source:'inline',version:'1',status:'active' as const};const f=fixture();const hook=renderHook(props=>useOfficeOrganization(props),{initialProps:f.props});await waitFor(()=>expect(hook.result.current.departmentAssetsState?.ready).toBe(true));await act(async()=>{await hook.result.current.saveCompanyTool!('core',tool);});expect(hook.result.current.companyTools).toEqual({core:tool});expect(f.updateSettings).toHaveBeenLastCalledWith({office:{gateway:{companyTools:{core:tool}}}});hook.rerender({...f.props,gatewayUrl:'other'});expect(hook.result.current.companyTools).toEqual({});await waitFor(()=>expect(hook.result.current.departmentAssetsState).toMatchObject({scope:'other',ready:true}));expect(hook.result.current.companyTools).toEqual({});hook.unmount();f.coordinator.dispose();});
