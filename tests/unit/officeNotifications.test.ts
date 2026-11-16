// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { OfficeNotifications, subscription } = require("../../server/office-notifications");
const { PushIdentity, signIdentity, readIdentity } = require("../../server/office-push-identity");
const close: Array<() => unknown> = [];
afterEach(async () => { for (const action of close.splice(0).reverse()) await action(); });
const ownerId = "a".repeat(64);
const identity = { owner: ownerId, device: "11111111-1111-4111-8111-111111111111", origin: "https://office.example", port: 3035 };
const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/fixture", keys: { p256dh: Buffer.alloc(65, 4).toString("base64url"), auth: Buffer.alloc(16, 5).toString("base64url") } };
function fixture(send = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({})), options = {}) {
 const dir = mkdtempSync(path.join(tmpdir(), "office-notify-")); close.push(() => rmSync(dir, { recursive: true, force: true }));
 let now = 1700000000000;
 const owner = vi.fn(async () => ({ owner: ownerId, valid: true }));
 const store = new OfficeNotifications(dir, { actor: (id: string) => ({ head: id === "head", name: "Head" }), now: () => now, send, owner, mergeMs: 1000, ...options });
 close.push(() => store.close());
 return { store, dir, owner, send, advance: (ms: number) => { now += ms; } };
}
const input = { actorId: "head", eventId: "same-result", title: "Ready", brief: "Verified saved result", reason: "result", taskId: "T1" };
it("persists before sending, keeps generic payloads, retries idempotently and replaces the same event", async () => {
 const f = fixture(); await f.store.subscribe(identity, sub);
 const a = await f.store.notify(input); const b = await f.store.notify(input);
 expect(a).toEqual(b); expect(f.send).not.toHaveBeenCalled();
 expect(JSON.parse(readFileSync(path.join(f.dir, "important-notifications.json"), "utf8")).events).toHaveLength(1);
 f.advance(1000); await f.store.flush(); expect(f.send).toHaveBeenCalledTimes(1);
 const [, payload, options] = f.send.mock.calls[0] as unknown as [unknown, string, { topic: string }];
 expect(JSON.parse(payload)).toEqual({ eventId: a.notificationId }); expect(payload).not.toContain(input.brief);
 const c = await f.store.notify({ ...input, brief: "Updated verified result" }); expect(c.notificationId).toBe(a.notificationId); expect(c.version).toBe(2);
 f.advance(1000); await f.store.flush(); expect((f.send.mock.calls[1] as unknown as [unknown, unknown, {topic: string}])[2].topic).toBe(options.topic);
 expect(f.store.detail(identity, a.notificationId).brief).toBe("Updated verified result");
 expect(() => f.store.detail({ ...identity, owner: "b".repeat(64) }, a.notificationId)).toThrow(/unavailable/);
});
it("requires a current Head and validates bounded input without changing ordinary task submission", async () => {
 const f = fixture(); await expect(f.store.notify({ ...input, actorId: "worker" })).rejects.toThrow(/Head/);
 await expect(f.store.notify({ ...input, reason: "progress" })).rejects.toThrow();
 await expect(f.store.notify({ ...input, brief: "x".repeat(2401) })).rejects.toThrow();
 expect(f.send).not.toHaveBeenCalled();
 const { tools } = require("../../server/office-todo-mcp");
 expect(tools.find((t: {name: string}) => t.name === "important_notify").inputSchema.required).toContain("eventId");
 expect(tools.find((t: {name: string}) => t.name === "todo_submit").inputSchema.properties).not.toHaveProperty("notify");
});
it.each(["http://fcm.googleapis.com/a", "https://127.0.0.1/a", "https://fcm.googleapis.com.evil.test/a", "https://fcm.googleapis.com:8443/a", "https://x@y.push.apple.com/a", "https://push.apple.com/a", "https://localhost/a"])("rejects untrusted endpoint %s", endpoint => expect(() => subscription({ ...sub, endpoint })).toThrow());
it.each(["https://web.push.apple.com/a", "https://a1.push.apple.com/a", "https://updates.push.services.mozilla.com/a", "https://foo.notify.windows.com/a"])("accepts real provider family %s", endpoint => expect(subscription({ ...sub, endpoint }).endpoint).toBe(endpoint));
it("binds subscriptions to owner/origin/device; opt-out and revocation prevent subsequent delivery", async () => {
 const f = fixture(); await f.store.subscribe(identity, sub);
 await expect(f.store.subscribe({ ...identity, owner: "b".repeat(64) }, sub)).rejects.toThrow(/another/);
 expect((await f.store.settings({ ...identity, origin: "https://other.example" })).enabled).toBe(false);
 await f.store.notify(input); await f.store.unsubscribe(identity); f.advance(1000); await f.store.flush(); expect(f.send).not.toHaveBeenCalled();
 await f.store.subscribe(identity, sub); await f.store.notify({ ...input, eventId: "second" }); f.owner.mockResolvedValue({ owner: ownerId, valid: false }); f.advance(1000); await f.store.flush(); expect(f.send).not.toHaveBeenCalled(); expect(f.store.data.subscriptions).toHaveLength(0);
});
it.each([404, 410, 403, 429, 503])("handles provider status %i with bounded retry/retirement", async status => {
 const send = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => { throw Object.assign(new Error("private endpoint must never leak"), { statusCode: status }); }); const f = fixture(send);
 await f.store.subscribe(identity, sub); await f.store.notify(input); f.advance(1000); await f.store.flush();
 if ([404, 410].includes(status)) expect(f.store.data.subscriptions).toHaveLength(0);
 else { expect(f.store.data.subscriptions[0].lastError).not.toContain("private"); for (let i=0;i<5;i++) { f.advance(3600000); await f.store.flush(); } expect(send.mock.calls.length).toBe(status === 403 ? 1 : 4); }
});
it("restores pending delivery and stable keys from private storage, without resending accepted versions", async () => {
 const f = fixture(); await f.store.subscribe(identity, sub); const event = await f.store.notify(input); await f.store.close();
 f.advance(1000); const restored = new OfficeNotifications(f.dir, { actor: () => ({head:true}), owner: f.owner, now: () => 1700000001000, send: f.send }); close.push(() => restored.close());
 expect(restored.keys).toEqual(f.store.keys); await restored.flush(); expect(f.send).toHaveBeenCalledTimes(1); await restored.flush(); expect(f.send).toHaveBeenCalledTimes(1);
 expect(restored.detail(identity, event.notificationId).brief).toBe(input.brief);
 expect(statSync(path.join(f.dir,"push-vapid.json")).mode & 0o777).toBe(0o600);
});
it("rechecks version after an in-flight update; late acceptance cannot swallow the newer brief", async () => {
 let resolve!: () => void; const send = vi.fn<(...args: unknown[]) => Promise<unknown>>(() => new Promise<void>(r => { resolve=r; })); const f = fixture(send);
 await f.store.subscribe(identity, sub); await f.store.notify(input); f.advance(1000); const flushing = f.store.flush();
 await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1)); await f.store.notify({ ...input, brief: "New" }); resolve(); await flushing;
 expect(Object.values(f.store.data.events[0].delivery)[0]).not.toHaveProperty("done");
});
it("validates proxy-signed identity and revokes devices across restart and owner changes", () => {
 const f = fixture(); let version="owner-v1"; const p = new PushIdentity(f.dir, () => version); const session: {pushDevice?: string}={}; const device=p.register(session);
 const value={...identity,owner:p.fingerprint(),device}; const signed=signIdentity(value,"s".repeat(40));
 expect(readIdentity(signed,"s".repeat(40))).toEqual(value); expect(readIdentity(signed+"x","s".repeat(40))).toBeNull(); expect(readIdentity(signed,"bad")).toBeNull();
 expect(p.valid(value)).toBe(true); p.revoke(device); expect(new PushIdentity(f.dir,()=>version).valid(value)).toBe(false);
 p.register(session); version="owner-v2"; expect(p.valid({...value,device:session.pushDevice})).toBe(false);
});
it("fails the optional feature closed on corrupt private state without rotating keys or preventing chat startup", async()=>{
 const f=fixture();await f.store.close(); const filename=path.join(f.dir,"important-notifications.json");
 const {writeFileSync}=await import("node:fs");writeFileSync(filename,"broken");
 const restored=new OfficeNotifications(f.dir,{actor:()=>({head:true}),owner:f.owner});close.push(()=>restored.close());
 await expect(restored.notify(input)).rejects.toThrow(/storage is unavailable/);expect(readFileSync(filename,"utf8")).toBe("broken");expect(restored.keys).toEqual(f.store.keys);
});
it("rebinds an existing subscription after website re-login without duplicating delivery or moving it across active owners",async()=>{
 const f=fixture();await f.store.subscribe(identity,sub);
 const renewed={...identity,device:"22222222-2222-4222-8222-222222222222"};await f.store.subscribe(renewed,sub);
 expect(f.store.data.subscriptions).toHaveLength(1);expect((await f.store.settings(identity)).enabled).toBe(false);expect((await f.store.settings(renewed)).enabled).toBe(true);
 await f.store.notify(input);f.advance(1000);await f.store.flush();expect(f.send).toHaveBeenCalledTimes(1);
});
