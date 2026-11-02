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
it("persists one randomized CEO appearance and reuses it after remount without creating an agent", async () => {
  const f = fixture(), first = renderHook(() => useOfficeOrganization(f.props));
  await waitFor(() => expect(first.result.current.ceoAvatar?.duck).toBeDefined());
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
it("replaces an archived head and persists the removal without repeatedly rewriting settings", async () => {
  const f = fixture(), hook = renderHook(props => useOfficeOrganization(props), { initialProps: f.props });
  await waitFor(() => expect(hook.result.current.ceoAvatar).not.toBeNull());
  hook.rerender({ ...f.props, roster: { projects: [], members: [{ id: "firefighter", projectId: null }] } });
  await waitFor(() => expect(hook.result.current.people.find(person => person.id === "firefighter")?.title).toBe("Head"));
  expect(f.updateSettings.mock.calls.at(-1)?.[0].office?.gateway?.organization?.ranger).toBeNull();
  const writes = f.updateSettings.mock.calls.length;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(f.updateSettings).toHaveBeenCalledTimes(writes);
  hook.unmount(); f.coordinator.dispose();
});
