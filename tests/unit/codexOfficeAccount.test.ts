// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const { CodexOfficeAccount } = createRequire(import.meta.url)("../../server/codex-office-account.js");
type Account = { account: { type: string; email: string } | null; requiresOpenaiAuth: boolean };
const signedIn: Account = { account: { type: "chatgpt", email: "fixture@example.test" }, requiresOpenaiAuth: true };
const signedOut = { account: null, requiresOpenaiAuth: true };
describe("Office shared account context", () => {
  it("coalesces initialization and reuses identity until an account change", async () => {
    const client = { call: vi.fn(async () => signedIn) }, account = new CodexOfficeAccount(client);
    expect(await Promise.all(Array.from({ length: 10 }, () => account.read()))).toEqual(Array(10).fill(signedIn));
    await account.read(); expect(client.call).toHaveBeenCalledTimes(1);
    expect(client.call).toHaveBeenCalledWith("account/read", { refreshToken: false });
    client.call.mockResolvedValue(signedOut); account.invalidate();
    expect(await account.read()).toEqual(signedOut); expect(client.call).toHaveBeenCalledTimes(2);
  });
  it("does not let an older pending read restore a signed-out account", async () => {
    let finish!: (value: unknown) => void;
    const client = { call: vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(signedOut) };
    const account = new CodexOfficeAccount(client), pending = account.read();
    account.invalidate(); expect(await account.read()).toEqual(signedOut);
    finish(signedIn); expect(await pending).toEqual(signedOut);
    expect(await account.read()).toEqual(signedOut); expect(client.call).toHaveBeenCalledTimes(2);
  });
  it("allows explicit refresh and recovers after a failed read", async () => {
    const client = { call: vi.fn().mockRejectedValueOnce(new Error("Disconnected")).mockResolvedValue(signedIn) };
    const account = new CodexOfficeAccount(client);
    await expect(account.read()).rejects.toThrow("Disconnected");
    expect(await account.read()).toEqual(signedIn);
    client.call.mockResolvedValue(signedOut);
    expect(await account.read({ refresh: true })).toEqual(signedOut);
    expect(client.call).toHaveBeenCalledTimes(3);
  });
});
