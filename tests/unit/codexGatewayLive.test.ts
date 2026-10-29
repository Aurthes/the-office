// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { WebSocket } from "ws";
import { GatewayClient } from "@/lib/gateway/GatewayClient";
import { ensureGatewayReloadModeHotForLocalStudio } from "@/lib/gateway/gatewayReloadMode";
import { hydrateAgentFleetFromGateway } from "@/features/agents/operations/agentFleetHydration";
import { renderHook, waitFor } from "@testing-library/react";
import { useGatewayConnection } from "@/lib/gateway/GatewayClient";
import { StudioSettingsCoordinator } from "@/lib/studio/coordinator";

describe.skipIf(process.env.CLAW3D_LIVE_TEST !== "1")("minimal Codex gateway live contract", () => {
  it("automatically connects from the deployed sanitized settings", async () => {
    vi.stubGlobal("crypto", webcrypto);
    class LocalStudioSocket extends WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(`ws://127.0.0.1:3033${new URL(url).pathname}`, protocols);
      }
    }
    vi.stubGlobal("WebSocket", LocalStudioSocket);
    window.history.replaceState({}, "", "/office");
    const coordinator = new StudioSettingsCoordinator({
      fetchSettings: () => fetch("http://127.0.0.1:3033/api/studio").then(r => r.json()),
      updateSettings: patch => fetch("http://127.0.0.1:3033/api/studio", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then(r => r.json()),
    });
    const hook = renderHook(() => useGatewayConnection(coordinator));
    try {
      await waitFor(() => expect(hook.result.current.status).toBe("connected"), { timeout: 10000 });
    } finally { hook.unmount(); coordinator.dispose(); vi.unstubAllGlobals(); }
  }, 15000);
  it("connects the real browser client without exposing a gateway token and hydrates the office", async () => {
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("WebSocket", WebSocket);
    const client = new GatewayClient();
    try {
      await client.connect({ gatewayUrl: "ws://127.0.0.1:3033/api/gateway/ws", authScopeKey: "codex-live-test", clientName: "openclaw-control-ui" });
      expect(client.getLastHello()?.protocol).toBe(3);
      await ensureGatewayReloadModeHotForLocalStudio({ client, upstreamGatewayUrl: "ws://localhost:18790" });
      const settings = await fetch("http://127.0.0.1:3033/api/studio").then(r => r.json());
      const result = await hydrateAgentFleetFromGateway({ client, gatewayUrl: "ws://localhost:18790", cachedConfigSnapshot: null, loadStudioSettings: async () => settings.settings, isDisconnectLikeError: () => false, logError: () => {} });
      expect(result.seeds.map(s => s.agentId)).toContain("codex");
      expect(result.seeds.find(s => s.agentId === "codex")?.sessionKey).toBe("agent:codex:main");
    } finally { client.disconnect(); vi.unstubAllGlobals(); }
  }, 20000);
});
