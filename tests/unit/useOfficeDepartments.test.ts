import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useOfficeOrganization } from "@/features/office/hooks/useOfficeOrganization";
import { CEO_ID } from "@/lib/office/organization";
import { createDefaultAgentAvatarProfile } from "@/lib/avatars/profile";
import { defaultStudioSettings, mergeStudioSettings, sanitizeStudioSettings, type StudioSettingsPatch } from "@/lib/studio/settings";
import { StudioSettingsCoordinator } from "@/lib/studio/coordinator";

afterEach(cleanup);
it("persists only one responsibility and refreshes current members and roles without changing another department", async () => {
  const gatewayUrl = "ws://office", roster = { projects: [{ id: "a", name: "First" }, { id: "b", name: "Second" }], members: [{ id: "head", projectId: "a" }, { id: "worker", projectId: "a" }] };
  let settings = mergeStudioSettings(defaultStudioSettings(), {
    office: { [gatewayUrl]: { organization: { [CEO_ID]: { title: "CEO", reportsTo: [] }, head: { title: "Head", reportsTo: [CEO_ID] }, worker: { title: "Worker", reportsTo: ["head"] } }, departmentDescriptions: { a: "First scope", b: "Keep this" } } },
    avatars: { [gatewayUrl]: { [CEO_ID]: createDefaultAgentAvatarProfile(CEO_ID) } },
  });
  const update = vi.fn(async (patch: StudioSettingsPatch) => { settings = mergeStudioSettings(settings, patch); return { settings: sanitizeStudioSettings(settings) }; });
  const coordinator = new StudioSettingsCoordinator({ fetchSettings: async () => ({ settings: sanitizeStudioSettings(settings) }), updateSettings: update });
  const names = new Map([["head", "Leader"], ["worker", "Builder"]]);
  const { result, rerender } = renderHook(({ value }) => useOfficeOrganization({ roster: value, names, coordinator, gatewayUrl, enabled: true }), { initialProps: { value: roster } });
  await waitFor(() => expect(result.current.departments?.[0].description).toBe("First scope"));
  await act(() => result.current.saveDepartmentDescription!("a", "New scope"));
  expect(update).toHaveBeenLastCalledWith({ office: { [gatewayUrl]: { departmentDescriptions: { a: "New scope" } } } });
  expect(result.current.departments?.[1].description).toBe("Keep this");
  expect(result.current.departments?.[0].description).toBe("New scope");
  await act(() => result.current.savePosition("worker", { title: "Engineer", reportsTo: ["head"] }));
  expect(result.current.departments?.[0].members.find(p => p.id === "worker")?.title).toBe("Engineer");
  await act(() => result.current.saveDepartmentDescription!("a", ""));
  expect(result.current.departments?.[0].description).toBe("");
  expect(settings.office[gatewayUrl].departmentDescriptions).toEqual({ b: "Keep this" });
  rerender({ value: { ...roster, members: [{ id: "worker", projectId: "a" }] } });
  await waitFor(() => expect(result.current.departments?.[0].heads).toEqual([]));
  expect(result.current.departments?.[0].members).toHaveLength(1);
  expect(result.current.departments?.[1].members).toEqual([]);
  coordinator.dispose();
});
