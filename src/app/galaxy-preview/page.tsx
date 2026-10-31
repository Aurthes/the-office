"use client";

import dynamic from "next/dynamic";
import type { CompanyRoster } from "@/features/retro-office/core/companyLayout";
import type { OfficeAgent } from "@/features/retro-office/core/types";
import { useUiText } from "@/lib/i18n/ui-language";

const Ship = dynamic(() => import("@/features/ring-ship/RingShipOffice").then(module => module.RingShipOffice), { ssr: false });
const roster: CompanyRoster = { projects: [{ id: "navigation-preview", name: "Flight crew" }], members: [{ id: "navigator", projectId: "navigation-preview" }] };
const agents: OfficeAgent[] = [{ id: "navigator", name: "Navigator", status: "idle", color: "#91c9c5", item: "" }];

export default function GalaxyPreviewPage() {
  const t = useUiText();
  return <div className="galaxy-preview h-full w-full"><Ship agents={agents} companyRoster={roster} storageNamespace="galaxy-preview" officeTitle={t("Star systems · Design preview")} navigationPreview /></div>;
}
