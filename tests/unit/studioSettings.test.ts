import { describe, expect, it } from "vitest";
import { createDefaultAgentAvatarProfile } from "@/lib/avatars/profile";
import {
  defaultStudioSettings,
  defaultStudioFloorRuntimeState,
  mergeStudioSettings,
  normalizeStudioSettings,
  resolveStudioGatewayProfiles,
  resolveStudioActiveFloorId,
  resolveStudioFloorRuntimeState,
} from "@/lib/studio/settings";

describe("studio settings normalization", () => {
  it("loads existing settings while discarding retired voice reply preferences", () => {
    const settings = defaultStudioSettings();
    const expected = normalizeStudioSettings(settings);
    expect(normalizeStudioSettings({ ...settings, voiceReplies: {
      "ws://localhost:18789": { enabled: true, provider: "elevenlabs", voiceId: "old-voice", speed: 1.2 },
    } })).toEqual(expected);
  });
  it("returns defaults for empty input", () => {
    const normalized = normalizeStudioSettings(null);
    expect(normalized.version).toBe(1);
    expect(normalized.gateway).toBeNull();
    expect(normalized.activeFloorId).toBe("lobby");
    expect(normalized.focused).toEqual({});
    expect(normalized.avatars).toEqual({});
    expect(normalized.office).toEqual({});
  });

  it("normalizes gateway entries", () => {
    const normalized = normalizeStudioSettings({
      gateway: { url: " ws://localhost:18789 ", token: " token " },
    });

    expect(normalized.gateway?.url).toBe("ws://localhost:18789");
    expect(normalized.gateway?.token).toBe("token");
  });

  it("normalizes loopback ip gateway urls to localhost", () => {
    const normalized = normalizeStudioSettings({
      gateway: { url: "ws://127.0.0.1:18789", token: "token" },
    });

    expect(normalized.gateway?.url).toBe("ws://localhost:18789");
  });

  it("normalizes_dual_mode_preferences", () => {
    const normalized = normalizeStudioSettings({
      focused: {
        " ws://localhost:18789 ": {
          mode: "focused",
          selectedAgentId: " agent-2 ",
          filter: "running",
        },
        bad: {
          mode: "nope",
          selectedAgentId: 12,
          filter: "bad-filter",
        },
      },
    });

    expect(normalized.focused["ws://localhost:18789"]).toEqual({
      mode: "focused",
      selectedAgentId: "agent-2",
      filter: "running",
    });
    expect(normalized.focused.bad).toEqual({
      mode: "focused",
      selectedAgentId: null,
      filter: "all",
    });
  });

  it("normalizes_legacy_idle_filter_to_approvals", () => {
    const normalized = normalizeStudioSettings({
      focused: {
        "ws://localhost:18789": {
          mode: "focused",
          selectedAgentId: "agent-1",
          filter: "idle",
        },
      },
    });

    expect(normalized.focused["ws://localhost:18789"]).toEqual({
      mode: "focused",
      selectedAgentId: "agent-1",
      filter: "approvals",
    });
  });

  it("merges_dual_mode_preferences", () => {
    const current = normalizeStudioSettings({
      focused: {
        "ws://localhost:18789": {
          mode: "focused",
          selectedAgentId: "main",
          filter: "all",
        },
      },
    });

    const merged = mergeStudioSettings(current, {
      focused: {
        "ws://localhost:18789": {
          filter: "approvals",
        },
      },
    });

    expect(merged.focused["ws://localhost:18789"]).toEqual({
      mode: "focused",
      selectedAgentId: "main",
      filter: "approvals",
    });
  });

  it("normalizes avatar seeds per gateway", () => {
    const normalized = normalizeStudioSettings({
      avatars: {
        " ws://localhost:18789 ": {
          " agent-1 ": " seed-1 ",
          " agent-2 ": " ",
        },
        bad: "nope",
      },
    });

    expect(normalized.avatars["ws://localhost:18789"]?.["agent-1"]?.seed).toBe("seed-1");
  });

  it("merges avatar patches", () => {
    const firstProfile = createDefaultAgentAvatarProfile("seed-1");
    const replacementProfile = createDefaultAgentAvatarProfile("seed-2");
    const secondProfile = createDefaultAgentAvatarProfile("seed-3");
    const current = normalizeStudioSettings({
      avatars: {
        "ws://localhost:18789": {
          "agent-1": firstProfile,
        },
      },
    });

    const merged = mergeStudioSettings(current, {
      avatars: {
        "ws://localhost:18789": {
          "agent-1": replacementProfile,
          "agent-2": secondProfile,
        },
      },
    });

    expect(merged.avatars["ws://localhost:18789"]?.["agent-1"]?.seed).toBe("seed-2");
    expect(merged.avatars["ws://localhost:18789"]?.["agent-2"]?.seed).toBe("seed-3");
  });

  it("normalizes office title preferences per gateway", () => {
    const normalized = normalizeStudioSettings({
      office: {
        " ws://localhost:18789 ": {
          title: "  Team Orbit  ",
        },
        bad: {
          title: "",
        },
      },
    });

    expect(normalized.office["ws://localhost:18789"]).toEqual(
      expect.objectContaining({
        title: "Team Orbit",
      }),
    );
    expect(normalized.office.bad).toEqual(
      expect.objectContaining({
        title: "Luke Headquarters",
      }),
    );
  });

  it("merges office title patches", () => {
    const current = normalizeStudioSettings({
      office: {
        "ws://localhost:18789": {
          title: "Luke Headquarters",
        },
      },
    });

    const merged = mergeStudioSettings(current, {
      office: {
        "ws://localhost:18789": {
          title: "Orbit Control",
        },
      },
    });

    expect(merged.office["ws://localhost:18789"]).toEqual(
      expect.objectContaining({
        title: "Orbit Control",
      }),
    );
  });

  it("creates default per-floor runtime state", () => {
    const normalized = normalizeStudioSettings(null);

    expect(normalized.officeFloors["openclaw-ground"]).toEqual(
      expect.objectContaining({
        floorId: "openclaw-ground",
        provider: "openclaw",
        runtimeProfileId: "openclaw-default",
        gatewayUrl: null,
        status: "disconnected",
      }),
    );
  });

  it("normalizes and merges per-floor runtime state", () => {
    const normalized = normalizeStudioSettings({
      officeFloors: {
        "openclaw-ground": {
          runtimeProfileId: " demo-pi ",
          gatewayUrl: " ws://127.0.0.1:18789 ",
          status: "connected",
          lastKnownGoodAt: 1234,
          lastErrorCode: " ignored ",
          lastErrorMessage: " ignored ",
        },
      },
    });

    expect(normalized.officeFloors["openclaw-ground"]).toEqual(
      expect.objectContaining({
        floorId: "openclaw-ground",
        provider: "openclaw",
        runtimeProfileId: "demo-pi",
        gatewayUrl: "ws://localhost:18789",
        status: "connected",
        lastKnownGoodAt: 1234,
        lastErrorCode: "ignored",
        lastErrorMessage: "ignored",
      }),
    );

    const merged = mergeStudioSettings(normalized, {
      officeFloors: {
        "openclaw-ground": {
          status: "error",
          lastErrorCode: "connect_timeout",
          lastErrorMessage: "Timed out connecting",
        },
      },
    });

    expect(merged.officeFloors["openclaw-ground"]).toEqual(
      expect.objectContaining({
        runtimeProfileId: "demo-pi",
        gatewayUrl: "ws://localhost:18789",
        status: "error",
        lastErrorCode: "connect_timeout",
        lastErrorMessage: "Timed out connecting",
      }),
    );
  });

  it("resolves floor runtime state with fallback", () => {
    const normalized = normalizeStudioSettings(null);

    expect(resolveStudioFloorRuntimeState(normalized, "training")).toEqual(
      defaultStudioFloorRuntimeState("training"),
    );
  });

  it("normalizes and merges active floor selection", () => {
    const normalized = normalizeStudioSettings({
      activeFloorId: "openclaw-ground",
    });
    expect(resolveStudioActiveFloorId(normalized)).toBe("openclaw-ground");

    const merged = mergeStudioSettings(normalized, {
      activeFloorId: "training",
    });
    expect(resolveStudioActiveFloorId(merged)).toBe("lobby");
  });

  it("resolves simultaneous runtime profiles without collapsing them to one active url", () => {
    const resolved = resolveStudioGatewayProfiles({
      gateway: normalizeStudioSettings({
        gateway: {
          url: "ws://localhost:28789",
          token: "",
          adapterType: "demo",
          profiles: {
            openclaw: { url: "ws://localhost:18789", token: "open-token" },
              },
        },
      }).gateway,
      localDefaults: null,
    });

    expect(resolved.selectedAdapterType).toBe("demo");
    expect(resolved.activeProfile).toEqual({
      url: "ws://localhost:28789",
      token: "",
    });
    expect(resolved.profiles).toEqual(
      expect.objectContaining({
        openclaw: { url: "ws://localhost:18789", token: "open-token" },
        demo: { url: "ws://localhost:28789", token: "" },
      }),
    );
  });

  it("merging lastKnownGood with an empty-string token does not overwrite a stored token", () => {
    const current = normalizeStudioSettings({
      gateway: {
        url: "ws://localhost:18789",
        token: "stored-token",
        lastKnownGood: {
          url: "ws://localhost:18789",
          token: "stored-token",
          adapterType: "openclaw",
        },
      },
    });

    const merged = mergeStudioSettings(current, {
      gateway: {
        lastKnownGood: {
          url: "ws://localhost:18789",
          token: "",
          adapterType: "openclaw",
        },
      },
    });

    expect(merged.gateway?.lastKnownGood?.token).toBe("stored-token");
  });

  it("merging lastKnownGood with a real token overwrites the stored token", () => {
    const current = normalizeStudioSettings({
      gateway: {
        url: "ws://localhost:18789",
        token: "old-token",
        lastKnownGood: {
          url: "ws://localhost:18789",
          token: "old-token",
          adapterType: "openclaw",
        },
      },
    });

    const merged = mergeStudioSettings(current, {
      gateway: {
        lastKnownGood: {
          url: "ws://localhost:18789",
          token: "new-token",
          adapterType: "openclaw",
        },
      },
    });

    expect(merged.gateway?.lastKnownGood?.token).toBe("new-token");
  });

  it("merging lastKnownGood with undefined token leaves the stored token unchanged", () => {
    const current = normalizeStudioSettings({
      gateway: {
        url: "ws://localhost:18789",
        token: "stored-token",
        lastKnownGood: {
          url: "ws://localhost:18789",
          token: "stored-token",
          adapterType: "openclaw",
        },
      },
    });

    const merged = mergeStudioSettings(current, {
      gateway: {
        lastKnownGood: {
          url: "ws://localhost:18789",
          adapterType: "openclaw",
        },
      },
    });

    expect(merged.gateway?.lastKnownGood?.token).toBe("stored-token");
  });
});

describe("retired feature preferences", () => {
  it("ignores old feature settings while preserving the office title and gateway profile", () => {
    const settings = normalizeStudioSettings({
      standup: { "ws://localhost:18789": { enabled: true } },
      taskBoard: { "ws://localhost:18789": { cards: [{ title: "Old task" }] } },
      office: { "ws://localhost:18789": { title: "My office", remoteOfficeEnabled: true, remoteOfficeToken: "retired-token" } },
      gateway: { url: "ws://localhost:18789", token: "current-token", adapterType: "openclaw", profiles: {
        openclaw: { url: "ws://localhost:18789", token: "current-token" },
        hermes: { url: "ws://localhost:28789", token: "retired-token" },
      } },
    });
    expect(settings).not.toHaveProperty("standup");
    expect(settings).not.toHaveProperty("taskBoard");
    expect(settings.office["ws://localhost:18789"].title).toBe("My office");
    expect(settings.office["ws://localhost:18789"]).not.toHaveProperty("remoteOfficeEnabled");
    expect(settings.office["ws://localhost:18789"]).not.toHaveProperty("remoteOfficeToken");
    expect(settings.gateway?.profiles).toEqual({ openclaw: { url: "ws://localhost:18789", token: "current-token" } });
  });
});
