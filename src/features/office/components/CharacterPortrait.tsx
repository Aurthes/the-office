"use client";
import { useEffect, useState } from "react";
import type { AgentAvatarProfile } from "@/lib/avatars/profile";
import { normalizeDuckAppearance } from "@/lib/avatars/duck";
import { useUiText } from "@/lib/i18n/ui-language";

export function CharacterPortrait({ name, profile }: { name: string; profile?: AgentAvatarProfile | null }) {
  const t = useUiText();
  const key = JSON.stringify(normalizeDuckAppearance(profile?.duck));
  const [image, setImage] = useState<{ key: string; src: string } | null>(null);
  useEffect(() => {
    let stopped = false;
    void import("@/features/ring-ship/characterPortrait").then(({ characterPortrait }) => characterPortrait(JSON.parse(key))).then(src => {
      if (!stopped) setImage({ key, src });
    }).catch(() => { /* Keep a simple initial when WebGL is unavailable. */ });
    return () => { stopped = true; };
  }, [key]);
  return <span className="character-portrait" role="img" aria-label={t("Portrait of {name}", { name })}>
    {image?.key === key ? /* eslint-disable-next-line @next/next/no-img-element -- local WebGL snapshot, no network image */
      <img src={image.src} alt="" draggable={false} /> : name.slice(0, 1)}
  </span>;
}
