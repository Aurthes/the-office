import type { AgentAvatarProfile } from "@/lib/avatars/profile";
import { resolveAgentAvatarProfile, resolveOfficePreferencePublic, type StudioSettingsPatch, type StudioSettingsPublic } from "@/lib/studio/settings";

// Copy agent-owned preferences only. Department membership and native settings
// are inherited by session.fork; schedules are intentionally not duplicated.
export function cloneAgentPreferences(settings: StudioSettingsPublic, gatewayUrl: string, sourceId: string, cloneId: string, fallbackAvatar?: AgentAvatarProfile | null): StudioSettingsPatch {
  const avatar = resolveAgentAvatarProfile(settings, gatewayUrl, sourceId) || fallbackAvatar;
  const position = resolveOfficePreferencePublic(settings, gatewayUrl).organization?.[sourceId];
  return {
    ...(avatar ? { avatars: { [gatewayUrl]: { [cloneId]: structuredClone(avatar) } } } : {}),
    ...(position ? { office: { [gatewayUrl]: { organization: { [cloneId]: { title: position.title, reportsTo: [...position.reportsTo] } } } } } : {}),
  };
}
