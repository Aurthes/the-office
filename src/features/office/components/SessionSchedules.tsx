"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { SessionClient } from "./SessionControls";
import { type ScheduledTask, labels, inProgress, stamp } from "@/features/ring-ship/ScheduledTasks";
import { useUiText } from "@/lib/i18n/ui-language";

type State = { client: SessionClient; owner: string; tasks: ScheduledTask[] | null; online: boolean; loading: boolean; error: string };
export function SessionSchedules({ client, threadId, active }: { client: SessionClient; threadId: string; active: boolean }) {
  const t = useUiText(), [revision, refresh] = useState(0), [state, setState] = useState<State | null>(null);
  useEffect(() => {
    if (!active) return;
    let stopped = false, pending = false, dirty = false, online = true, generation = 0;
    const empty = { client, owner: threadId, tasks: null, online: true, loading: true, error: "" };
    const load = async () => {
      if (!online || stopped) return;
      if (pending) { dirty = true; return; }
      pending = true;
      const version = generation;
      setState(previous => ({ ...(previous || empty), loading: true, error: "" }));
      try {
        const data = await client.call("schedule.list", {}) as { tasks: ScheduledTask[] };
        if (!Array.isArray(data.tasks)) throw new Error("Scheduled tasks are not available on this gateway.");
        if (!stopped && version === generation) setState({ ...empty, tasks: data.tasks.filter(task => task && task.threadId === threadId), loading: false });
      } catch (cause) {
        if (!stopped && version === generation) setState({ ...empty, loading: false, error: cause instanceof Error ? cause.message : "Could not load scheduled tasks." });
      } finally {
        pending = false;
        if (!stopped && dirty && online) { dirty = false; void load(); }
      }
    };
    const unsubscribeEvent = client.onEvent?.(event => { if (event.event === "schedules.updated") void load(); });
    const unsubscribeStatus = client.onStatus?.(status => {
      const nextOnline = status === "connected";
      if (nextOnline === online) return;
      online = nextOnline; generation++;
      if (online) void load();
      else { dirty = false; setState({ ...empty, online: false, loading: false }); }
    });
    void load();
    return () => { stopped = true; unsubscribeEvent?.(); unsubscribeStatus?.(); };
  }, [client, threadId, active, revision]);
  // Hide the previous owner's data immediately, even before the new effect runs.
  const view = state?.owner === threadId && state.client === client ? state : null;
  return <section className="session-schedules" aria-label={t("Schedule Task")} aria-busy={view?.loading ?? true}>
    <header><h3>{t("Scheduled tasks")}</h3><button type="button" aria-label={t("Refresh scheduled tasks")} disabled={!active || view?.online === false || view?.loading} onClick={() => refresh(value => value + 1)}><RefreshCw size={15} /></button></header>
    {view?.online === false ? <p role="status">{t("Connect the Office gateway to view scheduled tasks.")}</p> : view?.error ? <p role="alert">{t(view.error)}</p> : view?.loading || !view ? <p role="status">{t("Loading scheduled tasks…")}</p> : !view.tasks?.length ? <p>{t("No scheduled tasks for this conversation.")}</p> : null}
    {view?.online && !view.error ? view.tasks?.map(task => {
      const run = task.runs.at(-1), pending = inProgress(run);
      return <article key={task.id} aria-label={task.name}>
        <div className="session-schedule-heading"><h4>{task.name}</h4><span className="schedule-status" data-status={pending ? run?.status : task.enabled ? "enabled" : "paused"}>{t(pending && run ? labels[run.status] : task.enabled ? "Enabled" : "Paused")}</span></div>
        <p>{t("Next run")}: {task.enabled ? stamp(task.nextRunAt) : "—"}</p>
        <p>{t("Every {minutes} min", { minutes: task.intervalMinutes })}</p>
        {run ? <><p>{t("Last run")}: {stamp(run.scheduledAt)} · {t(labels[run.status])}{run.manual ? ` · ${t("Manual")}` : ""}</p>{run.error ? <p className="session-schedule-error">{t(run.error)}</p> : null}</> : <p>{t("No runs yet.")}</p>}
        {run?.status === "unknown" && !task.enabled ? <p>{t("This task was paused to avoid a duplicate. Check its conversation before resuming.")}</p> : null}
        <details><summary>{t("Task instructions")}</summary><pre>{task.prompt}</pre></details>
      </article>;
    }) : null}
  </section>;
}
