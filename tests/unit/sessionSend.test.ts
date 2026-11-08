import { expect, it, vi } from "vitest";
import { sendSessionMessage } from "@/features/office/components/sessionSend";
it.each(["started", "steered"] as const)("shares exact echo identity and retains all original normal-send parameters: %s", async status => {
  const call = vi.fn(async () => ({ status, turnId: "native-turn" })), states = vi.fn(), sync = vi.fn();
  const params = { requestId: "fixed-request", message: "Frozen text", attachments: ["fixture-ref"], references: [{ threadId: "ref" }], purpose: "preserve-future-purpose" };
  await expect(sendSessionMessage({ call }, "thread", params, { onSendState: states, onHistorySync: sync, attachmentNames: ["file"], historyEpoch: "epoch" })).resolves.toEqual({ status, turnId: "native-turn" });
  expect(call).toHaveBeenCalledExactlyOnceWith("session.send", { threadId: "thread", ...params });
  expect(states.mock.calls.map(([, item]) => [item.id, item.clientId, item.delivery])).toEqual([["local-send:fixed-request", "fixed-request", "sending"], ["local-send:fixed-request", "fixed-request", "accepted"]]);
  expect(sync).toHaveBeenCalledOnce(); expect(params.message).toBe("Frozen text"); expect(params.attachments).toEqual(["fixture-ref"]);
});
it.each([
  [Object.assign(Error("Validation rejected"), { code: "INVALID_PARAMS" }), "failed"],
  [Error("Disconnected"), "unknown"],
])("classifies only explicit refusals as failed and never retries", async (cause, delivery) => {
  const call = vi.fn(async () => { throw cause; }), states = vi.fn(), sync = vi.fn();
  await expect(sendSessionMessage({ call }, "thread", { requestId: "id", message: "Text" }, { onSendState: states, onHistorySync: sync })).rejects.toMatchObject({ delivery });
  expect(call).toHaveBeenCalledOnce(); expect(states.mock.calls.at(-1)?.[1].delivery).toBe(delivery); expect(sync).toHaveBeenCalledTimes(delivery === "unknown" ? 1 : 0);
});
it.each([{ status: "busy" }, { status: "steered" }, { status: "cancelled", turnId: "t" }, null])("never accepts an unconfirmed native result %j", async result => {
  const states = vi.fn(); await expect(sendSessionMessage({ call: vi.fn(async () => result) }, "t", { requestId: "id", message: "Text" }, { onSendState: states })).rejects.toMatchObject({ delivery: "unknown" });
  expect(states.mock.calls.at(-1)?.[1].delivery).toBe("unknown");
});
