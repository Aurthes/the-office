"use client";
import { normalizeDepartmentAssets, mergeDepartmentAssets, type DepartmentAssets, type DepartmentAsset } from "@/lib/office/department-assets";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CompanyRoster } from "@/features/retro-office/core/companyLayout";
import { CEO_ID, OPEN_DEPARTMENT_ID, organizationPatch, organizationPeople, reconcileOrganization, updateOrganizationPosition, type OfficeOrganization, type OfficePosition, type OrganizationView } from "@/lib/office/organization";
import { createDefaultAgentAvatarProfile, type AgentAvatarProfile } from "@/lib/avatars/profile";
import { resolveAgentAvatarProfile, resolveOfficePreferencePublic } from "@/lib/studio/settings";
import type { StudioSettingsCoordinator } from "@/lib/studio/coordinator";
import { mergeDepartmentDescriptions, organizationDepartments, type DepartmentDescriptions } from "@/lib/office/departments";

export function useOfficeOrganization({ roster, names, coordinator, gatewayUrl, enabled }: {
  roster: CompanyRoster | null; names: ReadonlyMap<string, string>; coordinator: StudioSettingsCoordinator; gatewayUrl: string; enabled: boolean;
}): OrganizationView {
  const [positions, setPositions] = useState<OfficeOrganization>({});
  const [departmentAssets, setDepartmentAssets] = useState<DepartmentAssets>({});
  const [descriptions, setDescriptions] = useState<DepartmentDescriptions>({});
  const generation = useRef(0);
  const [ceoAvatar, setCeoAvatar] = useState<AgentAvatarProfile | null>(null);
  useEffect(() => {
    if (!enabled || !roster || !gatewayUrl.trim()) return;
    let stopped = false;
    const load = async () => {
      const request = ++generation.current;
      try {
        const settings = await coordinator.loadSettings({ force: true });
        if (!settings || stopped) return;
        const preference = resolveOfficePreferencePublic(settings, gatewayUrl);
        const saved = preference.organization || {};
        const organization = reconcileOrganization(saved, roster);
        const savedAvatar = resolveAgentAvatarProfile(settings, gatewayUrl, CEO_ID);
        const avatar = savedAvatar || createDefaultAgentAvatarProfile(CEO_ID);
        const patch = organizationPatch(saved, organization), changed = Object.keys(patch).length > 0;
        if (changed || !savedAvatar) await coordinator.applyPatchNow({
          ...(changed ? { office: { [gatewayUrl]: { organization: patch } } } : {}),
          ...(!savedAvatar ? { avatars: { [gatewayUrl]: { [CEO_ID]: avatar } } } : {}),
        });
        if (!stopped && request === generation.current) { setPositions(organization); setCeoAvatar(avatar); setDescriptions(preference.departmentDescriptions || {}); setDepartmentAssets(normalizeDepartmentAssets(preference.departmentAssets)); }
      } catch (error) { console.error("Could not load the Office organization.", error); }
    };
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    void load(); window.addEventListener("focus", visible);
    return () => { stopped = true; window.removeEventListener("focus", visible); };
  }, [roster, coordinator, gatewayUrl, enabled]);
  const savePosition = useCallback(async (id: string, position: OfficePosition) => {
    generation.current++;
    if (!roster || !enabled) throw new Error("Connection unavailable. Please reconnect before saving.");
    const settings = await coordinator.loadSettings({ force: true });
    if (!settings) throw new Error("Connection unavailable. Please reconnect before saving.");
    const current = resolveOfficePreferencePublic(settings, gatewayUrl).organization || {};
    const next = updateOrganizationPosition(current, roster, id, position), patch = organizationPatch(current, next);
    if (Object.keys(patch).length) await coordinator.applyPatchNow({ office: { [gatewayUrl]: { organization: patch } } });
    generation.current++; setPositions(next);
  }, [roster, coordinator, gatewayUrl, enabled]);
  const saveDepartmentDescription = useCallback(async (id: string, description: string) => {
    if (!roster || !enabled || !gatewayUrl.trim()) throw new Error("Connection unavailable. Please reconnect before saving.");
    if (id !== OPEN_DEPARTMENT_ID && !roster.projects.some(project => project.id === id)) throw new Error("Department unavailable.");
    mergeDepartmentDescriptions({}, { [id]: description });
    generation.current++;
    await coordinator.applyPatchNow({ office: { [gatewayUrl]: { departmentDescriptions: { [id]: description } } } });
    const settings = await coordinator.loadSettings();
    generation.current++;
    setDescriptions(previous => settings ? resolveOfficePreferencePublic(settings, gatewayUrl).departmentDescriptions || {} : mergeDepartmentDescriptions(previous, { [id]: description }));
  }, [roster, coordinator, gatewayUrl, enabled]);
  const saveDepartmentAsset = useCallback(async (departmentId: string, assetId: string, entry: DepartmentAsset) => {
    if (!roster || !enabled || !gatewayUrl.trim()) throw new Error("Connection unavailable. Please reconnect before saving.");
    if (departmentId !== OPEN_DEPARTMENT_ID && !roster.projects.some(project => project.id === departmentId)) throw new Error("Department unavailable.");
    generation.current++;
    await coordinator.applyPatchNow({ office: { [gatewayUrl]: { departmentAssets: { [departmentId]: { [assetId]: entry } } } } });
    generation.current++;
    setDepartmentAssets(previous => mergeDepartmentAssets(previous, { [departmentId]: { [assetId]: entry } }));
  }, [roster, coordinator, gatewayUrl, enabled]);
  const people = useMemo(() => roster ? organizationPeople(positions, roster, names) : [], [positions, roster, names]);
  const departments = useMemo(() => organizationDepartments(roster?.projects || [], people, descriptions), [roster, people, descriptions]);
  return { people, ceoAvatar, savePosition, departments, saveDepartmentDescription, departmentAssets, saveDepartmentAsset };
}
