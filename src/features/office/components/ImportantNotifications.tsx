"use client";
import { useEffect, useRef, useState } from "react";
import type { SessionClient } from "./SessionControls";
import type { SessionVoiceController } from "./useSessionVoice";

type Settings = { publicKey: string; enabled: boolean; lastError: string | null };
type Brief = { id: string; title: string; brief: string; headId: string; headName: string; taskId: string | null; updatedAt: number };
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id);
const button = "min-h-10 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-[var(--foreground)] disabled:opacity-40";
function applicationKey(value: string) {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function registration() { return navigator.serviceWorker.register("/office-sw.js", { scope: "/", updateViaCache: "none" }); }

export function NotificationSettings({ client, connected }: { client: SessionClient; connected: boolean }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const supported = typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    if (connected && supported) void client.call("office.notifications.settings", {}).then(value => { if (generation.current === current) { setSettings(value as Settings); setError(""); } }).catch(() => { if (generation.current === current) setError("Could not load reminders. Reconnect and retry."); });
    return () => { if (generation.current === current) generation.current = current + 1; };
  }, [client, connected, supported]);
  const enable = async () => {
    if (!settings || busy) return;
    const current = generation.current;
    setBusy(true); setError("");
    try {
      // Request directly from the button gesture, before any server/network await.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notifications are blocked or not allowed. Change this website's notification permission to try again.");
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const old = await reg.pushManager.getSubscription();
      const key = applicationKey(settings.publicKey);
      if (old && old.options.applicationServerKey && Array.from(new Uint8Array(old.options.applicationServerKey)).join() !== Array.from(key).join()) await old.unsubscribe();
      const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const result = await client.call("office.notifications.subscribe", { subscription: sub.toJSON() });
      if (generation.current === current) setSettings(result as Settings);
    } catch (e) { if (generation.current === current) setError(e instanceof Error ? e.message : "Could not enable reminders. Retry."); }
    finally { if (generation.current === current) setBusy(false); }
  };
  const disable = async () => {
    if (busy) return;
    const current = generation.current; setBusy(true); setError("");
    try {
      // Server removal first: failures never falsely report a successful opt-out.
      await client.call("office.notifications.unsubscribe", {});
      const reg = await navigator.serviceWorker.getRegistration("/");
      await (await reg?.pushManager.getSubscription())?.unsubscribe();
      if (generation.current === current) setSettings(s => s ? { ...s, enabled: false, lastError: null } : s);
    } catch { if (generation.current === current) setError("Could not finish disabling reminders. Reconnect and retry."); }
    finally { if (generation.current === current) setBusy(false); }
  };
  return <section className="space-y-3 text-sm text-[var(--foreground)]" aria-label="Important task reminders">
    <h3 className="font-semibold text-[var(--foreground)]">Important task reminders</h3>
    <p>Heads can notify you about verified results, needed decisions and real blockers. Routine progress stays in the task.</p>
    <p>iPhone: open this address in Safari, Share → Add to Home Screen. Open the installed Office, then enable notifications here. Requires iOS 16.4 or later.</p>
    <p className="text-amber-800 dark:text-amber-100">This is a temporary address. If it changes, add Office to your Home Screen again and grant permission and subscribe again. Notifications cannot move between addresses.</p>
    <p>Lock-screen text stays generic. Open Office and sign in to read the brief. Focus, browser and network settings can delay or block delivery.</p>
    <p role="status">{!supported ? "Push notifications are unavailable here. On iPhone, use the Home Screen app." : !connected ? "Disconnected — reconnect to manage reminders." : settings?.enabled ? "Enabled on this installation" : settings ? "Not enabled on this installation" : "Loading reminder settings…"}</p>
    {supported ? <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!connected || !settings || busy} onClick={() => void enable()}>{settings?.enabled ? "Refresh subscription" : "Enable notifications"}</button><button type="button" className={button} disabled={!connected || !settings?.enabled || busy} onClick={() => void disable()}>Disable on this device</button></div> : null}
    {error || settings?.lastError ? <p role="alert" className="text-rose-700 dark:text-rose-200 break-words">{error || settings?.lastError}</p> : null}
  </section>;
}

export function ImportantNotificationBrief({ client, connected, voice, onOpenHead, onOpenTask }: { client: SessionClient; connected: boolean; voice: SessionVoiceController; onOpenHead: (id: string) => void; onOpenTask: (id: string) => void }) {
  const [id, setId] = useState<string | null>(() => {
    if (typeof location === "undefined") return null;
    const initial = new URL(location.href).searchParams.get("notification");
    return validId(initial) ? initial : null;
  });
  const [result, setResult] = useState<{ id: string; brief: Brief | null; error: string } | null>(null);
  const brief = connected && result?.id === id ? result.brief : null;
  const error = connected && result?.id === id ? result.error : "";
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.data?.type === "office-notification" && validId(event.data.eventId)) {
        setId(event.data.eventId); setOpen(true);
        const url = new URL(location.href); url.searchParams.set("notification", event.data.eventId); history.replaceState(null, "", url);
        event.ports?.[0]?.postMessage("received");
      }
    };
    navigator.serviceWorker?.addEventListener("message", receive);
    return () => navigator.serviceWorker?.removeEventListener("message", receive);
  }, []);
  useEffect(() => {
    let current = true;
    if (id && connected) void client.call("office.notifications.detail", { notificationId: id }).then(value => { if (current) setResult({ id, brief: value as Brief, error: "" }); }).catch(() => { if (current) setResult({ id, brief: null, error: "This reminder is unavailable for the current login. Reconnect or sign in again." }); });
    return () => { current = false; };
  }, [id, connected, client]);
  if (!id || !open) return null;
  return <section role="dialog" aria-label="Important update" className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 right-4 z-[110] max-h-[70dvh] overflow-y-auto rounded-xl border border-cyan-300/30 bg-[var(--card)] p-4 text-[var(--foreground)] shadow-xl sm:left-auto sm:w-96">
    <div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{brief ? `${brief.headName} · ${brief.title}` : "Important update"}</h2><button type="button" aria-label="Close important update" className="min-h-10 min-w-10" onClick={() => { setOpen(false); const url = new URL(location.href); url.searchParams.delete("notification"); history.replaceState(null, "", url); }}>×</button></div>
    {brief ? <><p className="whitespace-pre-wrap break-words text-sm">{brief.brief}</p><div className="mt-3 flex flex-wrap gap-2"><button className={button} onClick={() => onOpenHead(brief.headId)}>Open chat</button>{brief.taskId ? <button className={button} onClick={() => onOpenTask(brief.taskId!)}>Task</button> : null}<button className={button} disabled={!connected || voice.status !== "off"} onClick={() => { onOpenHead(brief.headId); void voice.start(brief.headId, brief.id); }}>Voice briefing</button></div><p className="mt-2 text-xs text-[var(--muted-foreground)]">Voice starts only when you click. {voice.status !== "off" ? "Finish the current call first." : "Microphone permission is required."}</p></> : <div><p role="status">{error || (!connected ? "Reconnect to read this brief." : "Loading brief…")}</p>{!connected || error ? <a className="inline-block min-h-10 py-2 text-[var(--primary)] underline" href={`/office?notification=${id}`}>Sign in and reopen this brief</a> : null}</div>}
  </section>;
}
