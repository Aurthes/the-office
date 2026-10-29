// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { WebSocket } from "ws";
import { GatewayClient } from "@/lib/gateway/GatewayClient";
import { ensureGatewayReloadModeHotForLocalStudio } from "@/lib/gateway/gatewayReloadMode";
import { hydrateAgentFleetFromGateway } from "@/features/agents/operations/agentFleetHydration";

describe.skipIf(process.env.CLAW3D_LIVE_TEST !== "1")("minimal Codex gateway live contract", () => {
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
