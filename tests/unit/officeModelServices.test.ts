import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
const { createOfficeDictation } = createRequire(import.meta.url)("../../server/office-model-services.js");
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("Office public model services", () => {
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
