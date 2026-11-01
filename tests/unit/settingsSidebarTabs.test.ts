import { describe, expect, it } from "vitest";
import { resolveSettingsSidebarEntries } from "@/features/agents/operations/settingsSidebarTabs";
describe("settings navigation", () => {
  it("shows only the supported agent settings", () => {
    expect(resolveSettingsSidebarEntries().map(entry => entry.id)).toEqual(["personality", "capabilities", "advanced"]);
  });
});
