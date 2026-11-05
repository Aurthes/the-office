import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { createOfficeDictation } = createRequire(import.meta.url)("../../server/office-model-services.js");
const cleanups: (() => void)[] = [];
const json = (text = "transcribed words") => Response.json({ text });
function fixture(options: Record<string, unknown> = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "office-dictation-test-"));
  const writeAuth = (accessToken = "office-test-token") => fs.writeFileSync(path.join(home, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: accessToken, account_id: "office-test-account" } }));
  writeAuth();
  const onStatus = vi.fn();
  const handler = createOfficeDictation({ token: "private", findThread: vi.fn(), home, onStatus, ...options });
  cleanups.push(() => { handler.close(); fs.rmSync(home, { recursive: true, force: true }); });
  function request(audio = Buffer.from("synthetic-audio"), authorization = "Bearer private") {
    const req = Object.assign(Readable.from([audio]), { headers: { authorization }, url: "/dictation?threadId=own" });
    const res = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false, status: 0, body: "",
      writeHead(code: number) { this.status = code; }, end(value: string) { this.body = value; this.writableEnded = true; } });
    return { res, run: () => handler(req, res) };
  }
  return { home, writeAuth, handler, onStatus, request };
}
beforeEach(() => { vi.stubEnv("OPENAI_API_KEY", ""); });
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("Office standalone dictation", () => {
  it("uses only Office login credentials and the fixed standalone endpoint, returning only text", async () => {
    const fetcher = vi.fn(async () => json("今天下午三点开会。")); vi.stubGlobal("fetch", fetcher);
    const f = fixture(), r = f.request(); await r.run();
    expect(r.res.status).toBe(200); expect(JSON.parse(r.res.body)).toEqual({ text: "今天下午三点开会。" });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://chatgpt.com/backend-api/transcribe"); expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({ Authorization: "Bearer office-test-token", "ChatGPT-Account-Id": "office-test-account" });
    const form = init.body as FormData; expect(form.get("file")).toBeInstanceOf(Blob); expect(form.has("model")).toBe(false);
    expect(f.onStatus).toHaveBeenLastCalledWith({ dictation: true, dictationReason: null, dictationRetryAt: null });
  });
  it("preserves an explicitly configured public API provider without falling back to account auth", async () => {
    vi.stubEnv("OPENAI_API_KEY", "explicit-api-key");
    const fetcher = vi.fn(async () => json()); vi.stubGlobal("fetch", fetcher);
    const f = fixture(), r = f.request(); await r.run();
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions"); expect(init.headers).toEqual({ Authorization: "Bearer explicit-api-key" });
    expect((init.body as FormData).get("model")).toBe("gpt-transcribe");
  });
  it("disables missing or malformed Office auth and recovers after sign-in without restarting", async () => {
    const fetcher = vi.fn(async () => json()); vi.stubGlobal("fetch", fetcher);
    const f = fixture(); fs.writeFileSync(path.join(f.home, "auth.json"), "broken auth"); f.handler.refresh();
    expect(f.onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ dictation: false, dictationReason: expect.stringContaining("Sign in") }));
    const r = f.request(); await r.run(); expect(r.res.status).toBe(503); expect(fetcher).not.toHaveBeenCalled();
    f.writeAuth(); f.handler.refresh({ reset: true });
    const next = f.request(); await next.run(); expect(next.res.status).toBe(200);
  });
  it.each([
    ["HTML", () => new Response("<!doctype html>upstream private detail", { headers: { "content-type": "text/html" } })],
    ["malformed JSON", () => new Response("broken", { headers: { "content-type": "application/json" } })],
    ["changed schema", () => Response.json({ unexpected: "upstream private detail" })],
    ["forbidden", () => new Response("upstream private detail", { status: 403 })],
    ["removed route", () => new Response("upstream private detail", { status: 404 })],
    ["server error", () => new Response("upstream private detail", { status: 500 })],
  ])("greys the capability on %s and lets the user retry after cooldown, with no automatic upload", async (_label, response) => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementationOnce(async () => response()).mockImplementation(async () => json("recovered")); vi.stubGlobal("fetch", fetcher);
    const f = fixture(), r = f.request(); await r.run();
    expect(r.res.status).toBe(503); expect(r.res.body).toContain("Recording kept"); expect(r.res.body).not.toContain("upstream private detail");
    expect(f.onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ dictation: false, dictationRetryAt: Date.now() + 60000 }));
    const blocked = f.request(); await blocked.run(); expect(fetcher).toHaveBeenCalledOnce(); expect(blocked.res.status).toBe(503);
    await vi.advanceTimersByTimeAsync(60000); expect(fetcher).toHaveBeenCalledOnce();
    expect(f.onStatus).toHaveBeenLastCalledWith({ dictation: true, dictationReason: null, dictationRetryAt: null });
    const next = f.request(); await next.run(); expect(next.res.status).toBe(200); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("respects a bounded rate-limit Retry-After", async () => {
    vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429, headers: { "retry-after": "120" } })));
    const f = fixture(), r = f.request(); await r.run();
    expect(f.onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ dictation: false, dictationRetryAt: Date.now() + 120000 }));
    await vi.advanceTimersByTimeAsync(60000); expect(f.onStatus.mock.calls.at(-1)![0].dictation).toBe(false);
    await vi.advanceTimersByTimeAsync(60000); expect(f.onStatus.mock.calls.at(-1)![0].dictation).toBe(true);
  });
  it("refreshes an unauthorized login once through the Office client and reads the updated token", async () => {
    const refreshAuth = vi.fn(async () => { f.writeAuth("renewed-office-token"); });
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("unauthorized", { status: 401 })).mockResolvedValueOnce(json()); vi.stubGlobal("fetch", fetcher);
    const f = fixture({ refreshAuth }); const r = f.request(); await r.run();
    expect(r.res.status).toBe(200); expect(refreshAuth).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe("Bearer renewed-office-token");
  });
  it("does not loop on persistent auth failures or expose upstream errors", async () => {
    const refreshAuth = vi.fn(async () => {}), fetcher = vi.fn(async () => new Response("office-test-token private error", { status: 401 })); vi.stubGlobal("fetch", fetcher);
    const f = fixture({ refreshAuth }), r = f.request(); await r.run();
    expect(fetcher).toHaveBeenCalledTimes(2); expect(refreshAuth).toHaveBeenCalledOnce();
    expect(r.res.status).toBe(503); expect(r.res.body).not.toContain("office-test-token");
    expect(f.onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ dictation: false, dictationReason: expect.stringContaining("Sign in") }));
  });
  it("renews an expired token before uploading audio", async () => {
    const expired = "header." + Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url") + ".signature";
    const refreshAuth = vi.fn(async () => { f.writeAuth("renewed-token"); });
    const fetcher = vi.fn(async () => json()); vi.stubGlobal("fetch", fetcher); const f = fixture({ refreshAuth }); f.writeAuth(expired);
    const r = f.request(); await r.run(); expect(refreshAuth).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1]; expect(init.headers).toMatchObject({ Authorization: "Bearer renewed-token" });
  });
  it.each([400, 413, 422, 200])("keeps a recording error local rather than disabling dictation (HTTP %s)", async status => {
    vi.stubGlobal("fetch", vi.fn(async () => status === 200 ? json(" ") : new Response("bad audio", { status })));
    const f = fixture(), r = f.request(); await r.run();
    expect(r.res.status).toBe(422); expect(f.onStatus).toHaveBeenCalledOnce(); expect(f.onStatus.mock.calls[0][0].dictation).toBe(true);
  });
  it("does not disable the capability for rejected local requests", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); const f = fixture();
    const unauthorized = f.request(undefined, "Bearer wrong"); await unauthorized.run(); expect(unauthorized.res.status).toBe(401);
    const empty = f.request(Buffer.alloc(0)); await empty.run(); expect(empty.res.status).toBe(400);
    const large = f.request(Buffer.alloc(20 * 1024 * 1024 + 1)); await large.run(); expect(large.res.status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled(); expect(f.onStatus).toHaveBeenCalledOnce();
  });
  it("bounds concurrency and does not re-enable an outage on an older request's success", async () => {
    const resolve: ((r: Response) => void)[] = []; vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(r => { resolve.push(r); })));
    const f = fixture(), a = f.request(), b = f.request(); const first = a.run(), second = b.run();
    await vi.waitFor(() => expect(resolve).toHaveLength(2)); const busy = f.request(); await busy.run(); expect(busy.res.status).toBe(429);
    resolve[1](new Response("outage", { status: 503 })); await second; resolve[0](json()); await first;
    expect(a.res.status).toBe(200); expect(f.onStatus.mock.calls.at(-1)![0].dictation).toBe(false);
  });
  it("cancels an abandoned upload without disabling dictation or inserting a response", async () => {
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)))));
    const f = fixture(), r = f.request(); const pending = r.run(); await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    r.res.destroyed = true; r.res.emit("close"); await pending;
    expect(r.res.body).toBe(""); expect(f.onStatus).toHaveBeenCalledOnce();
  });
  it("turns network failures into a sanitized recoverable outage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("office-test-token accidental network detail"); }));
    const f = fixture(), r = f.request(); await r.run();
    expect(r.res.status).toBe(503); expect(r.res.body).not.toMatch(/office-test-token|accidental/);
    expect(f.onStatus.mock.calls.at(-1)![0].dictation).toBe(false);
  });
  it("bounds an unresponsive upstream and makes the timeout recoverable", async () => {
    const deadline = new AbortController(); const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)))));
    const f = fixture(), r = f.request(); const pending = r.run(); await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    deadline.abort(new DOMException("timeout private detail", "TimeoutError")); await pending;
    expect(timeout).toHaveBeenCalledWith(60000); expect(r.res.status).toBe(503); expect(r.res.body).not.toContain("private detail");
    expect(f.onStatus.mock.calls.at(-1)![0].dictation).toBe(false);
  });
});
