"use client";

import { useCallback, useEffect, useState } from "react";
import type { StudioSettingsCoordinator } from "@/lib/studio/coordinator";
import {
  defaultStudioOfficePreferencePublic,
  resolveOfficePreferencePublic,
  type StudioOfficePreferencePublic,
} from "@/lib/studio/settings";

type UseStudioOfficePreferenceParams = {
  gatewayUrl: string;
  settingsCoordinator: StudioSettingsCoordinator;
};

export const useStudioOfficePreference = ({
  gatewayUrl,
  settingsCoordinator,
}: UseStudioOfficePreferenceParams) => {
  const [preference, setPreference] = useState<StudioOfficePreferencePublic>(
    defaultStudioOfficePreferencePublic()
  );
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const gatewayKey = gatewayUrl.trim();
    if (!gatewayKey) {
      setPreference(defaultStudioOfficePreferencePublic());
      setLoaded(true);
      return;
    }
    setLoaded(false);
    const loadPreference = async () => {
      try {
        const settings = await settingsCoordinator.loadSettings({ maxAgeMs: 30_000 });
        if (cancelled) return;
        setPreference(
          settings
            ? resolveOfficePreferencePublic(settings, gatewayKey)
            : defaultStudioOfficePreferencePublic()
        );
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load office preference.", error);
          setPreference(defaultStudioOfficePreferencePublic());
        }
      } finally {
        if (!cancelled) {
          setLoaded(true);
        }
      }
    };
    void loadPreference();
    return () => {
      cancelled = true;
    };
  }, [gatewayUrl, settingsCoordinator]);

  const setTitle = useCallback(
    (title: string) => {
      const gatewayKey = gatewayUrl.trim();
      setPreference((current) => ({ ...current, title }));
      if (!gatewayKey) return;
      settingsCoordinator.schedulePatch(
        {
          office: {
            [gatewayKey]: {
              title,
            },
          },
        },
        0
      );
    },
    [gatewayUrl, settingsCoordinator]
  );

  return {
    loaded,
    preference,
    title: preference.title,

    setTitle,

  };
};
