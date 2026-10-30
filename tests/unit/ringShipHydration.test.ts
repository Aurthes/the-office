import { afterEach, expect, it } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type { CompanyRoster } from "@/features/retro-office/core/companyLayout";
import { buildShipLayout } from "@/features/ring-ship/layout";
import { useShipLayout } from "@/features/ring-ship/useShipLayout";

afterEach(() => { cleanup(); localStorage.clear(); });
it("preserves a saved cabin while startup metadata is unknown, then hydrates into it", () => {
  const roster: CompanyRoster = { projects: [{ id: "p", name: "Project" }], members: [{ id: "agent", projectId: "p" }] };
  const layout = buildShipLayout(roster), key = "ship-test";
  const spare = layout.cabins.find(c => c.ring === 0 && c.kind === "reserve")!;
  layout.allocation.projects.p.slot = spare.slot;
  const saved = JSON.stringify(layout.allocation); localStorage.setItem(key, saved);
  const hook = renderHook(({ value }: { value: CompanyRoster | null }) => useShipLayout(value, key), { initialProps: { value: null as CompanyRoster | null } });
  expect(localStorage.getItem(key)).toBe(saved);
  hook.rerender({ value: roster });
  expect(hook.result.current.allocation.projects.p.slot).toBe(spare.slot);
  hook.rerender({ value: null });
  expect(JSON.parse(localStorage.getItem(key)!).projects.p.slot).toBe(spare.slot);
  hook.rerender({ value: roster });
  expect(hook.result.current.allocation.projects.p.slot).toBe(spare.slot);
});
it("releases removed projects only for an authoritative empty roster", () => {
  const roster: CompanyRoster = { projects: [{ id: "p", name: "Project" }], members: [] };
  const hook = renderHook(({ value }) => useShipLayout(value, "ship-test"), { initialProps: { value: roster } });
  const before = hook.result.current.allocation.sectors;
  hook.rerender({ value: { projects: [], members: [] } });
  expect(hook.result.current.allocation.projects.p).toBeUndefined();
  expect(hook.result.current.allocation.sectors).toBe(before);
});
