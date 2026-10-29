import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultStudioSettings } from "@/lib/studio/settings";
import { applyStudioSettingsPatch, loadStudioSettings, saveStudioSettings } from "@/lib/studio/settings-store";

const { loadUpstreamGatewaySettings } = createRequire(import.meta.url)("../../server/studio-settings.js");
const nativeUrl = "ws://127.0.0.1:18790";
const staleUrl = "ws://localhost:18789";
let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "claw3d-binding-"));
  vi.stubEnv("OPENCLAW_STATE_DIR", directory);
  vi.stubEnv("CLAW3D_CODEX_GATEWAY", "1");
  vi.stubEnv("CLAW3D_GATEWAY_URL", nativeUrl);
  const settings = defaultStudioSettings();
  settings.gateway = { url: staleUrl, token: "fixture-host-token", adapterType: "openclaw" };
  settings.officeFloors["openclaw-ground"].gatewayUrl = staleUrl;
  saveStudioSettings(settings);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("host-managed Codex gateway", () => {
  it("connects to the configured host even before stale state is rewritten", () => {
    expect(loadStudioSettings().gateway?.url).toBe(nativeUrl);
    expect(loadStudioSettings().officeFloors["openclaw-ground"].gatewayUrl).toBe(nativeUrl);
    expect(loadUpstreamGatewaySettings().url).toBe(nativeUrl);
  });

  it("rejects a stale browser's floor and gateway address updates while retaining credentials", () => {
    const settings = applyStudioSettingsPatch({
      gateway: {
        url: staleUrl,
        profiles: { openclaw: { url: staleUrl } },
        lastKnownGood: { url: staleUrl, adapterType: "openclaw" },
      },
      officeFloors: { "openclaw-ground": { gatewayUrl: staleUrl } },
    });
    expect(settings.gateway?.url).toBe(nativeUrl);
    expect(settings.gateway?.profiles?.openclaw?.url).toBe(nativeUrl);
    expect(settings.gateway?.lastKnownGood?.url).toBe(nativeUrl);
    expect(settings.gateway?.token).toBe("fixture-host-token");
    const saved = JSON.parse(fs.readFileSync(path.join(directory, "claw3d/settings.json"), "utf8"));
    expect(saved.gateway.url).toBe(nativeUrl);
    expect(saved.officeFloors["openclaw-ground"].gatewayUrl).toBe(nativeUrl);
  });

  it("keeps the Codex floor bound when visiting a different backend", () => {
    const settings = applyStudioSettingsPatch({
      gateway: { adapterType: "demo", url: staleUrl },
      officeFloors: { "openclaw-ground": { gatewayUrl: staleUrl } },
    });
    expect(settings.gateway?.url).toBe(staleUrl);
    expect(loadUpstreamGatewaySettings().url).toBe(staleUrl);
    expect(settings.gateway?.profiles?.openclaw?.url).toBe(nativeUrl);
    expect(settings.officeFloors["openclaw-ground"].gatewayUrl).toBe(nativeUrl);
  });

  it("preserves ordinary gateway configuration when Codex mode is disabled", () => {
    vi.stubEnv("CLAW3D_CODEX_GATEWAY", "0");
    expect(loadStudioSettings().gateway?.url).toBe(staleUrl);
    expect(loadUpstreamGatewaySettings().url).toBe(staleUrl);
  });
});
