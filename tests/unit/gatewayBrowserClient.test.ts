import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayBrowserClient } from "@/lib/gateway/openclaw/GatewayBrowserClient";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  static sent: string[] = [];
  static closes: Array<{ code: number; reason: string }> = [];

  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    MockWebSocket.sent.push(String(data));
  }

  close(code?: number, reason?: string) {
    MockWebSocket.closes.push({ code: code ?? 1000, reason: reason ?? "" });
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: code ?? 1000, reason: reason ?? "" } as CloseEvent);
  }
}

describe("GatewayBrowserClient", () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalSubtle = globalThis.crypto?.subtle;

  beforeEach(() => {
    MockWebSocket.instances = [];
    MockWebSocket.sent = [];
    MockWebSocket.closes = [];
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    if (globalThis.crypto) {
      Object.defineProperty(globalThis.crypto, "subtle", {
        value: undefined,
        configurable: true,
      });
    }
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
    if (globalThis.crypto) {
      Object.defineProperty(globalThis.crypto, "subtle", {
        value: originalSubtle,
        configurable: true,
      });
    }
  });

  async function connected(policy = { tickIntervalMs: 1000, requestTimeoutMs: 2000 }) {
    const onClose = vi.fn();
    const client = new GatewayBrowserClient({ url: "ws://example.com", onClose });
    client.start(); const ws = MockWebSocket.instances.at(-1)!;
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "fixture" } }) } as MessageEvent);
    const req = JSON.parse(MockWebSocket.sent.at(-1)!);
    ws.onmessage?.({ data: JSON.stringify({ type: "res", id: req.id, ok: true, payload: { type: "hello-ok", protocol: 3, policy } }) } as MessageEvent);
    await Promise.resolve(); await Promise.resolve();
    return { client, ws, onClose };
  }

  it("detects a silently black-holed connection without waiting for its close handshake", async () => {
    const { client, onClose } = await connected();
    await vi.advanceTimersByTimeAsync(15000);
    expect(onClose).toHaveBeenCalledExactlyOnceWith({ code: 4001, reason: "Gateway heartbeat timed out" });
    expect(client.connected).toBe(false);
    await vi.advanceTimersByTimeAsync(1200);
    expect(MockWebSocket.instances).toHaveLength(2);
    client.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it("times out an uncertain write once and never replays it after reconnect", async () => {
    const { client } = await connected();
    const pending = client.request("session.create", { name: "Only once" });
    const rejected = expect(pending).rejects.toThrow("Not retried");
    await vi.advanceTimersByTimeAsync(3500); await rejected;
    expect(MockWebSocket.sent.map(text => JSON.parse(text)).filter(frame => frame.method === "session.create")).toHaveLength(1);
    client.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it("waits while offline, wakes on online, and does not create ghost sockets after stop", async () => {
    const { client } = await connected();
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    window.dispatchEvent(new Event("offline"));
    await vi.advanceTimersByTimeAsync(60000);
    expect(MockWebSocket.instances).toHaveLength(1);
    online.mockReturnValue(true); window.dispatchEvent(new Event("online"));
    expect(MockWebSocket.instances).toHaveLength(2);
    client.stop(); window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(60000);
    expect(MockWebSocket.instances).toHaveLength(2); expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores late close events from a retired socket and resets event sequence on reconnect", async () => {
    const { client, ws, onClose } = await connected(); const oldClose = ws.onclose!;
    ws.onclose?.({ code: 1006, reason: "link lost" } as CloseEvent);
    await vi.advanceTimersByTimeAsync(1200);
    expect(client.connected).toBe(true);
    oldClose({ code: 1006, reason: "late close" } as CloseEvent);
    expect(client.connected).toBe(true); expect(onClose).toHaveBeenCalledTimes(1);
    client.stop();
  });

  it("allows background throttling and a fresh heartbeat after visibility recovery", async () => {
    const { client, ws, onClose } = await connected();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await vi.advanceTimersByTimeAsync(60000); expect(onClose).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(5000);
    ws.onmessage?.({ data: JSON.stringify({ type: "event", event: "tick" }) } as MessageEvent);
    await vi.advanceTimersByTimeAsync(1000); expect(onClose).not.toHaveBeenCalled();
    client.stop();
  });

  it("sends connect when connect.challenge arrives", async () => {
    const client = new GatewayBrowserClient({ url: "ws://example.com" });
    client.start();

    const ws = MockWebSocket.instances[0];
    if (!ws) {
      throw new Error("WebSocket not created");
    }

    ws.onopen?.();

    expect(MockWebSocket.sent).toHaveLength(0);

    ws.onmessage?.({
      data: JSON.stringify({
        type: "event",
        event: "connect.challenge",
        payload: { nonce: "abc" },
      }),
    } as MessageEvent);

    await vi.runAllTicks();

    expect(MockWebSocket.sent).toHaveLength(1);
    const frame = JSON.parse(MockWebSocket.sent[0] ?? "{}");
    expect(frame.type).toBe("req");
    expect(frame.method).toBe("connect");
    expect(typeof frame.id).toBe("string");
    expect(frame.id).toMatch(UUID_V4_RE);
    expect(frame.params?.client?.id).toBe("openclaw-control-ui");
  });

  it("truncates connect-failed close reason to websocket limit", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new GatewayBrowserClient({ url: "ws://example.com", token: "secret" });
    client.start();

    const ws = MockWebSocket.instances[0];
    if (!ws) {
      throw new Error("WebSocket not created");
    }

    ws.onopen?.();
    vi.runAllTimers();

    const connectFrame = JSON.parse(MockWebSocket.sent[0] ?? "{}");
    const connectId = String(connectFrame.id ?? "");
    expect(connectId).toMatch(UUID_V4_RE);

    ws.onmessage?.({
      data: JSON.stringify({
        type: "res",
        id: connectId,
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: `invalid config ${"x".repeat(260)}`,
        },
      }),
    } as MessageEvent);

    await vi.runAllTicks();
    await vi.runAllTimersAsync();
    await Promise.resolve();

    const lastClose = MockWebSocket.closes.at(-1);
    expect(lastClose?.code).toBe(4008);
    expect(lastClose?.reason.startsWith("connect failed: INVALID_REQUEST")).toBe(true);
    expect(new TextEncoder().encode(lastClose?.reason ?? "").byteLength).toBeLessThanOrEqual(123);
    warnSpy.mockRestore();
  });
});
