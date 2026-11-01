"use client";
import { useEffect, useState } from "react";
import { Mic, MicOff, PhoneOff, X } from "lucide-react";
import type { SessionClient } from "./SessionControls";
import type { SessionVoiceController } from "./useSessionVoice";
import { useUiText } from "@/lib/i18n/ui-language";

export function SessionVoiceCall({ voice, owner, onReturn }: { voice: SessionVoiceController; owner?: string; onReturn?: () => void }) {
  const t = useUiText();
  return <section aria-label={t("Voice call")} className="rounded-xl border border-cyan-300/30 bg-[#102c39] p-3 text-xs text-white shadow-lg">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2 text-cyan-100"><span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-cyan-300" />{voice.status === "connecting" ? t("Connecting to Codex voice…") : t("In a call with Codex")}{owner ? <span className="max-w-40 truncate font-semibold">· {owner}</span> : null}</span>
      <div className="flex items-center gap-1">
        <button aria-label={t(voice.muted ? "Unmute microphone" : "Mute microphone")} aria-pressed={voice.muted} onClick={voice.toggleMute} className={"flex min-h-10 items-center gap-2 rounded-lg px-3 " + (voice.muted ? "bg-amber-950 text-amber-100" : "text-cyan-100")}>
          {voice.muted ? <MicOff size={16} /> : <Mic size={16} />}{t(voice.muted ? "Unmute" : "Mute")}
        </button>
        <button onClick={voice.stop} className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-rose-200"><PhoneOff size={16} />{t("End call")}</button>
      </div>
    </div>
    {voice.muted ? <p role="status" className="mt-1 text-amber-100">{t("Microphone muted")}</p> : null}
    {onReturn ? <button onClick={onReturn} className="mt-1 min-h-9 text-cyan-200 underline">{t("Return to voice conversation")}</button> : <>
      <p className="mt-1 text-[11px] text-white/45">{t("Same session · Switching chats keeps this call connected")}</p>
      {voice.captions.length ? <div className="mt-2 max-h-24 space-y-1 overflow-y-auto text-xs text-white/70">{voice.captions.map((line, index) => <p key={index}><span className="text-white/40">{line.role === "user" ? t("You") : "Codex"}: </span>{line.text}</p>)}</div> : null}
    </>}
    {voice.playbackBlocked ? <button onClick={() => void voice.play()} className="mt-2 rounded border border-cyan-300/40 px-3 py-2 text-cyan-100">{t("Play audio")}</button> : null}
  </section>;
}

export function SessionVoiceSettings({ client, voice, onClose }: { client: SessionClient; voice: SessionVoiceController; onClose: () => void }) {
  const t = useUiText();
  const [voices, setVoices] = useState<string[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let stopped = false;
    void client.call("session.voice.options", {}).then(value => {
      if (stopped) return;
      const result = value as { voices?: unknown };
      if (!Array.isArray(result?.voices) || !result.voices.length) { setError(true); return; }
      setVoices(result.voices.filter((v): v is string => typeof v === "string"));
    }).catch(() => { if (!stopped) setError(true); });
    return () => { stopped = true; };
  }, [client]);
  return <section aria-label={t("Voice settings")} className="mb-3 rounded-xl border border-white/15 bg-black/15 p-3">
    <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">{t("Voice settings")}</h3><button aria-label={t("Close voice settings")} onClick={onClose} className="grid h-9 w-9 place-items-center"><X size={16} /></button></div>
    <label className="flex items-center justify-between gap-3">{t("Voice")}<select aria-label={t("Select voice")} value={voice.settings.voice} disabled={!voices} onChange={event => voice.updateSettings({ ...voice.settings, voice: event.target.value })} className="max-w-[65%] rounded border border-white/20 bg-[#17232f] p-2 text-sm disabled:opacity-50">
      <option value="">{t("Default voice")}</option>
      {voice.settings.voice && !voices?.includes(voice.settings.voice) ? <option value={voice.settings.voice}>{voice.settings.voice}</option> : null}
      {voices?.map(name => <option key={name} value={name}>{name[0].toUpperCase() + name.slice(1)}</option>)}
    </select></label>
    {error ? <p role="status" className="mt-1 text-amber-100">{t("Voice selection is unavailable on this gateway.")}</p> : !voices ? <p className="mt-1 text-white/45">{t("Loading voices…")}</p> : null}
    <div className="mt-3 space-y-3">{([
      ["echoCancellation", "Echo cancellation"], ["noiseSuppression", "Noise suppression"], ["autoGainControl", "Automatic microphone gain"],
    ] as const).map(([key, label]) => <label key={key} className="flex min-h-8 items-center justify-between gap-3">{t(label)}<input type="checkbox" checked={voice.settings[key]} onChange={event => voice.updateSettings({ ...voice.settings, [key]: event.target.checked })} /></label>)}</div>
    <p className="mt-3 text-[11px] text-white/45">{t("Changes apply to your next call. Microphone processing depends on your browser.")}</p>
  </section>;
}
