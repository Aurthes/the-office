import type { SessionClient } from "@/features/office/components/SessionControls";

type Status = "connected" | "connecting" | "disconnected";
export function createServerTerminalClient(alias: string): SessionClient & { open: () => Promise<void>; close: () => void } {
  let socket: WebSocket | null = null, opening: Promise<void> | null = null, sequence = 0, disposed = false;
  const events = new Set<(event: { event: string; payload?: unknown }) => void>();
  const statuses = new Set<(status: Status) => void>();
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const status = (value: Status) => statuses.forEach(handler => handler(value));
  const fail = () => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error("Terminal disconnected. Reconnecting…")); }
    pending.clear(); opening = null; status("disconnected");
  };
  const connect = () => {
    if (disposed) return Promise.reject(new Error("Terminal closed."));
    if (socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (opening) return opening;
    status("connecting");
    opening = new Promise<void>((resolve, reject) => {
      const url = new URL("/api/gateway/ws", location.href); url.protocol = location.protocol === "https:" ? "wss:" : "ws:"; url.searchParams.set("terminalHost", alias);
      const ws = socket = new WebSocket(url);
      ws.onopen = () => { resolve(); status("connected"); };
      ws.onerror = () => reject(new Error("Could not connect to the server terminal."));
      ws.onclose = () => { reject(new Error("Could not connect to the server terminal.")); if (socket === ws) { socket = null; fail(); } };
      ws.onmessage = event => {
        let frame; try { frame = JSON.parse(String(event.data)); } catch { return; }
        if (frame.type === "event") { events.forEach(handler => handler(frame)); return; }
        const entry = pending.get(frame.id); if (!entry) return;
        pending.delete(frame.id); clearTimeout(entry.timer);
        if (frame.ok) entry.resolve(frame.payload); else entry.reject(new Error(frame.error || "Terminal request failed."));
      };
    });
    return opening;
  };
  return {
    open() { disposed = false; return connect(); },
    async call(method, params) {
      await connect();
      return new Promise((resolve, reject) => {
        const id = String(++sequence), timer = setTimeout(() => { pending.delete(id); reject(new Error("Terminal request timed out.")); }, 20_000);
        pending.set(id, { resolve, reject, timer });
        try { socket!.send(JSON.stringify({ type: "req", id, method, params })); } catch (cause) { clearTimeout(timer); pending.delete(id); reject(cause); }
      });
    },
    onEvent(handler) { events.add(handler); return () => { events.delete(handler); }; },
    onStatus(handler) { statuses.add(handler); return () => { statuses.delete(handler); }; },
    close() { disposed = true; socket?.close(); fail(); events.clear(); statuses.clear(); },
  };
}
