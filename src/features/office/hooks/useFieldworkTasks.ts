"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionClient } from "../components/SessionControls";
import type { AgentState } from "@/features/agents/state/store";
import type { CompanyRoster } from "@/features/retro-office/core/companyLayout";
import { isTaskContinuation, latestSiteTask } from "@/lib/office/fieldworkTask";

const EMPTY_TASKS: Record<string, string> = {};

export function useFieldworkTasks(client: SessionClient, agents: AgentState[], roster: CompanyRoster | null, enabled: boolean, gateway: string) {
  const [state, setState] = useState<{ gateway: string; tasks: Record<string, string> }>({ gateway, tasks: {} });
  const publish = useCallback((id: string, text: string) => setState(previous => {
    const tasks = previous.gateway === gateway ? previous.tasks : {};
    return previous.gateway === gateway && tasks[id] === text ? previous : { gateway, tasks: { ...tasks, [id]: text } };
  }), [gateway]);
  const versions = useRef(new Map<string, number>());
  const workers = useMemo(() => {
    const departments = new Set((roster?.projects || []).filter(p => p.name.trim().toLowerCase() === "office").map(p => p.id));
    return new Set((roster?.members || []).filter(m => m.projectId && departments.has(m.projectId)).map(m => m.id));
  }, [roster]);
  const workerKey = JSON.stringify([...workers].sort());
  const activeKey = JSON.stringify(agents.filter(a => workers.has(a.agentId) && a.status === "running").map(a => a.agentId).sort());
  useEffect(() => { versions.current.clear(); }, [gateway]);
  useEffect(() => {
    if (!enabled) return;
    const eligible = new Set<string>(JSON.parse(workerKey));
    return client.onEvent?.(event => {
      if (event.event !== "session.stream") return;
      const data = event.payload as { threadId?: string; items?: Array<{ role: string; content?: string }> };
      if (!data?.threadId || !eligible.has(data.threadId)) return;
      const user = [...(data.items || [])].reverse().find(i => i.role === "user" && i.content?.trim() && !isTaskContinuation(i.content));
      if (!user?.content) return;
      const id = data.threadId, text = user.content.slice(0, 12000);
      versions.current.set(id, (versions.current.get(id) || 0) + 1);
      publish(id, text);
    });
  }, [client, enabled, workerKey, gateway, publish]);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    // Only task/status transitions or reconnects read history. No animation or
    // metadata-refresh polling; conversation content never leaves this client.
    void Promise.all((JSON.parse(activeKey) as string[]).map(async id => {
      const version = versions.current.get(id) || 0;
      let cursor: string | null = null, text: string | null = null;
      try {
        for (let page = 0; page < 3 && !stopped; page++) {
          const result = await client.call("session.history", { threadId: id, ...(cursor ? { cursor } : {}) }) as { messages: Array<{ role: string; content: string }>; nextCursor?: string | null };
          text = latestSiteTask(result.messages); cursor = result.nextCursor || null;
          if (text || !cursor) break;
        }
        if (!stopped && version === (versions.current.get(id) || 0)) publish(id, text || "");
      } catch { if (!stopped && version === (versions.current.get(id) || 0)) publish(id, ""); }
    }));
    return () => { stopped = true; };
  }, [client, enabled, activeKey, gateway, publish]);
  return { tasks: state.gateway === gateway ? state.tasks : EMPTY_TASKS, workers };
}
