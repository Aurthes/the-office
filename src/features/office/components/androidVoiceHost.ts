"use client";

type NativeMessage = { type?: string; id?: string; error?: string; command?: string };
type AndroidHost = { postMessage: (message: string) => void; onmessage: ((event: { data: string }) => void) | null };
export type AndroidVoiceLease = { update: (status: string, muted: boolean) => void; release: () => void };
declare global { interface Window { OfficeAndroid?: AndroidHost } }

// Only the Android wrapper injects this origin-scoped bridge. Browser calls
// keep their existing media path and do not require an Android service.
export async function prepareAndroidVoice(id: string, threadId: string, onCommand: (command: string) => void, signal: AbortSignal): Promise<AndroidVoiceLease | undefined> {
  const host = window.OfficeAndroid;
  if (!host) return;
  const send = (value: object) => host.postMessage(JSON.stringify({ ...value, id }));
  let released = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const lease: AndroidVoiceLease = {
    update(status, muted) { if (!released) send({ type: "voice.state", status, muted }); },
    release() {
      if (released) return;
      released = true; clearTimeout(timer);
      host.onmessage = null;
      try { send({ type: "voice.release" }); } catch { /* The native document may already be closing. */ }
    },
  };
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () => { lease.release(); reject(new DOMException("Voice connection cancelled", "AbortError")); };
      if (signal.aborted) { abort(); return; }
      signal.addEventListener("abort", abort, { once: true });
      host.onmessage = event => {
        let message: NativeMessage;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.id !== id || released) return;
        if (message.type === "voice.prepared") {
          clearTimeout(timer);
          if (message.error) reject(new Error(message.error)); else resolve();
        }
        if (message.type === "voice.command" && ["stop", "toggleMute"].includes(message.command || "")) onCommand(message.command!);
      };
      timer = setTimeout(() => reject(new Error("Android voice preparation timed out. Please retry.")), 65000);
      send({ type: "voice.prepare", threadId });
    });
    return lease;
  } catch (error) { lease.release(); throw error; }
  finally { if (abort) signal.removeEventListener("abort", abort); }
}
