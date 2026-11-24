import React from "react";
import { createRoot } from "react-dom/client";
import { ServerDashboard } from "@/features/ring-ship/ServerDashboard";
import type { ServerSnapshot } from "@/lib/monitoring/types";
import "@/features/ring-ship/monitor-dashboard.css";

declare global { interface Window { serverDiskFixture: ServerSnapshot; diskActions: number } }
window.diskActions = 0;
createRoot(document.getElementById("root")!).render(<div className="monitor-frame" data-view="servers" style={{ height: "100dvh", borderRadius: 0 }}>
  <div className="monitor-content"><ServerDashboard active fleet={{ snapshot: window.serverDiskFixture, error: "", refresh: () => {} }}
    onFirefight={async () => { window.diskActions++; }} /></div>
</div>);
