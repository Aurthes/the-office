import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAgentInterfaces } from "@/features/office/hooks/useAgentInterfaces";
import { normalizeAgentInterfaces, mergeAgentInterfaces, resolveAgentInterface, resolveTeaserTarget } from "@/lib/office/agent-interface";
import { defaultStudioSettings, mergeStudioSettings, normalizeStudioSettings, sanitizeStudioSettings } from "@/lib/studio/settings";
import { StudioSettingsCoordinator } from "@/lib/studio/coordinator";
const a = "00000000-0000-4000-8000-000000000001", b = "00000000-0000-4000-8000-000000000002", gateway = "ws://fixture";
afterEach(cleanup);
it("uses finite UUID-bound presets and fails closed on arbitrary code, names, and unknown profiles", () => {
  expect(normalizeAgentInterfaces({ [a]: "teaser", [b]: "javascript:alert(1)", teaser: "teaser", constructor: "teaser" })).toEqual({ [a]: "teaser" });
  expect(resolveAgentInterface("arbitrary").capabilities).toEqual([]); expect(resolveAgentInterface("teaser").capabilities).toEqual(["teaser-board"]);
  expect(mergeAgentInterfaces({ [a]: "teaser", [b]: "teaser" }, { [a]: null })).toEqual({ [b]: "teaser" });
  expect(mergeAgentInterfaces({ [a]: "teaser" }, { [a]: "invalid" })).toEqual({});
});
it("resolves only a unique configured active identity; renames and duplicate names do not drift", () => {
  const roster = [{ id: a, name: "Renamed employee", status: "idle" }, { id: b, name: "teaser", status: "idle" }];
  expect(resolveTeaserTarget(roster, { [a]: "teaser" }, true).target?.id).toBe(a);
  expect(resolveTeaserTarget(roster.map(x => ({ ...x, name: "teaser" })), { [a]: "teaser" }, true).target?.id).toBe(a);
  expect(resolveTeaserTarget(roster, {}, true).target).toBeNull(); expect(resolveTeaserTarget(roster, { [a]: "teaser", [b]: "teaser" }, true).target).toBeNull();
  expect(resolveTeaserTarget(roster.slice(1), { [a]: "teaser" }, true).target).toBeNull(); expect(resolveTeaserTarget([{ ...roster[0], archived: true }], { [a]: "teaser" }, true).target).toBeNull();
  expect(resolveTeaserTarget(roster, { [a]: "teaser" }, false).target).toBeNull();
});
it("normalizes and sanitizes preferences, patches just one agent and preserves company data", () => {
  const first = mergeStudioSettings(defaultStudioSettings(), { office: { [gateway]: { companyName: "Keep company", agentInterfaces: { [a]: "teaser" } } } });
  const next = mergeStudioSettings(first, { office: { [gateway]: { agentInterfaces: { [b]: "teaser" } } } });
  expect(next.office[gateway].agentInterfaces).toEqual({ [a]: "teaser", [b]: "teaser" }); expect(next.office[gateway].companyName).toBe("Keep company");
  expect(sanitizeStudioSettings(normalizeStudioSettings(next)).office[gateway].agentInterfaces).toEqual({ [a]: "teaser", [b]: "teaser" });
  expect(mergeStudioSettings(next, { office: { [gateway]: { agentInterfaces: { [a]: null } } } }).office[gateway].agentInterfaces).toEqual({ [b]: "teaser" });
});
it("coalesces per-agent edits and deletions without dropping other pending Office fields", async () => {
  let stored = defaultStudioSettings();
  const updateSettings = vi.fn(async patch => { stored = mergeStudioSettings(stored, patch); return { settings: sanitizeStudioSettings(stored) }; });
  const coordinator = new StudioSettingsCoordinator({ fetchSettings: async () => ({ settings: sanitizeStudioSettings(stored) }), updateSettings });
  coordinator.schedulePatch({ office: { [gateway]: { companyName: "Company", agentInterfaces: { [a]: "teaser" } } } }, 10000);
  coordinator.schedulePatch({ office: { [gateway]: { agentInterfaces: { [b]: "teaser" } } } }, 10000);
  await coordinator.applyPatchNow({ office: { [gateway]: { agentInterfaces: { [a]: null } } } });
  expect(updateSettings).toHaveBeenCalledOnce(); expect(stored.office[gateway].agentInterfaces).toEqual({ [b]: "teaser" }); expect(stored.office[gateway].companyName).toBe("Company"); coordinator.dispose();
});
it("enables a preset only after persisted confirmation, and a stale save cannot change another gateway's view", async () => {
  let stored = defaultStudioSettings(), release!: () => void;
  let gate = new Promise<void>(resolve => { release = resolve; });
  const updateSettings = vi.fn(async patch => { await gate; stored = mergeStudioSettings(stored, patch); return { settings: sanitizeStudioSettings(stored) }; });
  const coordinator = new StudioSettingsCoordinator({ fetchSettings: async () => ({ settings: sanitizeStudioSettings(stored) }), updateSettings });
  const view = renderHook(({ url }) => useAgentInterfaces(coordinator, url, true), { initialProps: { url: gateway } });
  await waitFor(() => expect(view.result.current.loaded).toBe(true));
  let pending!: Promise<void>;
  act(() => { pending = view.result.current.save(a, "teaser"); });
  await waitFor(() => expect(updateSettings).toHaveBeenCalledOnce()); expect(view.result.current.interfaces).toEqual({});
  await act(async () => { release(); await pending; }); expect(view.result.current.interfaces).toEqual({ [a]: "teaser" });
  gate = new Promise<void>(resolve => { release = resolve; });
  act(() => { pending = view.result.current.save(b, "teaser"); });
  await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(2));
  view.rerender({ url: "ws://other-gateway" }); await waitFor(() => expect(view.result.current.loaded).toBe(true));
  await act(async () => { release(); await expect(pending).rejects.toThrow("not confirmed"); });
  expect(view.result.current.interfaces).toEqual({}); view.unmount(); coordinator.dispose();
});
it.each(["failed", "unconfirmed"])("keeps capabilities unchanged after a %s preset save", async mode => {
  const settings = sanitizeStudioSettings(defaultStudioSettings());
  const coordinator = new StudioSettingsCoordinator({ fetchSettings: async () => ({ settings }), updateSettings: async () => {
    if (mode === "failed") throw Error("offline"); return { settings };
  } });
  const view = renderHook(() => useAgentInterfaces(coordinator, gateway, true)); await waitFor(() => expect(view.result.current.loaded).toBe(true));
  await act(async () => { await expect(view.result.current.save(a, "teaser")).rejects.toThrow(); }); expect(view.result.current.interfaces).toEqual({});
  view.unmount(); coordinator.dispose();
});
