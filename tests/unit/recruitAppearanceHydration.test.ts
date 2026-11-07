import { expect, it } from "vitest";
import { loadCompanySnapshot } from "@/features/office/operations/loadCompanySnapshot";
import { createDefaultAgentAvatarProfile, normalizeAgentAvatarProfile } from "@/lib/avatars/profile";
import { createDuckAppearanceFromSeed, FIREFIGHTER_DUCK_APPEARANCE } from "@/lib/avatars/duck";
import { defaultStudioSettings, mergeStudioSettings } from "@/lib/studio/settings";

it("hydrates backend recruit appearance after reload while retaining Studio overrides and old-agent defaults", async () => {
  const backend = (id: string) => ({ version: 1, seed: id, duck: createDuckAppearanceFromSeed(id) });
  const custom = { ...createDefaultAgentAvatarProfile("custom-seed"), duck: { ...FIREFIGHTER_DUCK_APPEARANCE } };
  const settings = mergeStudioSettings(defaultStudioSettings(), { avatars: { "ws://office": { custom } } });
  const agents = ["manual", "head", "custom", "older"].map(id => ({ id, name: id, role: "Project", status: "idle", projectId: null, updatedAt: 0, ...(id === "older" ? {} : { avatarSeed: id, avatarProfile: backend(id) }) }));
  const load = () => loadCompanySnapshot({ client: { call: async () => ({ mainKey: "main", agents, projects: [], creationAvailable: true }) }, gatewayUrl: "ws://office", loadSettings: async () => JSON.parse(JSON.stringify(settings)) });
  const first = (await load()).hydration.seeds, reloaded = (await load()).hydration.seeds;
  expect(first[0].avatarProfile).toEqual(normalizeAgentAvatarProfile(backend("manual"), "manual"));
  expect(first[1].avatarProfile?.duck).toEqual(createDuckAppearanceFromSeed("head"));
  expect(first[2].avatarProfile).toEqual(custom); expect(first[2].avatarSeed).toBe(custom.seed);
  expect(first[3].avatarProfile).toEqual(createDefaultAgentAvatarProfile("older"));
  expect(reloaded.map(row => row.avatarProfile)).toEqual(first.map(row => row.avatarProfile));
  expect(agents[2].avatarProfile).toEqual(backend("custom"));
});
