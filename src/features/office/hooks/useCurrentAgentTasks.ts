"use client";
import { useEffect, useState } from "react";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { currentTasksByAgent, type DirectoryTaskSummary } from "../operations/agentDirectory";

export function useCurrentAgentTasks(client: Pick<GatewayClient, "call" | "onEvent">, enabled: boolean, gateway: string) {
  const [snapshot, setSnapshot] = useState<{ gateway: string; tasks: DirectoryTaskSummary[]; error: string; loaded: boolean; fresh: boolean }>({ gateway, tasks: [], error: "", loaded: false, fresh: false });
  useEffect(() => {
    if (!enabled) return;
    let stopped = false, loading = false, again = false, generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (loading) { again = true; return; }
      loading = true;
      const requested = generation;
      try {
        const tasks: DirectoryTaskSummary[] = [];
        let total = 0;
        do {
          const page = await client.call<{ todos: DirectoryTaskSummary[]; total: number }>("todo.list", { status: "all", offset: tasks.length, limit: 25 });
          if (stopped || requested !== generation) return;
          if (!Array.isArray(page.todos)) throw new Error("Current tasks are unavailable.");
          tasks.push(...page.todos); total = page.total;
          if (!page.todos.length) break;
        } while (tasks.length < total);
        if (!stopped && requested === generation) setSnapshot({ gateway, tasks, error: "", loaded: true, fresh: true });
      } catch {
        if (!stopped && requested === generation) setSnapshot(previous => ({ gateway, tasks: previous.gateway === gateway ? previous.tasks : [], error: "Current tasks are unavailable.", loaded: true, fresh: false }));
      } finally {
        loading = false;
        if (again && !stopped) { again = false; void load(); }
      }
    };
    const refresh = () => {
      if (stopped) return;
      generation++;
      setSnapshot(previous => ({ ...previous, fresh: false }));
      if (loading) again = true;
      else if (!timer) timer = setTimeout(() => { timer = undefined; void load(); }, 150);
    };
    const off = client.onEvent(event => { if (event.event === "todos.updated") refresh(); });
    window.addEventListener("focus", refresh);
    void load();
    return () => { stopped = true; off(); clearTimeout(timer); window.removeEventListener("focus", refresh); };
  }, [client, enabled, gateway]);
  const summaries = snapshot.gateway === gateway ? snapshot.tasks : [];
  return { tasks: currentTasksByAgent(summaries), summaries, fieldworkSummaries: enabled && snapshot.gateway === gateway && snapshot.fresh ? summaries : null, loading: enabled && (snapshot.gateway !== gateway || !snapshot.loaded), error: enabled && snapshot.gateway === gateway ? snapshot.error : "" };
}
