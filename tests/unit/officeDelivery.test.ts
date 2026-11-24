// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
const { OfficeDelivery, hash } = createRequire(import.meta.url)("../../server/office-delivery.js");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "office-delivery-")); roots.push(directory);
  let idle = false;
  type Source = { id: string; recipient: string; sender?: { id: string; name?: string }; message?: string; context?: Record<string, unknown>; taskId?: string; phaseId?: string; handoffId?: string; createdAt?: number; state: string; hash: string; error?: string };
  const sources: Source[] = [];
  const send = vi.fn<(recipient: string, message: string, requestId: string, context: { taskId?: string; deliveries: Array<Record<string, unknown>> }, urgent: boolean) => Promise<{ status: string; turnId: string }>>(async () => ({ status: "started", turnId: "turn" }));
  const update = vi.fn((member, state, error) => { const source = sources.find(row => row.id === member.id); if (source) Object.assign(source, { state, error }); });
  const options = { directory, sources: () => sources, update, canSend: async () => idle, send, receipt: vi.fn<(recipient: string, requestId: string) => Promise<{ status: string; turnId: string } | null>>(async () => null) };
  const queue = new OfficeDelivery(options);
  const input = (id: string, extra = {}) => ({ requestId: id, recipient: "head", sender: { source: "agent", id: "worker", name: "Worker" }, message: "**From agent: Worker**\n\nresult", ...extra });
  return { directory, sources, send, update, options, queue, input, idle: () => { idle = true; }, busy: () => { idle = false; } };
}
it("persists normal active mail and merges senders and task contexts once, with independent task receipts", async () => {
  const f = fixture();
  const contexts = ["a", "b"].map(taskId => ({ taskId, phaseId: taskId + "-phase", questions: [{ id: taskId + "-q", sources: [{ threadId: "user", turnId: "original", itemId: taskId }] }] }));
  f.queue.enqueue(f.input("one", { context: contexts[0] }));
  const source = { id: "handoff-mail", recipient: "head", sender: { id: "other", name: "Other" }, message: "Second report", context: contexts[1], taskId: "b", phaseId: "b-phase", handoffId: "handoff-b", createdAt: 1, state: "pending" };
  f.sources.push({ ...source, hash: hash(source) });
  await f.queue.flush(); expect(f.send).not.toHaveBeenCalled();
  f.idle(); await f.queue.flush();
  expect(f.send).toHaveBeenCalledTimes(1);
  const args = f.send.mock.calls[0];
  expect(args[1]).toContain("Second report");
  expect(args[3].taskId).toBeUndefined();
  expect(args[3].deliveries).toHaveLength(2);
  expect(args[3].deliveries.find(row => row.deliveryId === "handoff-mail")).toMatchObject({ taskId: "b", phaseId: "b-phase", handoffId: "handoff-b" });
  expect(f.sources[0].state).toBe("sent");
  expect(f.queue.status("worker")[0].status).toBe("sent");
  await f.queue.flush(); expect(f.send).toHaveBeenCalledTimes(1);
});
it("same request retry retains its captured context and detects payload conflicts; urgent requires a concrete reason", async () => {
  const f = fixture();
  f.queue.enqueue(f.input("one", { originalMessage: "result", context: { taskId: "a" } }));
  expect(f.queue.enqueue(f.input("one", { originalMessage: "result", context: { taskId: "new-selection" } })).status).toBe("pending");
  expect(() => f.queue.enqueue(f.input("one", { originalMessage: "different" }))).toThrow("conflict");
  expect(() => f.queue.enqueue(f.input("urgent", { urgency: "urgent" }))).toThrow("urgentReason");
  f.queue.enqueue(f.input("urgent", { urgency: "urgent", urgentReason: "Stop the incorrect deployment now" }));
  await f.queue.flush();
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.send.mock.calls[0][4]).toBe(true);
  expect(f.queue.status("worker").find((row: { deliveryId: string }) => row.deliveryId === "one").status).toBe("pending");
});
it("busy after the idle read restores all claims to pending and preserves the original delivery IDs", async () => {
  const f = fixture(); f.idle();
  f.send.mockResolvedValueOnce({ status: "busy", turnId: "" });
  f.queue.enqueue(f.input("one"));
  await f.queue.flush();
  expect(f.queue.status("worker")[0].status).toBe("pending");
  expect(Object.keys(f.queue.data.batches)).toHaveLength(0);
  await f.queue.flush(); expect(f.queue.status("worker")[0].status).toBe("sent");
});
it("unknown sends stay uncertain across restart and require the exact batch client-ID receipt before marking sent", async () => {
  const f = fixture(); f.idle();
  f.send.mockRejectedValueOnce(new Error("transport timeout"));
  f.queue.enqueue(f.input("one")); await f.queue.flush();
  const id = f.queue.status("worker")[0].batchId;
  f.queue.close();
  const second = new OfficeDelivery(f.options);
  await second.flush(); expect(f.send).toHaveBeenCalledTimes(1);
  expect(second.status("worker")[0].status).toBe("uncertain");
  f.options.receipt.mockImplementation(async (_recipient: string, requestId: string) => requestId === id ? { status: "accepted", turnId: "real" } : null);
  await second.flush(); expect(second.status("worker")[0]).toMatchObject({ status: "sent", result: { turnId: "real" } });
  expect(f.send).toHaveBeenCalledTimes(1);
});
it("restart of a sending ledger does not replay, and a durable sent result repairs partial task-file updates", async () => {
  const f = fixture();
  const member = { id: "task-message", taskId: "task", handoffId: "handoff", hash: "source", state: "sending", recipient: "head" };
  f.sources.push({ ...member });
  const persisted = { version: 1, messages: {}, batches: { batch: { id: "batch", recipient: "head", members: [member], state: "sending" } } };
  writeFileSync(path.join(f.directory, "delivery-inbox.json"), JSON.stringify(persisted));
  const unknown = new OfficeDelivery(f.options); await unknown.flush();
  expect(f.sources[0].state).toBe("uncertain"); expect(f.send).not.toHaveBeenCalled();
  persisted.batches.batch.state = "sent";
  writeFileSync(path.join(f.directory, "delivery-inbox.json"), JSON.stringify(persisted));
  const recovered = new OfficeDelivery(f.options); await recovered.flush();
  expect(f.sources[0].state).toBe("sent"); expect(f.send).not.toHaveBeenCalled();
});
it("arrival during a drain is picked up after its current dispatch, and bounded batches keep the suffix durable", async () => {
  const f = fixture(); f.idle();
  for (let i = 0; i < 10; i++) f.queue.enqueue(f.input("m" + i));
  f.send.mockImplementationOnce(async () => {
    f.busy();
    f.queue.enqueue(f.input("later"));
    return { status: "started", turnId: "one" };
  });
  await f.queue.flush();
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.send.mock.calls[0][3].deliveries).toHaveLength(8);
  expect(f.queue.pending("head")).toHaveLength(3);
  f.queue.close();
  const next = new OfficeDelivery(f.options); f.idle(); await next.flush();
  expect(f.send).toHaveBeenCalledTimes(2);
  expect(next.pending("head")).toHaveLength(0);
});
it("capacity rejection is explicitly unaccepted and a stopped coordinator leaves persisted mail for recovery", async () => {
  const f = fixture(); f.queue.close();
  f.queue.enqueue(f.input("kept"));
  await f.queue.flush(); expect(f.send).not.toHaveBeenCalled();
  for (let i = 1; i < 2048; i++) f.queue.data.messages["m" + i] = { ...f.input("m" + i), state: "pending", sender: { id: "worker" } };
  expect(() => f.queue.enqueue(f.input("overflow"))).toThrow("not accepted");
  expect(f.queue.data.messages.overflow).toBeUndefined();
  const disk = JSON.parse(readFileSync(path.join(f.directory, "delivery-inbox.json"), "utf8"));
  expect(disk.messages.kept.state).toBe("pending");
});

it("does not dispatch a recalled source after its asynchronous readiness check", async () => {
  const f = fixture();
  const source = { id: "mail", taskId: "task", handoffId: "old", recipient: "head", message: "Old request", hash: "old", state: "pending" };
  f.sources.push(source);
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  f.options.canSend = async () => { await pending; return true; };
  const queue = new OfficeDelivery(f.options);
  const drain = queue.flush();
  f.sources.splice(0);
  finish(); await drain;
  expect(f.send).not.toHaveBeenCalled();
});

it("recovered sending task records without a batch identity stay explicitly uncertain", async () => {
  const f = fixture();
  f.sources.push({ id: "old-request", recipient: "head", taskId: "task", handoffId: "old", state: "sending", hash: "old" });
  const queue = new OfficeDelivery(f.options);
  await queue.flush();
  expect(f.sources[0]).toMatchObject({ state: "uncertain", error: expect.stringContaining("pre-batch") });
  expect(f.send).not.toHaveBeenCalled();
});
it("urgent mail does not wait for an earlier normal batch ACK", async () => {
  const f = fixture(); f.idle();
  let finish!: (result: { status: string; turnId: string }) => void;
  f.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  f.queue.enqueue(f.input("normal"));
  await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
  f.queue.enqueue(f.input("urgent", { urgency: "urgent", urgentReason: "Cancel the incorrect cutover now" }));
  await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
  expect(f.send.mock.calls[1][4]).toBe(true);
  finish({ status: "started", turnId: "first" }); await f.queue.flush();
  expect(f.queue.status("worker").every((row: { status: string }) => row.status === "sent")).toBe(true);
});
it("retains a positive ACK when a task receipt write fails, then repairs that file without another send", async () => {
  const f = fixture(); f.idle();
  const source = { id: "task-mail", recipient: "head", taskId: "task", handoffId: "h", hash: "content", state: "pending", message: "result" };
  f.sources.push(source);
  const realUpdate = f.update.getMockImplementation()!;
  f.update.mockImplementation((member, state, error) => {
    if (state === "sent") throw new Error("synthetic task write failure");
    return realUpdate(member, state, error);
  });
  await f.queue.flush(); expect(f.send).toHaveBeenCalledTimes(1);
  const saved = JSON.parse(readFileSync(path.join(f.directory, "delivery-inbox.json"), "utf8"));
  expect(Object.values(saved.batches)).toEqual([expect.objectContaining({ state: "sent", result: { status: "started", turnId: "turn" } })]);
  f.update.mockImplementation(realUpdate); f.queue.close();
  const restored = new OfficeDelivery(f.options); await restored.flush();
  expect(source.state).toBe("sent"); expect(f.send).toHaveBeenCalledTimes(1);
});
it("keeps a response without a turn identity explicitly uncertain rather than declaring delivery", async () => {
  const f = fixture(); f.idle(); f.send.mockResolvedValueOnce({ status: "started", turnId: "" });
  f.queue.enqueue(f.input("one")); await f.queue.flush();
  expect(f.queue.status("worker")[0]).toMatchObject({ status: "uncertain", error: expect.stringContaining("did not identify") });
  await f.queue.flush(); expect(f.send).toHaveBeenCalledTimes(1);
});

it("reclaims delivered payloads while preserving exact deduplication, status and provenance across restart", async () => {
  const f = fixture(); f.idle();
  const context = { taskId: "original-task", questions: [{ id: "q-original", sources: [{ threadId: "user", turnId: "original", itemId: "item", excerpt: "large original text" }] }] };
  f.queue.enqueue(f.input("delivered", { context })); await f.queue.flush();
  expect(Object.keys(f.queue.data.messages)).toHaveLength(0);
  expect(Object.keys(f.queue.data.batches)).toHaveLength(0);
  const receipt = f.queue.archive.get("message", "delivered");
  expect(receipt.message).toBeUndefined();
  expect(receipt.context.questions[0]).toEqual({ id: "q-original", sources: [{ threadId: "user", turnId: "original", itemId: "item" }] });
  f.queue.close(); const next = new OfficeDelivery(f.options);
  expect(next.enqueue(f.input("delivered", { context: { taskId: "different" } }))).toMatchObject({ deliveryState: "sent", turnId: "turn" });
  expect(() => next.enqueue(f.input("delivered", { message: "different payload" }))).toThrow("conflict");
  await next.flush(); expect(f.send).toHaveBeenCalledTimes(1);
  expect(next.status("worker")).toHaveLength(1);
  expect(next.receipts("worker")[0]).toMatchObject({ status: "sent", deliveryIds: ["delivered"] });
});

it("migrates an over-capacity legacy inbox without dropping unresolved deliveries or replaying settled work", async () => {
  const f = fixture(); f.queue.close();
  const data = { version: 1, messages: {} as Record<string, unknown>, batches: {} as Record<string, unknown> };
  for (let i = 0; i < 320; i++) {
    const input = f.input("old" + i, { message: "x".repeat(11000) });
    const row = { ...input, id: input.requestId, hash: hash({ recipient: input.recipient, senderId: input.sender.id, message: input.message, urgency: "normal" }), state: "sent", result: { turnId: "turn" + i }, createdAt: i };
    data.messages[row.id] = row;
    data.batches["b" + i] = { id: "b" + i, recipient: "head", state: "sent", appliedState: "sent", members: [row], result: row.result, createdAt: i };
  }
  const unresolved = { ...f.input("unresolved"), id: "unresolved", hash: "exact", state: "uncertain" };
  data.messages.unresolved = unresolved;
  data.batches.unknown = { id: "unknown", recipient: "head", state: "uncertain", members: [unresolved] };
  const file = path.join(f.directory, "delivery-inbox.json");
  expect(Buffer.byteLength(JSON.stringify(data))).toBeGreaterThan(6 * 1024 * 1024);
  writeFileSync(file, JSON.stringify(data));
  const next = new OfficeDelivery(f.options);
  expect(next.data.messages.unresolved).toEqual(unresolved);
  expect(next.data.batches.unknown).toEqual(data.batches.unknown);
  expect(readFileSync(file).byteLength).toBeLessThan(4096);
  expect(next.enqueue(f.input("new"))).toMatchObject({ status: "queued" });
  expect(next.enqueue(f.input("old0", { message: "x".repeat(11000) }))).toMatchObject({ status: "sent" });
  await next.flush(); expect(f.send).not.toHaveBeenCalled();
});

it("a crash after writing archive but before inbox commit preserves one receipt and no replay", async () => {
  const f = fixture(); f.idle(); f.queue.enqueue(f.input("one")); await f.queue.flush();
  const row = f.queue.archive.get("message", "one"), batch = f.queue.archive.list("batch")[0];
  // The old inbox can still contain the same settled records after a failed rename.
  writeFileSync(path.join(f.directory, "delivery-inbox.json"), JSON.stringify({ version: 1, messages: { one: row }, batches: { [batch.id]: batch } }));
  f.queue.close(); const next = new OfficeDelivery(f.options);
  await next.flush();
  expect(next.status("worker")).toHaveLength(1);
  expect(next.receipts("worker")).toHaveLength(1);
  expect(f.send).toHaveBeenCalledTimes(1);
});

it("archive failure leaves the positive native receipt recoverable and never causes another send", async () => {
  const f = fixture(); f.idle();
  const put = f.queue.archive.put.bind(f.queue.archive);
  f.queue.archive.put = (records: unknown[]) => { if (records.length) throw new Error("archive unavailable"); return put(records); };
  f.queue.enqueue(f.input("one")); await f.queue.flush();
  const persisted = JSON.parse(readFileSync(path.join(f.directory, "delivery-inbox.json"), "utf8"));
  expect(Object.values(persisted.batches)).toEqual([expect.objectContaining({ state: "sent", result: expect.objectContaining({ turnId: "turn" }) })]);
  expect(persisted.messages.one).toBeDefined();
  f.queue.close(); const next = new OfficeDelivery(f.options); await next.flush();
  expect(next.status("worker")[0]).toMatchObject({ status: "sent" });
  expect(Object.keys(next.data.messages)).toHaveLength(0);
  expect(f.send).toHaveBeenCalledTimes(1);
});
