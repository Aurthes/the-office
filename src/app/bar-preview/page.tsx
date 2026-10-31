"use client";

import dynamic from "next/dynamic";
import { useUiText } from "@/lib/i18n/ui-language";

const Ship = dynamic(() => import("@/features/ring-ship/RingShipOffice").then(module => module.RingShipOffice), { ssr: false });
const roster = { projects: [], members: [] };
const agents: [] = [];

export default function BarPreviewPage() {
  const t = useUiText();
  return <Ship agents={agents} companyRoster={roster} storageNamespace="bar-preview" officeTitle={t("Listening bar · Design preview")} musicPreview />;
}
