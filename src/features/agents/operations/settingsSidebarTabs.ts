import type { SettingsRouteTab } from "@/features/agents/operations/settingsRouteWorkflow";

export type SettingsSidebarEntry = {
  id: SettingsRouteTab;
  label: string;
};

const BASE_SETTINGS_SIDEBAR_ENTRIES: readonly SettingsSidebarEntry[] = [
  { id: "personality", label: "Behavior" },
  { id: "capabilities", label: "Capabilities" },
  { id: "advanced", label: "Advanced" },
];

export const resolveSettingsSidebarEntries = () => BASE_SETTINGS_SIDEBAR_ENTRIES;
