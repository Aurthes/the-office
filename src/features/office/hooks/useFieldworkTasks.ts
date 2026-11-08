"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SessionClient } from "../components/SessionControls";
import type { AgentState } from "@/features/agents/state/store";
import type { CompanyRoster } from "@/features/retro-office/core/companyLayout";
import { currentFieldworkTask, isWorkDirective, latestSiteTask, taskSiteGoal, siteTaskKey, type FieldworkTaskSummary, type SiteTask } from "@/lib/office/fieldworkTask";

type TaskEntry = { task: SiteTask; key: string; timestamp: number; live: boolean };
const EMPTY_TASKS: Record<string, SiteTask | null | undefined> = {};

export function useFieldworkTasks(client: SessionClient, agents: AgentState[], roster: CompanyRoster | null, enabled: boolean, gateway: string, summaries?: readonly FieldworkTaskSummary[] | null, fresh = true) {
  const [state, setState] = useState<{ gateway: string; tasks: Record<string, TaskEntry> }>({ gateway, tasks: {} });
  const context = useRef(summaries);
  const accepting = useRef(fresh);
  useLayoutEffect(() => { context.current = summaries; accepting.current = fresh; }, [summaries, fresh]);
  const publish = useCallback((id: string, task: SiteTask | null, timestamp = 0, live = false) => {
    if (!accepting.current) return;
    const current = context.current && currentFieldworkTask(context.current, id);
    const key = current ? siteTaskKey(current) : "";
    setState(previous => {
      const tasks = previous.gateway === gateway ? previous.tasks : {};
      if (!task) return { gateway, tasks: { ...tasks, [id]: { task: "", key, timestamp, live } } };
      const old = tasks[id];
      if (live && old?.live && old.timestamp > timestamp) return previous;
      return { gateway, tasks: { ...tasks, [id]: { task, key, timestamp, live } } };
    });
  }, [gateway]);
  const versions = useRef(new Map<string, number>());
  const streamVersions = useRef(new Map<string, number>());
  const workers = useMemo(() => {
    const departments = new Set((roster?.projects || []).filter(p => p.name.trim().toLowerCase() === "office").map(p => p.id));
    return new Set((roster?.members || []).filter(m => m.projectId && departments.has(m.projectId)).map(m => m.id));
  }, [roster]);
  const workerKey = JSON.stringify([...workers].sort());
  const activeKey = JSON.stringify(agents.filter(a => workers.has(a.agentId) && a.status === "running").map(a => a.agentId).sort());
  useEffect(() => { versions.current.clear(); streamVersions.current.clear(); }, [gateway, enabled]);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const eligible = new Set<string>(JSON.parse(workerKey));
    const off = client.onEvent?.(event => {
      if (stopped || event.event !== "session.stream") return;
      const data = event.payload as { threadId?: string; version?: number; items?: Array<{ role: string; content?: string; timestamp?: number }> };
      if (!data?.threadId || !eligible.has(data.threadId)) return;
      if (data.version !== undefined) {
        if (data.version <= (streamVersions.current.get(data.threadId) ?? -1)) return;
        streamVersions.current.set(data.threadId, data.version);
      }
      const messages = (data.items || []).filter((i): i is typeof i & { content: string } => typeof i.content === "string");
      const task = latestSiteTask(messages);
      if (task === null) return;
      const id = data.threadId;
      versions.current.set(id, (versions.current.get(id) || 0) + 1);
      const user = [...messages].reverse().find(i => i.role === "user" && latestSiteTask([i]) !== null);
      publish(id, task, user?.timestamp, true);
    });
    return () => { stopped = true; off?.(); };
  }, [client, enabled, workerKey, gateway, publish]);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    // A bounded fallback for unbound work. Task changes use the existing todo
    // snapshot/event, never a new history-polling loop.
    void Promise.all((JSON.parse(activeKey) as string[]).map(async id => {
      if (context.current?.some(t => !t.archived && t.handlingAgentId === id)) return;
      const version = versions.current.get(id) || 0;
      let cursor: string | null = null, task: SiteTask | null = null;
      try {
        for (let page = 0; page < 3 && !stopped; page++) {
          const result = await client.call("session.history", { threadId: id, ...(cursor ? { cursor } : {}) }) as { messages: Array<{ role: string; content: string }>; nextCursor?: string | null };
          task = latestSiteTask(result.messages); cursor = result.nextCursor || null;
          if (task !== null || !cursor) break;
        }
        if (!stopped && version === (versions.current.get(id) || 0)) publish(id, task);
      } catch { if (!stopped && version === (versions.current.get(id) || 0)) publish(id, null); }
    }));
    return () => { stopped = true; };
  }, [client, enabled, activeKey, gateway, publish]);

  const tasks: Record<string, SiteTask | null | undefined> = {};
  for (const id of workers) {
    if (!enabled || summaries === null) { tasks[id] = undefined; continue; }
    const current = summaries && currentFieldworkTask(summaries, id);
    const entry = state.gateway === gateway ? state.tasks[id] : undefined;
    if (current) {
      // Only a timestamped live positive directive from this exact work goal
      // may steer its goal. History/old subscription items cannot override it.
      tasks[id] = entry?.live && entry.key === siteTaskKey(current) && typeof entry.task === "string" && current.lastStartedAt && entry.timestamp >= current.lastStartedAt && isWorkDirective(entry.task)
        ? entry.task : taskSiteGoal(current);
    } else if (entry && typeof entry.task !== "string" && summaries) {
      const notifiedId = entry.task.taskId;
      const notified = summaries.find(t => t.id === notifiedId && t.handlingAgentId === id && !t.archived && !["done", "queued"].includes(t.status));
      tasks[id] = notified && entry.live ? taskSiteGoal(notified) : null;
    } else {
      // An old bound-task directive does not become unbound work after a switch.
      tasks[id] = entry?.key ? null : entry?.task ?? null;
    }
  }
  return { tasks: enabled ? tasks : EMPTY_TASKS, workers };
}
