"use client";
import { useEffect, useState } from "react";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";
import { currentTasksByAgent, type RunningTask } from "../operations/agentDirectory";

export function useCurrentAgentTasks(client: Pick<GatewayClient, "call" | "onEvent">, enabled: boolean, gateway: string) {
  const [snapshot, setSnapshot] = useState<{ gateway: string; tasks: RunningTask[]; error: string }>({ gateway, tasks: [], error: "" });
  useEffect(() => {
    if (!enabled) return;
    let stopped = false, loading = false, again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (loading) { again = true; return; }
      loading = true;
      try {
        const tasks: RunningTask[] = [];
        let total = 0;
        do {
          const page = await client.call<{ todos: RunningTask[]; total: number }>("todo.list", { status: "running", offset: tasks.length, limit: 25 });
          if (stopped) return;
          if (!Array.isArray(page.todos)) throw new Error("Current tasks are unavailable.");
          tasks.push(...page.todos); total = page.total;
          if (!page.todos.length) break;
        } while (tasks.length < total);
        if (!stopped) setSnapshot({ gateway, tasks, error: "" });
      } catch {
        if (!stopped) setSnapshot({ gateway, tasks: [], error: "Current tasks are unavailable." });
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
  return { tasks: currentTasksByAgent(enabled && snapshot.gateway === gateway ? snapshot.tasks : []), error: enabled && snapshot.gateway === gateway ? snapshot.error : "" };
}
