
import {
  DEFAULT_ACTIVE_FLOOR_ID,
  getOfficeFloor,
  OFFICE_FLOORS,
  type FloorId,
  type FloorProvider,
  resolveActiveOfficeFloorId,
} from "@/lib/office/floors";
import type { AgentAvatarProfile } from "@/lib/avatars/profile";
import { normalizeAgentAvatarProfile } from "@/lib/avatars/profile";

export type StudioGatewaySettings = {
  url: string;
  token: string;
  adapterType: StudioGatewayAdapterType;
  profiles?: Partial<Record<StudioGatewayAdapterType, StudioGatewayProfile>>;
  lastKnownGood?: StudioGatewayConnectionState;
};

export type StudioGatewayAdapterType = "openclaw" | "demo";
export const STUDIO_GATEWAY_ADAPTER_TYPES = ["openclaw", "demo"] as const;

export type StudioGatewayProfile = {
  url: string;
  token: string;
};

export type StudioGatewayConnectionState = {
  url: string;
  token: string;
  adapterType: StudioGatewayAdapterType;
};

export type StudioGatewaySettingsPublic = {
  url: string;
  tokenConfigured: boolean;
  adapterType: StudioGatewayAdapterType;
  profiles?: Partial<Record<StudioGatewayAdapterType, StudioGatewayProfilePublic>>;
  lastKnownGood?: StudioGatewayConnectionStatePublic;
};

export type StudioGatewayProfilePublic = {
  url: string;
  tokenConfigured: boolean;
};

export type StudioGatewayConnectionStatePublic = {
  url: string;
  tokenConfigured: boolean;
  adapterType: StudioGatewayAdapterType;
};

export type StudioGatewaySettingsPatch = {
  url?: string | null;
  token?: string | null;
  adapterType?: StudioGatewayAdapterType | null;
  profiles?: Partial<Record<StudioGatewayAdapterType, StudioGatewayProfilePatch | null>> | null;
  lastKnownGood?: StudioGatewayConnectionStatePatch | null;
};

export type StudioGatewayProfilePatch = {
  url?: string | null;
  token?: string | null;
};

export type StudioGatewayConnectionStatePatch = {
  url?: string | null;
  token?: string | null;
  adapterType?: StudioGatewayAdapterType | null;
};

export type ResolvedStudioGatewayProfiles = {
  selectedAdapterType: StudioGatewayAdapterType;
  activeProfile: StudioGatewayProfile;
  profiles: Partial<Record<StudioGatewayAdapterType, StudioGatewayProfile>>;
  lastKnownGoodForSelected: StudioGatewayConnectionState | null;
};

export type FocusFilter = "all" | "running" | "approvals";
export type StudioViewMode = "focused";

export type StudioFocusedPreference = {
  mode: StudioViewMode;
  selectedAgentId: string | null;
  filter: FocusFilter;
};

export type StudioAnalyticsBudgetSettings = {
  dailySpendLimitUsd: number | null;
  monthlySpendLimitUsd: number | null;
  perAgentSoftLimitUsd: number | null;
  alertThresholdPct: number;
};

export type StudioAnalyticsPreference = {
  budgets: StudioAnalyticsBudgetSettings;
};

export type StudioAnalyticsPreferencePatch = {
  budgets?: Partial<StudioAnalyticsBudgetSettings>;
};

export type StudioOfficePreference = {
  title: string;

  companyName: string;
  companyPrompt: string;
  companyImprovedBrief: string;
  companySummary: string;
  companyGeneratedAt: string | null;
  companyRoleTitles: string[];
  companyPlanJson: string;
};

export type StudioOfficePreferencePublic = {
  title: string;

  companyName: string;
  companyPrompt: string;
  companyImprovedBrief: string;
  companySummary: string;
  companyGeneratedAt: string | null;
  companyRoleTitles: string[];
  companyPlanJson: string;
};

export type StudioOfficePreferencePatch = {
  title?: string | null;

  companyName?: string | null;
  companyPrompt?: string | null;
  companyImprovedBrief?: string | null;
  companySummary?: string | null;
  companyGeneratedAt?: string | null;
  companyRoleTitles?: string[] | null;
  companyPlanJson?: string | null;
};

export type StudioDeskAssignments = Record<string, string>;
export type StudioAgentAvatars = Record<string, AgentAvatarProfile>;

export type FloorRuntimeConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type StudioFloorRuntimeState = {
  floorId: FloorId;
  provider: FloorProvider;
  runtimeProfileId: string | null;
  gatewayUrl: string | null;
  status: FloorRuntimeConnectionStatus;
  lastKnownGoodAt: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

export type StudioFloorRuntimeStatePatch = {
  runtimeProfileId?: string | null;
  gatewayUrl?: string | null;
  status?: FloorRuntimeConnectionStatus;
  lastKnownGoodAt?: number | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
};

export type StudioSettings = {
  version: 1;
  gateway: StudioGatewaySettings | null;
  activeFloorId: FloorId;
  officeFloors: Record<FloorId, StudioFloorRuntimeState>;
  focused: Record<string, StudioFocusedPreference>;
  avatars: Record<string, StudioAgentAvatars>;
  deskAssignments: Record<string, StudioDeskAssignments>;
  analytics: Record<string, StudioAnalyticsPreference>;
  office: Record<string, StudioOfficePreference>;

};

export type StudioSettingsPublic = Omit<StudioSettings, "gateway" | "office"> & {
  gateway: StudioGatewaySettingsPublic | null;
  office: Record<string, StudioOfficePreferencePublic>;

};

export type StudioSettingsPatch = {
  gateway?: StudioGatewaySettingsPatch | null;
  activeFloorId?: FloorId | null;
  officeFloors?: Partial<Record<FloorId, StudioFloorRuntimeStatePatch | null>>;
  focused?: Record<string, Partial<StudioFocusedPreference> | null>;
  avatars?: Record<string, Record<string, AgentAvatarProfile | null> | null>;
  deskAssignments?: Record<string, Record<string, string | null> | null>;
  analytics?: Record<string, StudioAnalyticsPreferencePatch | null>;
  office?: Record<string, StudioOfficePreferencePatch | null>;

};

const SETTINGS_VERSION = 1 as const;
const DEFAULT_OPENCLAW_GATEWAY_URL = "ws://localhost:18789";
const DEFAULT_LOCAL_ADAPTER_GATEWAY_URL = "ws://localhost:18789";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object");

const coerceString = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "0.0.0.0"]);

const normalizeGatewayUrl = (value: unknown) => {
  const url = coerceString(value);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (!LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase())) {
      return url;
    }
    const auth =
      parsed.username || parsed.password
        ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ""}@`
        : "";
    const host = parsed.port ? `localhost:${parsed.port}` : "localhost";
    const dropDefaultPath =
      parsed.pathname === "/" && !url.endsWith("/") && !parsed.search && !parsed.hash;
    const pathname = dropDefaultPath ? "" : parsed.pathname;
    return `${parsed.protocol}//${auth}${host}${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
};

const normalizeGatewayKey = (value: unknown) => {
  const key = normalizeGatewayUrl(value);
  return key ? key : null;
};

const normalizeFloorRuntimeConnectionStatus = (
  value: unknown,
  fallback: FloorRuntimeConnectionStatus = "disconnected",
): FloorRuntimeConnectionStatus => {
  if (
    value === "disconnected" ||
    value === "connecting" ||
    value === "connected" ||
    value === "error"
  ) {
    return value;
  }
  return fallback;
};

const normalizeOptionalTimestamp = (value: unknown, fallback: number | null = null): number | null => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const normalizeFocusFilter = (
  value: unknown,
  fallback: FocusFilter = "all"
): FocusFilter => {
  const filter = coerceString(value);
  if (filter === "needs-attention") return "all";
  if (filter === "idle") return "approvals";
  if (
    filter === "all" ||
    filter === "running" ||
    filter === "approvals"
  ) {
    return filter;
  }
  return fallback;
};

const normalizeViewMode = (
  value: unknown,
  fallback: StudioViewMode = "focused"
): StudioViewMode => {
  const mode = coerceString(value);
  if (mode === "focused") {
    return mode;
  }
  return fallback;
};

const normalizeSelectedAgentId = (value: unknown, fallback: string | null = null) => {
  if (value === null) return null;
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeOptionalNumber = (value: unknown, fallback: number | null = null) => {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value;
};

const normalizeAlertThresholdPct = (value: unknown, fallback: number = 80) => {
  const next = normalizeOptionalNumber(value, fallback);
  if (next === null) return fallback;
  return Math.min(100, Math.max(1, next));
};

const defaultFocusedPreference = (): StudioFocusedPreference => ({
  mode: "focused",
  selectedAgentId: null,
  filter: "all",
});

export const defaultStudioAnalyticsPreference = (): StudioAnalyticsPreference => ({
  budgets: {
    dailySpendLimitUsd: null,
    monthlySpendLimitUsd: null,
    perAgentSoftLimitUsd: null,
    alertThresholdPct: 80,
  },
});

export const defaultStudioFloorRuntimeState = (
  floorId: FloorId,
): StudioFloorRuntimeState => {
  const floor = getOfficeFloor(floorId);
  return {
    floorId,
    provider: floor.provider,
    runtimeProfileId: floor.runtimeProfileId,
    gatewayUrl: null,
    status: "disconnected",
    lastKnownGoodAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  };
};

const normalizeOptionalIsoString = (
  value: unknown,
  fallback: string | null = null
): string | null => {
  if (value === null) return null;
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const DEFAULT_OFFICE_TITLE = "Luke Headquarters";

const normalizeOfficeTitle = (
  value: unknown,
  fallback: string = DEFAULT_OFFICE_TITLE
) => {
  const title = coerceString(value);
  return (title || fallback).slice(0, 48);
};

const normalizeCompanyField = (value: unknown) => coerceString(value).slice(0, 10_000);

const normalizeCompanyRoleTitles = (value: unknown, fallback: string[] = []) => {
  if (!Array.isArray(value)) return fallback;
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 32);
};

export const defaultStudioOfficePreference = (): StudioOfficePreference => ({
  title: DEFAULT_OFFICE_TITLE,

  companyName: "",
  companyPrompt: "",
  companyImprovedBrief: "",
  companySummary: "",
  companyGeneratedAt: null,
  companyRoleTitles: [],
  companyPlanJson: "",
});

export const defaultStudioOfficePreferencePublic =
  (): StudioOfficePreferencePublic => ({
    title: DEFAULT_OFFICE_TITLE,

    companyName: "",
    companyPrompt: "",
    companyImprovedBrief: "",
    companySummary: "",
    companyGeneratedAt: null,
    companyRoleTitles: [],
    companyPlanJson: "",
  });

export const sanitizeStudioOfficePreference = (
  value: StudioOfficePreference
): StudioOfficePreferencePublic => ({
  title: value.title,

  companyName: value.companyName,
  companyPrompt: value.companyPrompt,
  companyImprovedBrief: value.companyImprovedBrief,
  companySummary: value.companySummary,
  companyGeneratedAt: value.companyGeneratedAt,
  companyRoleTitles: value.companyRoleTitles,
  companyPlanJson: value.companyPlanJson,
});

const normalizeFocusedPreference = (
  value: unknown,
  fallback: StudioFocusedPreference = defaultFocusedPreference()
): StudioFocusedPreference => {
  if (!isRecord(value)) return fallback;
  return {
    mode: normalizeViewMode(value.mode, fallback.mode),
    selectedAgentId: normalizeSelectedAgentId(
      value.selectedAgentId,
      fallback.selectedAgentId
    ),
    filter: normalizeFocusFilter(value.filter, fallback.filter),
  };
};

const normalizeGatewaySettings = (value: unknown): StudioGatewaySettings | null => {
  if (!isRecord(value)) return null;
  const url = normalizeGatewayUrl(value.url);
  if (!url) return null;
  const token = coerceString(value.token);
  const adapterType = normalizeGatewayAdapterType(value.adapterType);
  const profiles = normalizeGatewayProfiles(value.profiles);
  const lastKnownGood = normalizeGatewayConnectionState(value.lastKnownGood);
  return {
    url,
    token,
    adapterType,
    ...(profiles ? { profiles } : {}),
    ...(lastKnownGood ? { lastKnownGood } : {}),
  };
};

const normalizeGatewayProfile = (value: unknown): StudioGatewayProfile | null => {
  if (!isRecord(value)) return null;
  const url = normalizeGatewayUrl(value.url);
  if (!url) return null;
  const token = coerceString(value.token);
  return { url, token };
};

const normalizeGatewayProfiles = (
  value: unknown
): Partial<Record<StudioGatewayAdapterType, StudioGatewayProfile>> | undefined => {
  if (!isRecord(value)) return undefined;
  const profiles: Partial<Record<StudioGatewayAdapterType, StudioGatewayProfile>> = {};
  for (const adapterType of ["openclaw", "demo"] as const) {
    const normalized = normalizeGatewayProfile(value[adapterType]);
    if (normalized) {
      profiles[adapterType] = normalized;
    }
  }
  return Object.keys(profiles).length > 0 ? profiles : undefined;
};

const normalizeGatewayConnectionState = (
  value: unknown
): StudioGatewayConnectionState | null => {
  if (!isRecord(value)) return null;
  const url = normalizeGatewayUrl(value.url);
  if (!url) return null;
  const token = coerceString(value.token);
  const adapterType = normalizeGatewayAdapterType(value.adapterType);
  return { url, token, adapterType };
};

const mergeGatewaySettings = (
  current: StudioGatewaySettings | null,
  patch: StudioGatewaySettingsPatch | null,
): StudioGatewaySettings | null => {
  if (patch === null) return null;
  const nextUrl =
    patch.url === undefined ? current?.url ?? "" : normalizeGatewayUrl(patch.url);
  if (!nextUrl) return null;
  const nextToken =
    patch.token === undefined ? current?.token ?? "" : coerceString(patch.token);
  const nextAdapterType =
    patch.adapterType === undefined
      ? current?.adapterType ?? "openclaw"
      : normalizeGatewayAdapterType(patch.adapterType);
  const nextProfiles = mergeGatewayProfiles(current?.profiles, patch.profiles);
  const nextLastKnownGood = mergeGatewayConnectionState(
    current?.lastKnownGood ?? null,
    patch.lastKnownGood
  );
  return {
    url: nextUrl,
    token: nextToken,
    adapterType: nextAdapterType,
    ...(nextProfiles ? { profiles: nextProfiles } : {}),
    ...(nextLastKnownGood ? { lastKnownGood: nextLastKnownGood } : {}),
  };
};

const mergeGatewayProfiles = (
  current: Partial<Record<StudioGatewayAdapterType, StudioGatewayProfile>> | undefined,
  patch:
    | Partial<Record<StudioGatewayAdapterType, StudioGatewayProfilePatch | null>>
    | null
    | undefined,
): Partial<Record<StudioGatewayAdapterType, StudioGatewayProfile>> | undefined => {
  if (patch === null) return undefined;
  if (patch === undefined) return current;
  const next: Partial<Record<StudioGatewayAdapterType, StudioGatewayProfile>> = {
    ...(current ?? {}),
  };
  for (const adapterType of ["openclaw", "demo"] as const) {
    const profilePatch = patch[adapterType];
    if (profilePatch === undefined) continue;
    if (profilePatch === null) {
      delete next[adapterType];
      continue;
    }
    const existing = current?.[adapterType] ?? null;
    const nextUrl =
      profilePatch.url === undefined
        ? existing?.url ?? ""
        : normalizeGatewayUrl(profilePatch.url);
    if (!nextUrl) {
      delete next[adapterType];
      continue;
    }
    const nextToken =
      profilePatch.token === undefined ? existing?.token ?? "" : coerceString(profilePatch.token);
    next[adapterType] = { url: nextUrl, token: nextToken };
  }
  return Object.keys(next).length > 0 ? next : undefined;
};

const mergeGatewayConnectionState = (
  current: StudioGatewayConnectionState | null,
  patch: StudioGatewayConnectionStatePatch | null | undefined
): StudioGatewayConnectionState | null => {
  if (patch === null) return null;
  if (patch === undefined) return current;
  const nextUrl =
    patch.url === undefined ? current?.url ?? "" : normalizeGatewayUrl(patch.url);
  if (!nextUrl) return null;
  const patchedToken = patch.token === undefined ? undefined : coerceString(patch.token);
  const nextToken = patchedToken || (current?.token ?? "");
  const nextAdapterType =
    patch.adapterType === undefined
      ? current?.adapterType ?? "openclaw"
      : normalizeGatewayAdapterType(patch.adapterType);
  return {
    url: nextUrl,
    token: nextToken,
    adapterType: nextAdapterType,
  };
};

const normalizeGatewayAdapterType = (value: unknown, fallback: StudioGatewayAdapterType = "openclaw"): StudioGatewayAdapterType => {
  const adapterType = coerceString(value).toLowerCase();
  return adapterType === "openclaw" || adapterType === "demo" ? adapterType : fallback;
};

export const resolveDefaultStudioGatewayProfile = (
  adapterType: StudioGatewayAdapterType,
  localDefaults: StudioGatewaySettings | null = null
): StudioGatewayProfile => {
  const explicitProfile = localDefaults?.profiles?.[adapterType];
  if (explicitProfile?.url) {
    return {
      url: explicitProfile.url,
      token: explicitProfile.token ?? "",
    };
  }

  if (localDefaults?.adapterType === adapterType && localDefaults.url?.trim()) {
    return {
      url: localDefaults.url,
      token: localDefaults.token ?? "",
    };
  }

  switch (adapterType) {

    case "demo":
      return { url: DEFAULT_LOCAL_ADAPTER_GATEWAY_URL, token: "" };
    case "openclaw":
    default:
      return { url: DEFAULT_OPENCLAW_GATEWAY_URL, token: "" };
  }
};

export const resolveStudioGatewayProfiles = ({
  gateway,
  localDefaults = null,
}: {
  gateway: StudioGatewaySettings | null;
  localDefaults?: StudioGatewaySettings | null;
}): ResolvedStudioGatewayProfiles => {
  const selectedAdapterType =
    gateway?.adapterType ??
    gateway?.lastKnownGood?.adapterType ??
    localDefaults?.adapterType ??
    "openclaw";

  const profiles: Partial<Record<StudioGatewayAdapterType, StudioGatewayProfile>> = {
    ...(localDefaults?.profiles ?? {}),
    ...(gateway?.profiles ?? {}),
  };

  if (gateway?.url?.trim()) {
    profiles[selectedAdapterType] = {
      url: gateway.url,
      token: gateway.token ?? "",
    };
  }

  const lastKnownGoodForSelected =
    gateway?.lastKnownGood?.adapterType === selectedAdapterType ? gateway.lastKnownGood : null;

  if (!profiles[selectedAdapterType] && lastKnownGoodForSelected?.url) {
    profiles[selectedAdapterType] = {
      url: lastKnownGoodForSelected.url,
      token: lastKnownGoodForSelected.token ?? "",
    };
  }

  for (const adapterType of STUDIO_GATEWAY_ADAPTER_TYPES) {
    if (profiles[adapterType]?.url) continue;
    profiles[adapterType] = resolveDefaultStudioGatewayProfile(adapterType, localDefaults);
  }

  return {
    selectedAdapterType,
    activeProfile:
      profiles[selectedAdapterType] ??
      resolveDefaultStudioGatewayProfile(selectedAdapterType, localDefaults),
    profiles,
    lastKnownGoodForSelected,
  };
};

const normalizeFocused = (value: unknown): Record<string, StudioFocusedPreference> => {
  if (!isRecord(value)) return {};
  const focused: Record<string, StudioFocusedPreference> = {};
  for (const [gatewayKeyRaw, focusedRaw] of Object.entries(value)) {
    const gatewayKey = normalizeGatewayKey(gatewayKeyRaw);
    if (!gatewayKey) continue;
    focused[gatewayKey] = normalizeFocusedPreference(focusedRaw);
  }
  return focused;
};

const normalizeAvatars = (value: unknown): Record<string, StudioAgentAvatars> => {
  if (!isRecord(value)) return {};
  const avatars: Record<string, StudioAgentAvatars> = {};
  for (const [gatewayKeyRaw, gatewayRaw] of Object.entries(value)) {
    const gatewayKey = normalizeGatewayKey(gatewayKeyRaw);
    if (!gatewayKey) continue;
    if (!isRecord(gatewayRaw)) continue;
    const entries: StudioAgentAvatars = {};
    for (const [agentIdRaw, avatarRaw] of Object.entries(gatewayRaw)) {
      const agentId = coerceString(agentIdRaw);
      if (!agentId) continue;
      entries[agentId] = normalizeAgentAvatarProfile(avatarRaw, agentId);
    }
    avatars[gatewayKey] = entries;
  }
  return avatars;
};

const normalizeDeskAssignments = (
  value: unknown,
): Record<string, StudioDeskAssignments> => {
  if (!isRecord(value)) return {};
  const deskAssignments: Record<string, StudioDeskAssignments> = {};
  for (const [gatewayKeyRaw, gatewayRaw] of Object.entries(value)) {
    const gatewayKey = normalizeGatewayKey(gatewayKeyRaw);
    if (!gatewayKey) continue;
    if (!isRecord(gatewayRaw)) continue;
    const entries: StudioDeskAssignments = {};
    for (const [deskUidRaw, agentIdRaw] of Object.entries(gatewayRaw)) {
      const deskUid = coerceString(deskUidRaw);
      if (!deskUid) continue;
      const agentId = coerceString(agentIdRaw);
      if (!agentId) continue;
      entries[deskUid] = agentId;
    }
    deskAssignments[gatewayKey] = entries;
  }
  return deskAssignments;
};

const normalizeAnalyticsBudgetSettings = (
  value: unknown,
  fallback: StudioAnalyticsBudgetSettings = defaultStudioAnalyticsPreference().budgets
): StudioAnalyticsBudgetSettings => {
  if (!isRecord(value)) return fallback;
  return {
    dailySpendLimitUsd: normalizeOptionalNumber(
      value.dailySpendLimitUsd,
      fallback.dailySpendLimitUsd
    ),
    monthlySpendLimitUsd: normalizeOptionalNumber(
      value.monthlySpendLimitUsd,
      fallback.monthlySpendLimitUsd
    ),
    perAgentSoftLimitUsd: normalizeOptionalNumber(
      value.perAgentSoftLimitUsd,
      fallback.perAgentSoftLimitUsd
    ),
    alertThresholdPct: normalizeAlertThresholdPct(
      value.alertThresholdPct,
      fallback.alertThresholdPct
    ),
  };
};

const normalizeAnalyticsPreference = (
  value: unknown,
  fallback: StudioAnalyticsPreference = defaultStudioAnalyticsPreference()
): StudioAnalyticsPreference => {
  if (!isRecord(value)) return fallback;
  return {
    budgets: normalizeAnalyticsBudgetSettings(value.budgets, fallback.budgets),
  };
};

const normalizeAnalytics = (value: unknown): Record<string, StudioAnalyticsPreference> => {
  if (!isRecord(value)) return {};
  const analytics: Record<string, StudioAnalyticsPreference> = {};
  for (const [gatewayKeyRaw, analyticsRaw] of Object.entries(value)) {
    const gatewayKey = normalizeGatewayKey(gatewayKeyRaw);
    if (!gatewayKey) continue;
    analytics[gatewayKey] = normalizeAnalyticsPreference(analyticsRaw);
  }
  return analytics;
};

const normalizeOfficePreference = (
  value: unknown,
  fallback: StudioOfficePreference = defaultStudioOfficePreference()
): StudioOfficePreference => {
  if (!isRecord(value)) return fallback;
  return {
    title: normalizeOfficeTitle(value.title, fallback.title),

    companyName: normalizeCompanyField(value.companyName ?? fallback.companyName),
    companyPrompt: normalizeCompanyField(value.companyPrompt ?? fallback.companyPrompt),
    companyImprovedBrief: normalizeCompanyField(
      value.companyImprovedBrief ?? fallback.companyImprovedBrief
    ),
    companySummary: normalizeCompanyField(value.companySummary ?? fallback.companySummary),
    companyGeneratedAt: normalizeOptionalIsoString(
      value.companyGeneratedAt,
      fallback.companyGeneratedAt
    ),
    companyRoleTitles: normalizeCompanyRoleTitles(
      value.companyRoleTitles,
      fallback.companyRoleTitles
    ),
    companyPlanJson: normalizeCompanyField(value.companyPlanJson ?? fallback.companyPlanJson),
  };
};

const normalizeOffice = (value: unknown): Record<string, StudioOfficePreference> => {
  if (!isRecord(value)) return {};
  const office: Record<string, StudioOfficePreference> = {};
  for (const [gatewayKeyRaw, officeRaw] of Object.entries(value)) {
    const gatewayKey = normalizeGatewayKey(gatewayKeyRaw);
    if (!gatewayKey) continue;
    office[gatewayKey] = normalizeOfficePreference(officeRaw);
  }
  return office;
};

const normalizeFloorRuntimeState = (
  floorId: FloorId,
  value: unknown,
  fallback: StudioFloorRuntimeState = defaultStudioFloorRuntimeState(floorId),
): StudioFloorRuntimeState => {
  if (!isRecord(value)) return fallback;
  const floor = getOfficeFloor(floorId);
  const runtimeProfileIdRaw =
    value.runtimeProfileId === null || value.runtimeProfileId === undefined
      ? fallback.runtimeProfileId
      : coerceString(value.runtimeProfileId);
  const gatewayUrlRaw =
    value.gatewayUrl === null || value.gatewayUrl === undefined
      ? fallback.gatewayUrl
      : normalizeGatewayUrl(value.gatewayUrl);
  const lastErrorCodeRaw =
    value.lastErrorCode === null || value.lastErrorCode === undefined
      ? fallback.lastErrorCode
      : coerceString(value.lastErrorCode);
  const lastErrorMessageRaw =
    value.lastErrorMessage === null || value.lastErrorMessage === undefined
      ? fallback.lastErrorMessage
      : coerceString(value.lastErrorMessage);
  return {
    floorId,
    provider: floor.provider,
    runtimeProfileId: runtimeProfileIdRaw || null,
    gatewayUrl: gatewayUrlRaw || null,
    status: normalizeFloorRuntimeConnectionStatus(value.status, fallback.status),
    lastKnownGoodAt: normalizeOptionalTimestamp(value.lastKnownGoodAt, fallback.lastKnownGoodAt),
    lastErrorCode: lastErrorCodeRaw || null,
    lastErrorMessage: lastErrorMessageRaw || null,
  };
};

const normalizeOfficeFloors = (value: unknown): Record<FloorId, StudioFloorRuntimeState> => {
  const floors = {} as Record<FloorId, StudioFloorRuntimeState>;
  for (const floor of OFFICE_FLOORS) {
    const raw = isRecord(value) ? value[floor.id] : undefined;
    floors[floor.id] = normalizeFloorRuntimeState(floor.id, raw);
  }
  return floors;
};

export const defaultStudioSettings = (): StudioSettings => ({
  version: SETTINGS_VERSION,
  gateway: null,
  activeFloorId: DEFAULT_ACTIVE_FLOOR_ID,
  officeFloors: normalizeOfficeFloors(null),
  focused: {},
  avatars: {},
  deskAssignments: {},
  analytics: {},
  office: {},

});

export const sanitizeStudioGatewaySettings = (
  value: StudioGatewaySettings | null,
): StudioGatewaySettingsPublic | null => {
  if (!value) return null;
  return {
    url: value.url,
    tokenConfigured: value.token.length > 0,
    adapterType: value.adapterType,
    profiles: value.profiles
      ? Object.fromEntries(
          Object.entries(value.profiles).map(([adapterType, profile]) => [
            adapterType,
            {
              url: profile.url,
              tokenConfigured: profile.token.length > 0,
            },
          ]),
        )
      : undefined,
    lastKnownGood: value.lastKnownGood
      ? {
          url: value.lastKnownGood.url,
          tokenConfigured: value.lastKnownGood.token.length > 0,
          adapterType: value.lastKnownGood.adapterType,
        }
      : undefined,
  };
};

export const sanitizeStudioSettings = (
  value: StudioSettings,
): StudioSettingsPublic => ({
  ...value,
  gateway: sanitizeStudioGatewaySettings(value.gateway),
  office: Object.fromEntries(
    Object.entries(value.office).map(([gatewayKey, preference]) => [
      gatewayKey,
      sanitizeStudioOfficePreference(preference),
    ]),
  ),

});

export const normalizeStudioSettings = (raw: unknown): StudioSettings => {
  if (!isRecord(raw)) return defaultStudioSettings();
  const gateway = normalizeGatewaySettings(raw.gateway);
  const activeFloorId = resolveActiveOfficeFloorId(coerceString(raw.activeFloorId) as FloorId);
  const officeFloors = normalizeOfficeFloors(raw.officeFloors);
  const focused = normalizeFocused(raw.focused);
  const avatars = normalizeAvatars(raw.avatars);
  const deskAssignments = normalizeDeskAssignments(raw.deskAssignments);
  const analytics = normalizeAnalytics(raw.analytics);
  const office = normalizeOffice(raw.office);

  return {
    version: SETTINGS_VERSION,
    gateway,
    activeFloorId,
    officeFloors,
    focused,
    avatars,
    deskAssignments,
    analytics,
    office,

  };
};

export const mergeStudioSettings = (
  current: StudioSettings,
  patch: StudioSettingsPatch
): StudioSettings => {
  const nextGateway =
    patch.gateway === undefined ? current.gateway : mergeGatewaySettings(current.gateway, patch.gateway);
  const nextActiveFloorId =
    patch.activeFloorId === undefined
      ? current.activeFloorId
      : resolveActiveOfficeFloorId((patch.activeFloorId ?? DEFAULT_ACTIVE_FLOOR_ID) as FloorId);
  const nextOfficeFloors = { ...current.officeFloors };
  const nextFocused = { ...current.focused };
  const nextAvatars = { ...current.avatars };
  const nextDeskAssignments = { ...current.deskAssignments };
  const nextAnalytics = { ...current.analytics };
  const nextOffice = { ...current.office };

  if (patch.officeFloors) {
    for (const floor of OFFICE_FLOORS) {
      const floorPatch = patch.officeFloors[floor.id];
      if (floorPatch === undefined) continue;
      const fallback = nextOfficeFloors[floor.id] ?? defaultStudioFloorRuntimeState(floor.id);
      if (floorPatch === null) {
        nextOfficeFloors[floor.id] = defaultStudioFloorRuntimeState(floor.id);
        continue;
      }
      nextOfficeFloors[floor.id] = normalizeFloorRuntimeState(
        floor.id,
        {
          ...fallback,
          ...floorPatch,
        },
        fallback,
      );
    }
  }
  if (patch.focused) {
    for (const [keyRaw, value] of Object.entries(patch.focused)) {
      const key = normalizeGatewayKey(keyRaw);
      if (!key) continue;
      if (value === null) {
        delete nextFocused[key];
        continue;
      }
      const fallback = nextFocused[key] ?? defaultFocusedPreference();
      nextFocused[key] = normalizeFocusedPreference(value, fallback);
    }
  }
  if (patch.avatars) {
    for (const [gatewayKeyRaw, gatewayPatch] of Object.entries(patch.avatars)) {
      const gatewayKey = normalizeGatewayKey(gatewayKeyRaw);
      if (!gatewayKey) continue;
      if (gatewayPatch === null) {
        delete nextAvatars[gatewayKey];
        continue;
      }
      if (!isRecord(gatewayPatch)) continue;
      const existing = nextAvatars[gatewayKey] ? { ...nextAvatars[gatewayKey] } : {};
      for (const [agentIdRaw, avatarPatchRaw] of Object.entries(gatewayPatch)) {
        const agentId = coerceString(agentIdRaw);
        if (!agentId) continue;
        if (avatarPatchRaw === null) {
          delete existing[agentId];
          continue;
        }
        existing[agentId] = normalizeAgentAvatarProfile(avatarPatchRaw, agentId);
      }
      nextAvatars[gatewayKey] = existing;
    }
  }
  if (patch.deskAssignments) {
    for (const [gatewayKeyRaw, gatewayPatch] of Object.entries(patch.deskAssignments)) {
      const gatewayKey = normalizeGatewayKey(gatewayKeyRaw);
      if (!gatewayKey) continue;
      if (gatewayPatch === null) {
        delete nextDeskAssignments[gatewayKey];
        continue;
      }
      if (!isRecord(gatewayPatch)) continue;
      const existing = nextDeskAssignments[gatewayKey]
        ? { ...nextDeskAssignments[gatewayKey] }
        : {};
      for (const [deskUidRaw, agentIdPatchRaw] of Object.entries(gatewayPatch)) {
        const deskUid = coerceString(deskUidRaw);
        if (!deskUid) continue;
        if (agentIdPatchRaw === null) {
          delete existing[deskUid];
          continue;
        }
        const agentId = coerceString(agentIdPatchRaw);
        if (!agentId) {
          delete existing[deskUid];
          continue;
        }
        existing[deskUid] = agentId;
      }
      nextDeskAssignments[gatewayKey] = existing;
    }
  }
  if (patch.analytics) {
    for (const [gatewayKeyRaw, analyticsPatch] of Object.entries(patch.analytics)) {
      const gatewayKey = normalizeGatewayKey(gatewayKeyRaw);
      if (!gatewayKey) continue;
      if (analyticsPatch === null) {
        delete nextAnalytics[gatewayKey];
        continue;
      }
      const fallback = nextAnalytics[gatewayKey] ?? defaultStudioAnalyticsPreference();
      nextAnalytics[gatewayKey] = normalizeAnalyticsPreference(
        {
          ...fallback,
          ...analyticsPatch,
          budgets: {
            ...fallback.budgets,
            ...(isRecord(analyticsPatch.budgets) ? analyticsPatch.budgets : {}),
          },
        },
        fallback
      );
    }
  }
  if (patch.office) {
    for (const [gatewayKeyRaw, officePatch] of Object.entries(patch.office)) {
      const gatewayKey = normalizeGatewayKey(gatewayKeyRaw);
      if (!gatewayKey) continue;
      if (officePatch === null) {
        delete nextOffice[gatewayKey];
        continue;
      }
      const fallback = nextOffice[gatewayKey] ?? defaultStudioOfficePreference();
      nextOffice[gatewayKey] = normalizeOfficePreference(
        {
          ...fallback,
          ...officePatch,
        },
        fallback
      );
    }
  }

  return {
    version: SETTINGS_VERSION,
    gateway: nextGateway ?? null,
    activeFloorId: nextActiveFloorId,
    officeFloors: nextOfficeFloors,
    focused: nextFocused,
    avatars: nextAvatars,
    deskAssignments: nextDeskAssignments,
    analytics: nextAnalytics,
    office: nextOffice,

  };
};

export const resolveFocusedPreference = (
  settings: StudioSettings | StudioSettingsPublic,
  gatewayUrl: string
): StudioFocusedPreference | null => {
  const key = normalizeGatewayKey(gatewayUrl);
  if (!key) return null;
  return settings.focused[key] ?? null;
};

export const resolveStudioFloorRuntimeState = (
  settings: StudioSettings | StudioSettingsPublic,
  floorId: FloorId,
): StudioFloorRuntimeState => settings.officeFloors[floorId] ?? defaultStudioFloorRuntimeState(floorId);

export const resolveStudioActiveFloorId = (
  settings: StudioSettings | StudioSettingsPublic,
): FloorId => resolveActiveOfficeFloorId(settings.activeFloorId);

export const resolveAgentAvatarSeed = (
  settings: StudioSettings | StudioSettingsPublic,
  gatewayUrl: string,
  agentId: string
): string | null => {
  const profile = resolveAgentAvatarProfile(settings, gatewayUrl, agentId);
  return profile?.seed ?? null;
};

export const resolveAgentAvatarProfile = (
  settings: StudioSettings | StudioSettingsPublic,
  gatewayUrl: string,
  agentId: string
): AgentAvatarProfile | null => {
  const gatewayKey = normalizeGatewayKey(gatewayUrl);
  if (!gatewayKey) return null;
  const agentKey = coerceString(agentId);
  if (!agentKey) return null;
  return settings.avatars[gatewayKey]?.[agentKey] ?? null;
};

export const resolveDeskAssignments = (
  settings: StudioSettings | StudioSettingsPublic,
  gatewayUrl: string
): StudioDeskAssignments => {
  const gatewayKey = normalizeGatewayKey(gatewayUrl);
  if (!gatewayKey) return {};
  return settings.deskAssignments[gatewayKey] ?? {};
};

export const resolveAnalyticsPreference = (
  settings: StudioSettings | StudioSettingsPublic,
  gatewayUrl: string
): StudioAnalyticsPreference => {
  const gatewayKey = normalizeGatewayKey(gatewayUrl);
  if (!gatewayKey) return defaultStudioAnalyticsPreference();
  return settings.analytics[gatewayKey] ?? defaultStudioAnalyticsPreference();
};

export const resolveOfficePreference = (
  settings: StudioSettings,
  gatewayUrl: string
): StudioOfficePreference => {
  const gatewayKey = normalizeGatewayKey(gatewayUrl);
  if (!gatewayKey) return defaultStudioOfficePreference();
  return settings.office[gatewayKey] ?? defaultStudioOfficePreference();
};

export const resolveOfficePreferencePublic = (
  settings: StudioSettingsPublic,
  gatewayUrl: string
): StudioOfficePreferencePublic => {
  const gatewayKey = normalizeGatewayKey(gatewayUrl);
  if (!gatewayKey) return defaultStudioOfficePreferencePublic();
  return settings.office[gatewayKey] ?? defaultStudioOfficePreferencePublic();
};
