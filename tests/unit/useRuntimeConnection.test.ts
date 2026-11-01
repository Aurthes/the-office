import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

describe("useRuntimeConnection", () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("selects the openclaw provider from the active adapter type", async () => {
    vi.doMock("@/lib/gateway/GatewayClient", () => ({
      useGatewayConnection: () => ({
        client: {},
        status: "connected",
        gatewayUrl: "ws://localhost:18789",
        token: "",
        selectedAdapterType: "openclaw",
        detectedAdapterType: "openclaw",
        activeAdapterType: "openclaw",
        localGatewayDefaults: null,
        error: null,
        connectPromptReady: true,
        shouldPromptForConnect: false,
        connect: async () => {},
        disconnect: () => {},
        useLocalGatewayDefaults: () => {},
        setGatewayUrl: () => {},
        setToken: () => {},
        setSelectedAdapterType: () => {},
        clearError: () => {},
      }),
    }));

    const { useRuntimeConnection } = await import("@/lib/runtime/useRuntimeConnection");

    const Probe = () => {
      const state = useRuntimeConnection({} as never);
      return createElement(
        "div",
        null,
        createElement("div", { "data-testid": "providerId" }, state.providerId),
        createElement("div", { "data-testid": "providerLabel" }, state.providerLabel)
      );
    };

    render(createElement(Probe));

    expect(screen.getByTestId("providerId")).toHaveTextContent("openclaw");
    expect(screen.getByTestId("providerLabel")).toHaveTextContent("OpenClaw");
  });

});
