// @vitest-environment node
import { describe, expect, it } from "vitest";
const { createProxyBoundary, createRequestPolicy } = await import("../../server/proxy-boundary");
const token = "fixture-proxy-secret-".repeat(3);
const publicOrigins = ["https://office.example", "https://backup.example"];
const request = (host = "office.example", origin: string | undefined = "https://office.example", secret: string | undefined = token) => ({
  headers: { host, ...(origin ? { origin } : {}), ...(secret ? { "x-office-proxy-token": secret } : {}) }, socket: { localPort: 3033 },
});

describe("public proxy boundary", () => {
  it("rejects the audit's matching malicious Host/Origin pair and direct unauthenticated backend access", () => {
    const check = createProxyBoundary({ token, publicOrigins, required: true });
    expect(check(request("attacker.invalid", "https://attacker.invalid", undefined))).toBe(403);
    expect(check(request("127.0.0.1:3033", "http://127.0.0.1:3033", ""))).toBe(401);
    expect(check(request("office.example", "https://office.example", "wrong"))).toBe(401);
    expect(check(request("office.example", "https://office.example", ""), true)).toBe(401);
    expect(check(request("office.example", ""), true)).toBe(403);
  });
  it("allows only the authenticated proxy and exact trusted origins, including the backup hostname", () => {
    const check = createProxyBoundary({ token, publicOrigins, required: true });
    expect(check(request())).toBe(0);
    expect(check(request("backup.example", "https://backup.example"), true)).toBe(0);
    expect(check(request("127.0.0.1:3033", "http://127.0.0.1:3033"), true)).toBe(0);
    expect(check(request("office.example", "http://office.example"))).toBe(403);
    expect(check(request("office.example", "https://backup.example"))).toBe(403);
    expect(check(request("office.example", "null"))).toBe(403);
    expect(check(request("office.example.evil.invalid", "https://office.example.evil.invalid"))).toBe(403);
    expect(check(request("office.example@evil.invalid", ""))).toBe(403);
  });
  it("fails closed when public-mode configuration is absent or malformed", () => {
    expect(() => createProxyBoundary({ required: true })).toThrow();
    expect(() => createProxyBoundary({ required: true, token: "short", publicOrigins })).toThrow();
    expect(() => createProxyBoundary({ token, publicOrigins: [] })).toThrow();
    for (const origin of ["http://office.example", "https://u:p@office.example", "https://office.example/path", "https://office.example/?q=1"]) {
      expect(() => createRequestPolicy([origin])).toThrow();
    }
  });
  it("keeps local-only development usable while rejecting untrusted DNS aliases", () => {
    const check = createProxyBoundary();
    expect(check(request("127.0.0.1:3033", "", ""))).toBe(0);
    expect(check(request("localhost:3033", "http://localhost:3033", ""), true)).toBe(0);
    expect(check(request("attacker.invalid:3033", "http://attacker.invalid:3033", ""))).toBe(403);
    expect(check(request("127.0.0.1:9999", "", ""))).toBe(403);
  });
});
