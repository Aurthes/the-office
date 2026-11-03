import { createDefaultAgentAvatarProfile } from "@/lib/avatars/profile";
import { createDuckAppearanceFromSeed } from "@/lib/avatars/duck";
import { resolveOfficePreferencePublic, type StudioSettingsPatch, type StudioSettingsPublic } from "@/lib/studio/settings";

// Copy agent-owned preferences only. Department membership and native settings
// are inherited by session.fork; schedules are intentionally not duplicated.
export function cloneAgentPreferences(settings: StudioSettingsPublic, gatewayUrl: string, sourceId: string, cloneId: string): StudioSettingsPatch {
  const avatar = { ...createDefaultAgentAvatarProfile(cloneId), duck: createDuckAppearanceFromSeed(cloneId) };
  const position = resolveOfficePreferencePublic(settings, gatewayUrl).organization?.[sourceId];
  return {
    avatars: { [gatewayUrl]: { [cloneId]: avatar } },
    ...(position ? { office: { [gatewayUrl]: { organization: { [cloneId]: { title: position.title, reportsTo: [...position.reportsTo] } } } } } : {}),
  };
}
