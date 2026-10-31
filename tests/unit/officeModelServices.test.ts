import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
const { createOfficeDictation, suggestNextMessage } = createRequire(import.meta.url)("../../server/office-model-services.js");
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("Office public model services", () => {
  it("sends suggestions through the public Responses API without tools or native tokens", async () => {
    vi.stubEnv("OPENAI_API_KEY", "feature-test-key");
    const fetcher = vi.fn<(url: string, options?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: "What should we test?" }] }] }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await suggestNextMessage([{ role: "user", content: "Fix this issue" }])).toEqual({ text: "What should we test?" });
    expect(fetcher.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.store).toBe(false); expect(body.tools).toBeUndefined();
  });
  it("returns a useful recording-kept error for an HTML response instead of trying JSON.parse", async () => {
    vi.stubEnv("OPENAI_API_KEY", "feature-test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html>", { status: 502, headers: { "content-type": "text/html" } })));
    const handler = createOfficeDictation({ token: "private", findThread: vi.fn() });
    const request = Object.assign(Readable.from([Buffer.from("audio-fixture")]), { headers: { authorization: "Bearer private" }, url: "/dictation?threadId=own" });
    let status = 0, body = "";
    const response = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false, writeHead: (code: number) => { status = code; }, end: (value: string) => { body = value; } });
    await handler(request, response);
    expect(status).toBe(502); expect(JSON.parse(body).error).toContain("unexpected response; recording kept");
  });
});
