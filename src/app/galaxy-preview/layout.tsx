import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Star systems · Preview", description: "Explore star systems from the ship's holographic navigation console." };

export default function GalaxyPreviewLayout({ children }: { children: ReactNode }) {
  return children;
}
