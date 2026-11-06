import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("Office build defaults", () => {
  it.each([undefined, ""])("uses the spaceship when the mode is not configured (%s)", async value => {
    vi.stubEnv("NEXT_PUBLIC_CLAW3D_SESSION_VIEW", value);
    vi.stubEnv("NEXT_PUBLIC_CLAW3D_WEB_ACCESS", undefined);
    const { default: config } = await import("../../next.config");
    expect(config.env).toMatchObject({ NEXT_PUBLIC_CLAW3D_SESSION_VIEW: "1", NEXT_PUBLIC_CLAW3D_WEB_ACCESS: "0" });
  });

  it.each(["0", "1"])("preserves an explicit mode (%s)", async value => {
    vi.stubEnv("NEXT_PUBLIC_CLAW3D_SESSION_VIEW", value);
    const { default: config } = await import("../../next.config");
    expect(config.env?.NEXT_PUBLIC_CLAW3D_SESSION_VIEW).toBe(value);
  });
});
