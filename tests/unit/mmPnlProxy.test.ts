// @vitest-environment node
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions, ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const http: typeof import("node:http") = require("node:http");
const { createMmPnlProxy } = require("../../server/mm-pnl-proxy.js");
const message = "MM PnL dashboard temporarily unavailable";

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("MM PnL proxy unit error handling (10ms performance budget)", () => {
  function request(path = "/api/pnl") {
    const outgoing = Object.assign(new EventEmitter(), { destroy: vi.fn() });
    outgoing.destroy.mockImplementation(() => { outgoing.emit("error", new Error("synthetic-private-detail")); });
    vi.spyOn(http, "get").mockReturnValue(outgoing as unknown as ClientRequest);
    const response = Object.assign(new EventEmitter(), {
      destroyed: false, headersSent: false,
      setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn(), destroy: vi.fn(),
    });
    expect(createMmPnlProxy()({ method: "GET", url: "/mm-pnl" + path } as IncomingMessage, response as unknown as ServerResponse)).toBe(true);
    return { outgoing, response };
  }

  it("returns sanitized JSON for a connection failure", () => {
    vi.useFakeTimers();
    const { outgoing, response } = request();
    outgoing.emit("error", new Error("synthetic-secret-credential"));
    expect(response.writeHead).toHaveBeenCalledWith(502, { "Content-Type": "application/json; charset=utf-8" });
    expect(JSON.parse(response.end.mock.calls[0][0])).toEqual({ error: message });
  });

  it("cancels upstream and its timer when the client disconnects", () => {
    vi.useFakeTimers();
    const { outgoing, response } = request();
    response.destroyed = true; response.emit("close");
    expect(outgoing.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0); expect(response.end).not.toHaveBeenCalled();
  });

  it("keeps the 95s deadline and returns JSON 504 without a real wait", () => {
    vi.useFakeTimers();
    const { response, outgoing } = request();
    vi.advanceTimersByTime(94999);
    expect(response.end).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(outgoing.destroy).toHaveBeenCalledOnce();
    expect(response.writeHead).toHaveBeenCalledWith(504, { "Content-Type": "application/json; charset=utf-8" });
    expect(JSON.parse(response.end.mock.calls[0][0])).toEqual({ error: message });
  });
});

describe("MM PnL proxy loopback HTTP integration (declared budget 1s per case)", () => {
  const realGet = http.get;
  let status = 500;
  let upstreamPort: number;
  let proxyPort: number;
  let receivedHeaders: IncomingMessage["headers"];
  let receivedUrl: string | undefined;
  const upstream = http.createServer((req, res) => {
    receivedHeaders = req.headers; receivedUrl = req.url;
    res.writeHead(status, { "Content-Type": status === 200 ? "application/json" : "text/plain", Location: "https://untrusted.invalid/private", "X-Private": "synthetic-secret" });
    res.end(status === 200 ? JSON.stringify({ value: 7 }) : "synthetic-private-upstream-body");
  });
  const handler = createMmPnlProxy();
  const proxy = http.createServer((req, res) => { if (!handler(req, res)) { res.writeHead(404); res.end(); } });
  beforeAll(async () => {
    await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
    await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
    upstreamPort = (upstream.address() as { port: number }).port;
    proxyPort = (proxy.address() as { port: number }).port;
  });
  afterAll(async () => {
    proxy.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => proxy.close(() => resolve())), new Promise<void>(resolve => upstream.close(() => resolve()))]);
  });
  beforeEach(() => {
    vi.spyOn(http, "get").mockImplementation(((options: RequestOptions, callback: (res: IncomingMessage) => void) => {
      expect(options.hostname).toBe("127.0.0.1"); expect(options.port).toBe(8768);
      expect(options.headers).toBeUndefined();
      return realGet({ ...options, port: upstreamPort }, callback);
    }) as typeof http.get);
  });

  it.each([400, 500, 503, 504, 507])("preserves API HTTP %i with a fixed JSON error", async upstreamStatus => {
    status = upstreamStatus;
    const response = await fetch(`http://127.0.0.1:${proxyPort}/mm-pnl/api/pnl?strategy=MMRPI&start=1&end=2`, {
      headers: { Cookie: "synthetic-cookie", Authorization: "Bearer synthetic-token", "x-office-proxy-token": "synthetic-identity" }, redirect: "manual",
    });
    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await response.json()).toEqual({ error: message });
    expect(response.headers.get("location")).toBeNull(); expect(response.headers.get("x-private")).toBeNull();
    expect(receivedHeaders.cookie).toBeUndefined(); expect(receivedHeaders.authorization).toBeUndefined(); expect(receivedHeaders["x-office-proxy-token"]).toBeUndefined();
    expect(receivedUrl).toBe("/api/pnl?strategy=MMRPI&start=1&end=2");
  }, 1000);

  it("rejects redirects as JSON 502 without a Location", async () => {
    status = 302;
    const response = await fetch(`http://127.0.0.1:${proxyPort}/mm-pnl/api/config`, { redirect: "manual" });
    expect(response.status).toBe(502); expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual({ error: message });
  }, 1000);

  it("keeps successful API JSON unchanged", async () => {
    status = 200;
    const response = await fetch(`http://127.0.0.1:${proxyPort}/mm-pnl/api/pnl`);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ value: 7 });
  }, 1000);

  it("preserves the existing static failure response", async () => {
    status = 500;
    const response = await fetch(`http://127.0.0.1:${proxyPort}/mm-pnl/live.js`);
    expect(response.status).toBe(502); expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe(message);
  }, 1000);
});
