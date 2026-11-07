"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SessionClient } from "./SessionControls";

type Binding = { pageId: string; bindingGeneration: string; bootEpoch: string; resumeProof: string };
type Receipt = { threadId: string; expiresAt: number; state: "reserved" | "delivered" | "cancelled" };
export type CaptureUpload = { id: string; name: string; size: number; ref?: string; error?: string };
type Event = { requestId: string; pageId: string; bindingGeneration: string; bootEpoch: string; threadId: string; subscriptionId: string; expiresAt: number; ref?: string; name?: string; size?: number; error?: string };
const pages = new WeakMap<SessionClient, ReturnType<typeof createPage>>();
function createPage(client: SessionClient) {
  const page = { id: crypto.randomUUID(), binding: null as Binding | null, conflict: false, connected: true,
    receipts: new Map<string, Receipt>(), listeners: new Set<() => void>(), pending: null as Promise<void> | null,
    notify: () => { for (const listener of page.listeners) listener(); },
    resume: () => {
      if (!page.binding || page.pending) return;
      page.pending = client.call("session.capture.resume", page.binding).then(value => { page.binding = value as Binding; }, () => {
        page.binding = null;
        for (const receipt of page.receipts.values()) if (receipt.state === "reserved") receipt.state = "cancelled";
      }).finally(() => { page.pending = null; page.notify(); });
    } };
  return page;
}
function getPage(client: SessionClient) {
  let page = pages.get(client); if (!page) { page = createPage(client); pages.set(client, page); }
  return page;
}
export function useSessionCapture({ client, threadId, subscription, enabled, active, eligible, blocked, uploads, updateUploads, onError, onAdopt }: {
  client: SessionClient; threadId: string; subscription: { current: string | null }; enabled: boolean; active: boolean; eligible: boolean; blocked: boolean;
  uploads: { current: CaptureUpload[] }; updateUploads: (next: CaptureUpload[]) => void; onError: (message: string) => void; onAdopt?: () => void;
}) {
  const [view, setView] = useState({ bound: false, conflict: false });
  const [bindingBusy, setBindingBusy] = useState(false);
  const latest = useRef({ active, eligible, blocked, enabled, updateUploads, onError });
  useLayoutEffect(() => { latest.current = { active, eligible, blocked, enabled, updateUploads, onError }; });
  useEffect(() => {
    if (!enabled) return;
    const page = getPage(client);
    let disposed = false;
    const changed = () => {
      if (disposed) return;
      for (const [id, receipt] of page.receipts) {
        if (receipt.threadId !== threadId || receipt.state === "delivered") continue;
        if (receipt.expiresAt <= Date.now()) receipt.state = "cancelled";
        if (receipt.state === "cancelled" && uploads.current.some(file => file.id === id)) latest.current.updateUploads(uploads.current.filter(file => file.id !== id));
      }
      setView({ bound: Boolean(page.binding), conflict: page.conflict });
    };
    page.listeners.add(changed);
    const acknowledge = (event: Event, result: string) => client.call("session.capture.ack", { ...event, ref: undefined, name: undefined, size: undefined, error: undefined, result }).catch(() => {});
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const off = client.onEvent?.(event => {
      const p = event.payload as Event;
      if (event.event === "session.capture.unbound" && p?.pageId === page.id) {
        page.binding = null; page.conflict = true;
        for (const receipt of page.receipts.values()) if (receipt.state === "reserved") receipt.state = "cancelled";
        page.notify(); return;
      }
      if (!p || p.pageId !== page.id || p.threadId !== threadId || p.bindingGeneration !== page.binding?.bindingGeneration || p.bootEpoch !== page.binding?.bootEpoch) return;
      const current = latest.current;
      let receipt = page.receipts.get(p.requestId);
      if (event.event === "session.capture.prepare") {
        if (receipt) { void acknowledge(p, receipt.state === "reserved" ? "prepared" : "cancelled"); return; }
        for (const [id, old] of page.receipts) if (old.expiresAt <= Date.now()) page.receipts.delete(id);
        if (!current.active || !current.eligible || current.blocked || !page.connected || subscription.current !== p.subscriptionId || uploads.current.length >= 8 || page.receipts.size >= 64) { void acknowledge(p, "rejected"); return; }
        receipt = { threadId, expiresAt: p.expiresAt, state: "reserved" }; page.receipts.set(p.requestId, receipt);
        current.updateUploads([...uploads.current, { id: p.requestId, name: "Mac screenshot…", size: 0 }]);
        timers.set(p.requestId, setTimeout(() => { const r = page.receipts.get(p.requestId); if (r?.state === "reserved") { r.state = "cancelled"; changed(); } }, Math.max(0, p.expiresAt - Date.now())));
        void acknowledge(p, "prepared");
      } else if (event.event === "session.capture.ready") {
        if (receipt?.state === "delivered") { void acknowledge(p, "delivered"); return; }
        if (!receipt || receipt.expiresAt <= Date.now() || receipt.state === "cancelled" || current.blocked || !page.connected || !p.ref || !p.size || !uploads.current.some(file => file.id === p.requestId)) {
          if (receipt) receipt.state = "cancelled";
          current.updateUploads(uploads.current.filter(file => file.id !== p.requestId));
          void acknowledge(p, "cancelled"); return;
        }
        // Always update the ORIGINAL panel's current array, even while hidden.
        current.updateUploads(uploads.current.map(file => file.id === p.requestId ? { id: file.id, name: p.name || "Screenshot.png", size: p.size!, ref: p.ref } : file));
        receipt.state = "delivered"; clearTimeout(timers.get(p.requestId));
        void acknowledge(p, "delivered");
      } else if (event.event === "session.capture.failed" && receipt?.state === "reserved") {
        receipt.state = "cancelled"; current.updateUploads(uploads.current.filter(file => file.id !== p.requestId));
        current.onError(p.error || "Mac screenshot failed; existing draft kept.");
      }
    });
    const offStatus = client.onStatus?.(status => { page.connected = status === "connected"; if (page.connected) page.resume(); });
    if (page.binding) page.resume();
    queueMicrotask(changed);
    return () => { disposed = true; page.listeners.delete(changed); off?.(); offStatus?.(); for (const timer of timers.values()) clearTimeout(timer); };
  }, [client, enabled, subscription, threadId, uploads]);
  const bind = async () => {
    if (bindingBusy) return;
    const page = getPage(client);
    setBindingBusy(true);
    try {
      onAdopt?.();
      const result = await client.call("session.capture.bind", { pageId: page.id, replace: page.conflict, requestId: crypto.randomUUID() }) as Binding & { conflict?: boolean };
      if (result.conflict) page.conflict = true; else { page.binding = result; page.conflict = false; }
      page.notify();
    } catch (error) { onError(error instanceof Error ? error.message : "Could not bind this screenshot page"); }
    finally { setBindingBusy(false); }
  };
  const cancel = (id: string) => {
    const page = getPage(client);
    const receipt = page.receipts.get(id);
    if (!receipt || !page.binding) return;
    receipt.state = "cancelled";
    void client.call("session.capture.ack", { requestId: id, threadId, ...page.binding, result: "cancelled" }).catch(() => {});
  };
  return { bind, cancel, ...view, busy: bindingBusy };
}
