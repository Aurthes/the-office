"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CompanyRoster } from "@/features/retro-office/core/companyLayout";
import { CEO_ID, organizationPatch, organizationPeople, reconcileOrganization, updateOrganizationPosition, type OfficeOrganization, type OfficePosition, type OrganizationView } from "@/lib/office/organization";
import { createDefaultAgentAvatarProfile, type AgentAvatarProfile } from "@/lib/avatars/profile";
import { createDuckAppearanceFromSeed } from "@/lib/avatars/duck";
import { resolveAgentAvatarProfile, resolveOfficePreferencePublic } from "@/lib/studio/settings";
import type { StudioSettingsCoordinator } from "@/lib/studio/coordinator";
import { randomUUID } from "@/lib/uuid";

export function useOfficeOrganization({ roster, names, coordinator, gatewayUrl, enabled }: {
  roster: CompanyRoster | null; names: ReadonlyMap<string, string>; coordinator: StudioSettingsCoordinator; gatewayUrl: string; enabled: boolean;
}): OrganizationView {
  const [positions, setPositions] = useState<OfficeOrganization>({});
  const [ceoAvatar, setCeoAvatar] = useState<AgentAvatarProfile | null>(null);
  useEffect(() => {
    if (!enabled || !roster || !gatewayUrl.trim()) return;
    let stopped = false;
    const load = async () => {
      try {
        const settings = await coordinator.loadSettings({ force: true });
        if (!settings || stopped) return;
        const saved = resolveOfficePreferencePublic(settings, gatewayUrl).organization || {};
        const organization = reconcileOrganization(saved, roster);
        const savedAvatar = resolveAgentAvatarProfile(settings, gatewayUrl, CEO_ID);
        const avatar = savedAvatar || { ...createDefaultAgentAvatarProfile(CEO_ID), duck: createDuckAppearanceFromSeed(randomUUID()) };
        const patch = organizationPatch(saved, organization), changed = Object.keys(patch).length > 0;
        if (changed || !savedAvatar) await coordinator.applyPatchNow({
          ...(changed ? { office: { [gatewayUrl]: { organization: patch } } } : {}),
          ...(!savedAvatar ? { avatars: { [gatewayUrl]: { [CEO_ID]: avatar } } } : {}),
        });
        if (!stopped) { setPositions(organization); setCeoAvatar(avatar); }
      } catch (error) { console.error("Could not load the Office organization.", error); }
    };
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    void load(); window.addEventListener("focus", visible);
    return () => { stopped = true; window.removeEventListener("focus", visible); };
  }, [roster, coordinator, gatewayUrl, enabled]);
  const savePosition = useCallback(async (id: string, position: OfficePosition) => {
    if (!roster || !enabled) throw new Error("Connection unavailable. Please reconnect before saving.");
    const settings = await coordinator.loadSettings({ force: true });
    if (!settings) throw new Error("Connection unavailable. Please reconnect before saving.");
    const current = resolveOfficePreferencePublic(settings, gatewayUrl).organization || {};
    const next = updateOrganizationPosition(current, roster, id, position), patch = organizationPatch(current, next);
    if (Object.keys(patch).length) await coordinator.applyPatchNow({ office: { [gatewayUrl]: { organization: patch } } });
    setPositions(next);
  }, [roster, coordinator, gatewayUrl, enabled]);
  const people = useMemo(() => roster ? organizationPeople(positions, roster, names) : [], [positions, roster, names]);
  return { people, ceoAvatar, savePosition };
}
