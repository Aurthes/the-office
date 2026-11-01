"use client";

import type { StudioGatewayAdapterType } from "@/lib/studio/settings";
import { useUiLanguage } from "@/lib/i18n/ui-language";
import { useUiText } from "@/lib/i18n/ui-language";
import { setDictationShortcut, useDictationShortcutSetting, type DictationShortcut } from "../dictationShortcutSettings";

type SettingsPanelProps = {
  gatewayStatus?: string;
  gatewayUrl?: string;
  gatewayToken?: string;
  selectedAdapterType?: StudioGatewayAdapterType;
  activeAdapterType?: StudioGatewayAdapterType;
  onGatewayDisconnect?: () => void;
  onGatewayConnect?: () => void;
  onGatewayUrlChange?: (value: string) => void;
  onGatewayTokenChange?: (value: string) => void;
  onGatewayAdapterTypeChange?: (value: StudioGatewayAdapterType) => void;
  onOpenOnboarding?: () => void;
  officeTitle: string;
  officeTitleLoaded: boolean;
  onOfficeTitleChange: (title: string) => void;

};

export function SettingsPanel({
  gatewayStatus,
  gatewayUrl,
  gatewayToken,
  selectedAdapterType = "openclaw",
  activeAdapterType = "openclaw",
  onGatewayDisconnect,
  onGatewayConnect,
  onGatewayUrlChange,
  onGatewayTokenChange,
  onGatewayAdapterTypeChange,
  onOpenOnboarding,
  officeTitle,
  officeTitleLoaded,
  onOfficeTitleChange,

}: SettingsPanelProps) {
  const t = useUiText();
  const { language, setLanguage } = useUiLanguage();
  const dictationShortcut = useDictationShortcutSetting();
  const normalizedGatewayUrl = gatewayUrl?.trim() ?? "";
  const normalizedGatewayToken = gatewayToken ?? "";
  const gatewayStateLabel = gatewayStatus
    ? gatewayStatus.charAt(0).toUpperCase() + gatewayStatus.slice(1)
    : "Unknown";
  const isGatewayConnected = gatewayStatus === "connected";
  const gatewayDisconnectDisabled = !isGatewayConnected;
  const gatewayConnectDisabled = normalizedGatewayUrl.length === 0;
  const tokenOptional =
    selectedAdapterType === "demo";

  return (
    <div className="px-4 py-4">
      <div className="mb-3 rounded-lg border border-cyan-500/10 bg-black/20 px-4 py-3">
        <label htmlFor="ui-language" className="text-[11px] font-medium text-white">{t("Language")}</label>
        <p className="mt-1 text-[10px] text-white/75">{t("Choose the interface language.")}</p>
        <select id="ui-language" value={language} onChange={event => setLanguage(event.target.value === "zh-CN" ? "zh-CN" : "en")}
          className="mt-3 min-h-10 w-full rounded-md border border-cyan-500/20 bg-[#152b35] px-3 py-2 text-sm text-white">
          <option value="en" lang="en">English</option>
          <option value="zh-CN" lang="zh-CN">简体中文</option>
        </select>
      </div>
      <section aria-label={t("Keyboard shortcuts")} className="mb-3 rounded-lg border border-cyan-500/10 bg-black/20 px-4 py-3">
        <h3 className="text-[11px] font-medium text-white">{t("Keyboard shortcuts")}</h3>
        <p className="mt-1 text-[10px] text-white/75">{t("Saved in this browser. Active only while an Office chat is visible in the foreground.")}</p>
        <label htmlFor="dictation-shortcut" className="mt-3 block text-[11px] text-white">{t("Dictation shortcut")}</label>
        <select id="dictation-shortcut" value={dictationShortcut} onChange={event => setDictationShortcut(event.target.value as DictationShortcut)}
          className="mt-2 min-h-10 w-full rounded-md border border-cyan-500/20 bg-[#152b35] px-3 py-2 text-sm text-white">
          <option value="ctrl-shift-space">{t("Ctrl + Shift + Space (recommended)")}</option>
          <option value="option">Option / Alt</option>
          <option value="off">{t("Off")}</option>
        </select>
        <p className="mt-2 text-[10px] text-white/65">{t("Tap to start or stop. Hold to dictate, release to insert text. Enter sends; Shift+Enter adds a line; Esc cancels recording.")}</p>
        <p className="mt-2 text-[10px] text-amber-100/80">{t("System-wide shortcuts take priority over webpages. Choose a different shortcut if Codex or another app uses the same keys.")}</p>
      </section>
      <div className="rounded-lg border border-cyan-500/10 bg-black/20 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-medium text-white">{t("Studio title")}</div>
            <div className="mt-1 text-[10px] text-white/75">{t("Customize the banner shown at the top of the office.")}</div>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-cyan-200/70">
            {officeTitleLoaded ? t("Ready") : t("Loading")}
          </span>
        </div>
        <input
          type="text"
          value={officeTitle}
          maxLength={48}
          disabled={!officeTitleLoaded}
          onChange={(event) => onOfficeTitleChange(event.target.value)}
          placeholder="Luke Headquarters"
          className="mt-3 w-full rounded-md border border-cyan-500/10 bg-black/25 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-cyan-100 outline-none transition-colors placeholder:text-cyan-100/30 focus:border-cyan-400/30 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <div className="mt-2 text-[10px] text-white/50">{t("Used in the office scene header.")}</div>
      </div>
      <div className="mt-3 rounded-lg border border-cyan-500/10 bg-black/20 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-medium text-white">{t("Gateway")}</div>
            <div className="mt-1 text-[10px] text-white/75">{t("Switch the active backend and update its saved endpoint details.")}</div>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-cyan-200/70">
            {t(gatewayStateLabel)}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ["demo", "Demo"],

              ["openclaw", "OpenClaw"],
            ] as const
          ).map(([adapterType, label]) => {
            const selected = selectedAdapterType === adapterType;
            return (
              <button
                key={adapterType}
                type="button"
                onClick={() => onGatewayAdapterTypeChange?.(adapterType)}
                className={`rounded-md border px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] transition-colors ${
                  selected
                    ? "border-cyan-400/35 bg-cyan-500/12 text-cyan-50"
                    : "border-cyan-500/10 bg-black/20 text-white/75 hover:border-cyan-400/25 hover:text-cyan-50"
                }`}
              >
                {t(label)}
              </button>
            );
          })}
        </div>
        <div className="mt-3 grid gap-3">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-cyan-100/65">{t("Upstream URL")}</div>
            <input
              type="text"
              value={gatewayUrl ?? ""}
              onChange={(event) => onGatewayUrlChange?.(event.target.value)}
              placeholder={
                "ws://localhost:18789"
              }
              className="w-full rounded-md border border-cyan-500/10 bg-black/25 px-3 py-2 font-mono text-[11px] text-cyan-100 outline-none transition-colors placeholder:text-cyan-100/30 focus:border-cyan-400/30"
            />
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-cyan-100/65">
              {tokenOptional ? t("Upstream token (optional)") : t("Upstream token")}
            </div>
            <input
              type="password"
              value={normalizedGatewayToken}
              onChange={(event) => onGatewayTokenChange?.(event.target.value)}
              placeholder={tokenOptional ? t("optional token") : t("gateway token")}
              className="w-full rounded-md border border-cyan-500/10 bg-black/25 px-3 py-2 text-[11px] text-cyan-100 outline-none transition-colors placeholder:text-cyan-100/30 focus:border-cyan-400/30"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-white/60">
          <span className="font-mono">{t("Selected backend:")}{t(selectedAdapterType)}
          </span>
          <span className="font-mono">{t("Active backend:")}{t(activeAdapterType)}
          </span>
          <span>{t("Each backend keeps its own saved URL and token.")}</span>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-[10px] text-white/60">{t("Connect to apply the selected backend, or disconnect to return to the connection screen.")}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onGatewayConnect?.()}
              disabled={gatewayConnectDisabled}
              className="rounded-md border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-cyan-50 transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {gatewayStatus === "connecting" ? t("Connecting...") : t("Connect")}
            </button>
            <button
              type="button"
              onClick={() => onGatewayDisconnect?.()}
              disabled={gatewayDisconnectDisabled}
              className="rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-rose-100 transition-colors hover:border-rose-400/40 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-40"
            >{t("Disconnect gateway")}</button>
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-cyan-500/10 bg-black/20 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-medium text-white">{t("Onboarding")}</div>
            <div className="mt-1 text-[10px] text-white/75">{t("Re-open the onboarding wizard to test the new-user flow.")}</div>
          </div>
          <button
            type="button"
            onClick={() => onOpenOnboarding?.()}
            className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-emerald-100 transition-colors hover:border-emerald-400/40 hover:bg-emerald-500/15"
          >{t("Launch wizard")}</button>
        </div>
      </div>
    </div>
  );
}
