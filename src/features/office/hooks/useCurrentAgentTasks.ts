"use client";
import { useEffect, useState } from "react";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { currentTasksByAgent, type DirectoryTaskSummary } from "../operations/agentDirectory";

export function useCurrentAgentTasks(client: Pick<GatewayClient, "call" | "onEvent">, enabled: boolean, gateway: string) {
  const [snapshot, setSnapshot] = useState<{ gateway: string; tasks: DirectoryTaskSummary[]; error: string; loaded: boolean }>({ gateway, tasks: [], error: "", loaded: false });
  useEffect(() => {
    if (!enabled) return;
    let stopped = false, loading = false, again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (loading) { again = true; return; }
      loading = true;
      try {
        const tasks: DirectoryTaskSummary[] = [];
        let total = 0;
        do {
          const page = await client.call<{ todos: DirectoryTaskSummary[]; total: number }>("todo.list", { status: "all", offset: tasks.length, limit: 25 });
          if (stopped) return;
          if (!Array.isArray(page.todos)) throw new Error("Current tasks are unavailable.");
          tasks.push(...page.todos); total = page.total;
          if (!page.todos.length) break;
        } while (tasks.length < total);
        if (!stopped) setSnapshot({ gateway, tasks, error: "", loaded: true });
      } catch {
        if (!stopped) setSnapshot(previous => ({ gateway, tasks: previous.gateway === gateway ? previous.tasks : [], error: "Current tasks are unavailable.", loaded: true }));
      } finally {
        loading = false;
        if (again && !stopped) { again = false; void load(); }
      }
    };
    const refresh = () => { if (!timer) timer = setTimeout(() => { timer = undefined; void load(); }, 150); };
    const off = client.onEvent(event => { if (event.event === "todos.updated") refresh(); });
    window.addEventListener("focus", refresh);
    void load();
    return () => { stopped = true; off(); clearTimeout(timer); window.removeEventListener("focus", refresh); };
  }, [client, enabled, gateway]);
  const summaries = snapshot.gateway === gateway ? snapshot.tasks : [];
  return { tasks: currentTasksByAgent(summaries), summaries, loading: enabled && (snapshot.gateway !== gateway || !snapshot.loaded), error: enabled && snapshot.gateway === gateway ? snapshot.error : "" };
}
