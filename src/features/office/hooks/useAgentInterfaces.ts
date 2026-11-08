"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { resolveOfficePreferencePublic } from "@/lib/studio/settings";
import type { StudioSettingsCoordinator } from "@/lib/studio/coordinator";
import { normalizeAgentInterfaces, type AgentInterfaces, type AgentInterfacePreset } from "@/lib/office/agent-interface";

export function useAgentInterfaces(coordinator: StudioSettingsCoordinator, gateway: string, enabled: boolean) {
  const [saved, setSaved] = useState<{ gateway: string; interfaces: AgentInterfaces } | null>(null);
  const generation = useRef(0);
  const owner = useRef(gateway);
  useLayoutEffect(() => { owner.current = gateway; }, [gateway]);
  useEffect(() => {
    if (!enabled || !gateway.trim()) return;
    let stopped = false;
    const load = async () => {
      const request = ++generation.current;
      try {
        const settings = await coordinator.loadSettings({ force: true });
        if (!stopped && request === generation.current) setSaved(settings ? { gateway, interfaces: normalizeAgentInterfaces(resolveOfficePreferencePublic(settings, gateway).agentInterfaces) } : null);
      } catch { if (!stopped && request === generation.current) setSaved(null); }
    };
    void load(); window.addEventListener("focus", load);
    return () => { stopped = true; window.removeEventListener("focus", load); };
  }, [coordinator, gateway, enabled]);
  const save = useCallback(async (id: string, preset: AgentInterfacePreset) => {
    if (!enabled || !gateway.trim() || !["standard", "teaser"].includes(preset)) throw Error("Interface settings are unavailable.");
    generation.current++;
    await coordinator.applyPatchNow({ office: { [gateway.trim()]: { agentInterfaces: { [id]: preset === "standard" ? null : preset } } } });
    const settings = await coordinator.loadSettings();
    if (owner.current !== gateway || !settings) throw Error("Interface preset was not confirmed. Please reload settings.");
    const interfaces = normalizeAgentInterfaces(resolveOfficePreferencePublic(settings, gateway).agentInterfaces);
    if ((interfaces[id] || "standard") !== preset) throw Error("Interface preset was not confirmed. Please reload settings.");
    generation.current++; setSaved({ gateway, interfaces });
  }, [coordinator, enabled, gateway]);
  return { loaded: enabled && saved?.gateway === gateway, interfaces: enabled && saved?.gateway === gateway ? saved.interfaces : {}, save };
}
