"use client";
import { useEffect } from "react";
import type { SessionClient } from "../components/SessionControls";

export function useCompanyRosterSync(client: SessionClient, enabled: boolean,
  load: (options: { silent: boolean }) => Promise<void>) {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false, busy = false, dirty = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      dirty = true;
      if (busy || stopped || document.visibilityState !== "visible") return;
      clearTimeout(retry);
      busy = true;
      try {
        while (dirty && !stopped && document.visibilityState === "visible") {
          dirty = false;
          await load({ silent: true });
        }
      } catch {
        // Only reads are retried. A temporary read failure must not leave a
        // connected page stale just because the roster did not change again.
        if (!stopped) retry = setTimeout(() => void refresh(), 30000);
      }
      finally { busy = false; }
    };
    const unsubscribe = client.onEvent?.(event => {
      if (event.event === "roster.updated") void refresh();
    });
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    // Covers an event received between the initial snapshot and subscription.
    void refresh();
    return () => {
      stopped = true; clearTimeout(retry); unsubscribe?.();
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [client, enabled, load]);
}
