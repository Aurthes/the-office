import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultStudioSettings, sanitizeStudioSettings } from "@/lib/studio/settings";
import { StudioSettingsCoordinator, createStudioSettingsCoordinator } from "@/lib/studio/coordinator";

describe("StudioSettingsCoordinator", () => {
  const createResponse = () => ({
    settings: sanitizeStudioSettings(defaultStudioSettings()),
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("releases a stalled settings write so later flushes and saves can proceed without replay", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error("Settings request timed out")), ms);
      return controller.signal;
    });
    const fetch = vi.fn((_url: unknown, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetch);
    const coordinator = createStudioSettingsCoordinator();
    const failed = expect(coordinator.applyPatchNow({ gateway: { url: "ws://office" } })).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(19_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); await failed;
    await coordinator.flushPending();
    expect(fetch).toHaveBeenCalledTimes(1); // An uncertain save is not replayed.
    fetch.mockImplementationOnce(async () => ({ ok: true, text: async () => JSON.stringify(createResponse()) }) as Response);
    await coordinator.applyPatchNow({ gateway: { url: "ws://next" } });
    expect(fetch).toHaveBeenCalledTimes(2);
    coordinator.dispose();
  });

  it("coalesces multiple scheduled patches into one update", async () => {
    const fetchSettings = vi.fn(async () => createResponse());
    const updateSettings = vi.fn(async () => createResponse());
    const coordinator = new StudioSettingsCoordinator({ fetchSettings, updateSettings }, 300);

    coordinator.schedulePatch({
      gateway: { url: "ws://localhost:18789", token: "abc" },
    });
    coordinator.schedulePatch({
      focused: {
        "ws://localhost:18789": {
          mode: "focused",
          filter: "running",
          selectedAgentId: null,
        },
      },
    });

    await vi.advanceTimersByTimeAsync(300);

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({
      gateway: { url: "ws://localhost:18789", token: "abc" },
      focused: {
        "ws://localhost:18789": {
          mode: "focused",
          filter: "running",
          selectedAgentId: null,
        },
      },
    });

    coordinator.dispose();
  });

  it("merges queued gateway patches field-by-field before flushing", async () => {
    const fetchSettings = vi.fn(async () => createResponse());
    const updateSettings = vi.fn(async () => createResponse());
    const coordinator = new StudioSettingsCoordinator({ fetchSettings, updateSettings }, 300);

    coordinator.schedulePatch(
      {
        gateway: {
          lastKnownGood: {
            url: "ws://localhost:18789",
            token: undefined,
            adapterType: "openclaw",
          },
        },
      },
      300,
    );
    coordinator.schedulePatch(
      {
        gateway: {
          url: "ws://localhost:28789",
          adapterType: "demo",
          profiles: {
            demo: {
              url: "ws://localhost:28789",
              token: undefined,
            },
          },
        },
      },
      300,
    );

    await vi.advanceTimersByTimeAsync(300);

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({
      gateway: {
        url: "ws://localhost:28789",
        adapterType: "demo",
        profiles: {
          demo: {
            url: "ws://localhost:28789",
            token: undefined,
          },
        },
        lastKnownGood: {
          url: "ws://localhost:18789",
          token: undefined,
          adapterType: "openclaw",
        },
      },
    });

    coordinator.dispose();
  });

  it("merges queued gateway profile and last-known-good subpatches", async () => {
    const fetchSettings = vi.fn(async () => createResponse());
    const updateSettings = vi.fn(async () => createResponse());
    const coordinator = new StudioSettingsCoordinator({ fetchSettings, updateSettings }, 300);

    coordinator.schedulePatch({
      gateway: {
        profiles: {
          demo: {
            url: "ws://localhost:18888",
            token: undefined,
          },
        },
        lastKnownGood: {
          url: "ws://localhost:18789",
          token: "stored-token",
        },
      },
    });
    coordinator.schedulePatch({
      gateway: {
        profiles: {
          demo: {
            token: "new-token",
          },
        },
        lastKnownGood: {
          adapterType: "openclaw",
        },
      },
    });

    await vi.advanceTimersByTimeAsync(300);

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({
      gateway: {
        profiles: {
          demo: {
            url: "ws://localhost:18888",
            token: "new-token",
          },
        },
        lastKnownGood: {
          url: "ws://localhost:18789",
          token: "stored-token",
          adapterType: "openclaw",
        },
      },
    });

    coordinator.dispose();
  });

  it("flushPending persists queued patch immediately", async () => {
    const fetchSettings = vi.fn(async () => createResponse());
    const updateSettings = vi.fn(async () => createResponse());
    const coordinator = new StudioSettingsCoordinator({ fetchSettings, updateSettings }, 1000);

    coordinator.schedulePatch({
      gateway: { url: "ws://localhost:18789", token: "session-a" },
    });

    await coordinator.flushPending();

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({
      gateway: { url: "ws://localhost:18789", token: "session-a" },
    });

    await vi.advanceTimersByTimeAsync(2000);
    expect(updateSettings).toHaveBeenCalledTimes(1);

    coordinator.dispose();
  });

  it("dispose clears pending timer without writing", async () => {
    const fetchSettings = vi.fn(async () => createResponse());
    const updateSettings = vi.fn(async () => createResponse());
    const coordinator = new StudioSettingsCoordinator({ fetchSettings, updateSettings }, 200);

    coordinator.schedulePatch({
      focused: {
        "ws://localhost:18789": {
          mode: "focused",
          filter: "approvals",
          selectedAgentId: null,
        },
      },
    });
    coordinator.dispose();

    await vi.advanceTimersByTimeAsync(500);

    expect(updateSettings).not.toHaveBeenCalled();
  });
});
