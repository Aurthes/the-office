import { useCallback, useEffect, useState } from "react";
import type { ServerSnapshot } from "@/lib/monitoring/types";

export type ServerFleetState = { snapshot: ServerSnapshot | null; error: string; refresh: () => void };
export function useServerSnapshot(active: boolean): ServerFleetState {
  const [snapshot, setSnapshot] = useState<ServerSnapshot | null>(null), [error, setError] = useState("");
  const [request, setRequest] = useState(0);
  const refresh = useCallback(() => setRequest(n => n + 1), []);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>, live = true, running = false;
    const load = async () => {
      if (!live || running) return;
      clearTimeout(timer);
      if (document.hidden) { timer = setTimeout(load, 30_000); return; }
      running = true; let delay = 30_000;
      try {
        const response = await fetch("/api/monitoring/servers", { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load server status.");
        if (live) { setSnapshot(body); setError(""); delay = body.refreshing ? 1500 : 30_000; }
      } catch (cause) { if (live) setError(cause instanceof Error ? cause.message : "Could not load server status."); }
      finally { running = false; if (live) timer = setTimeout(load, delay); }
    };
    void load(); document.addEventListener("visibilitychange", load);
    return () => { live = false; clearTimeout(timer); controller.abort(); document.removeEventListener("visibilitychange", load); };
  }, [active, request]);
  return { snapshot, error, refresh };
}
