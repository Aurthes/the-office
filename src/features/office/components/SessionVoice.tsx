"use client";
import { useEffect, useState } from "react";
import { Mic, MicOff, PhoneOff, Volume2, ChevronRight, ChevronLeft } from "lucide-react";
import { voiceTimelineGroups, type VoiceCaption } from "./voiceTranscript";
import type { LiveSessionItem, SessionClient } from "./SessionControls";
import type { SessionVoiceController } from "./useSessionVoice";
import { VoicePreviews } from "./VoicePreviews";
import { useUiLanguage, useUiText } from "@/lib/i18n/ui-language";

export function SessionVoiceCall({ voice, owner, onReturn, compact = false, onExpand }: { voice: SessionVoiceController; owner?: string; onReturn?: () => void; compact?: boolean; onExpand?: () => void }) {
  const t = useUiText();
  const [volumeOpen, setVolumeOpen] = useState(false);
  return <section aria-label={t("Voice call")} className="rounded-xl border border-cyan-300/30 bg-[#102c39] p-3 text-xs text-white shadow-lg">
    <div className="flex flex-wrap items-center justify-between gap-2">
      {!compact ? <span className="flex min-w-0 items-center gap-2 text-cyan-100"><span className="h-2 w-2 shrink-0 rounded-full bg-cyan-300" />{voice.status === "off" ? t("Voice call ended") : voice.status === "connecting" ? t("Connecting to Codex voice…") : t("In a call with Codex")}{owner ? <span className="max-w-40 truncate font-semibold">· {owner}</span> : null}</span> : null}
      <div className="flex items-center gap-1">
        {voice.status !== "off" ? <>
          <button aria-label={t(voice.muted ? "Unmute microphone" : "Mute microphone")} aria-pressed={voice.muted} onClick={voice.toggleMute} className={"flex min-h-10 items-center gap-2 rounded-lg px-3 " + (voice.muted ? "bg-amber-950 text-amber-100" : "text-cyan-100")}>
            {voice.muted ? <MicOff size={16} /> : <Mic size={16} />}{!compact ? t(voice.muted ? "Unmute" : "Mute") : null}
          </button>
          <button aria-label={t("End call")} onClick={voice.stop} className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-rose-200"><PhoneOff size={16} />{!compact ? t("End call") : null}</button>
        </> : <button onClick={voice.dismissTranscript} className="min-h-10 px-3 text-cyan-100">{t("Close transcript")}</button>}
        <button aria-label={t("Call volume")} aria-expanded={volumeOpen} onClick={() => setVolumeOpen(open => !open)} className="min-h-10 rounded-lg px-3 text-cyan-100"><Volume2 size={16} /></button>
        {onExpand ? <button aria-label={t(compact ? "Expand voice call" : "Collapse voice call")} onClick={onExpand} className="min-h-10 px-2 text-cyan-100">{compact ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button> : null}
      </div>
    </div>
    {volumeOpen ? <label className="mt-1 flex w-44 max-w-full items-center gap-2 text-cyan-100">
      <input aria-label={t("Call volume")} type="range" min="0" max="1" step="0.05" value={voice.outputVolume} onChange={event => voice.setVolume(Number(event.target.value))} className="min-w-0 flex-1 accent-cyan-300" />
      <output className="w-9 text-right">{Math.round(voice.outputVolume * 100)}%</output>
    </label> : null}
    {!compact ? <>
      {voice.muted ? <p role="status" className="mt-1 text-amber-100">{t("Microphone muted")}</p> : null}
      {onReturn ? <button onClick={onReturn} className="mt-1 min-h-9 text-cyan-200 underline">{t("Return to voice conversation")}</button> : voice.status !== "off" ? <p className="mt-1 text-[11px] text-white/45">{t("Same session · Switching chats keeps this call connected")}</p> : null}
      <VoiceLines lines={voice.captions} />
      {voice.nativeCallId ? <div className="mt-2 flex flex-wrap gap-3 text-cyan-200">
        <button disabled={voice.transcriptLoading} onClick={() => void voice.loadTranscript()}>{t("Refresh transcript")}</button>
        {voice.transcriptCursor ? <button disabled={voice.transcriptLoading} onClick={() => void voice.loadTranscript(voice.transcriptCursor!)}>{t("Load earlier call dialogue")}</button> : null}
      </div> : null}
      {voice.transcriptError ? <p role="status" className="mt-2 text-amber-100">{t(voice.transcriptError)}</p> : null}
      {voice.playbackBlocked ? <button onClick={() => void voice.play()} className="mt-2 rounded border border-cyan-300/40 px-3 py-2 text-cyan-100">{t("Play audio")}</button> : null}
    </> : null}
  </section>;
}

// Mounted only away from the original chat, so every return to floating mode
// starts compact. Controls are siblings of expand, not a clickable outer shell.
export function FloatingSessionVoice({ voice, owner, onReturn }: { voice: SessionVoiceController; owner?: string; onReturn: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return <div className="fixed left-[max(0.5rem,env(safe-area-inset-left))] top-1/2 z-[90] max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-1rem)] -translate-y-1/2 overflow-y-auto" style={{ width: expanded ? "min(28rem, calc(100vw - 1rem))" : undefined }}>
    <SessionVoiceCall voice={voice} owner={owner} onReturn={onReturn} compact={!expanded} onExpand={() => setExpanded(value => !value)} />
  </div>;
}

function VoiceLines({ lines }: { lines: readonly VoiceCaption[] }) {
  const t = useUiText();
  return lines.length ? <div aria-label={t("Call dialogue")} tabIndex={0} className="mt-2 max-h-48 space-y-2 overflow-y-auto overscroll-contain break-words text-xs text-white/80">{lines.map((line, index) => <p key={`${line.role}:${line.id || index}`}><span className="text-cyan-200/60">{line.role === "user" ? t("You") : "Codex"}: </span>{line.text}{line.truncated ? <small className="block text-amber-100">{t("Transcript text was truncated upstream.")}</small> : null}</p>)}</div> : null;
}
// Older calls stay discoverable from the existing loaded timeline, outside the
// official message stream. No new transcript store or guessed call grouping.
export function SessionVoiceHistory({ messages, currentCallId, currentBoundaryId }: { messages: LiveSessionItem[]; currentCallId?: string | null; currentBoundaryId?: string | null }) {
  const t = useUiText();
  const groups = voiceTimelineGroups(messages).filter(group => currentBoundaryId ? group.boundaryId !== currentBoundaryId : group.callId !== currentCallId);
  if (!groups.length) return null;
  return <details className="mb-2 rounded-xl border border-cyan-300/30 bg-[#102c39] p-3 text-xs text-cyan-100"><summary className="cursor-pointer">{t("Voice conversation history")} ({groups.length})</summary>
    {groups.map((group, index) => <details key={group.id} className="mt-2"><summary className="cursor-pointer">{t("Voice conversation")} {index + 1}</summary><VoiceLines lines={group.lines} /></details>)}
    <p className="mt-2 text-white/45">{t("Loaded call records. Load earlier messages for older dialogue.")}</p>
  </details>;
}

export function SessionVoiceSettings({ client, voice }: { client: SessionClient; voice: SessionVoiceController }) {
  const t = useUiText();
  const { language } = useUiLanguage();
  const [voices, setVoices] = useState<string[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let stopped = false, generation = 0;
    const load = () => {
      const request = ++generation;
      void client.call("session.voice.options", {}).then(value => {
        if (stopped || request !== generation) return;
        const result = value as { voices?: unknown };
        if (!Array.isArray(result?.voices) || !result.voices.length) { setError(true); return; }
        setVoices(result.voices.filter((v): v is string => typeof v === "string"));
      }).catch(() => { if (!stopped && request === generation) setError(true); });
    };
    load();
    const unsubscribe = client.onEvent?.(event => { if (event.event === "office.account") { setVoices(null); setError(false); load(); } });
    return () => { stopped = true; unsubscribe?.(); };
  }, [client]);
  return <section aria-label={t("Voice settings")} className="mb-3 rounded-xl border border-white/15 bg-black/15 p-3 text-xs text-white">
    <h3 className="mb-2 font-semibold">{t("Voice settings")}</h3>
    <label className="flex items-center justify-between gap-3">{t("Voice")}<select aria-label={t("Select voice")} value={voice.settings.voice} disabled={!voices} onChange={event => voice.updateSettings({ ...voice.settings, voice: event.target.value })} className="max-w-[65%] rounded border border-white/20 bg-[#17232f] p-2 text-sm disabled:opacity-50">
      <option value="">{t("Default voice")}</option>
      {voice.settings.voice && !voices?.includes(voice.settings.voice) ? <option value={voice.settings.voice}>{voice.settings.voice}</option> : null}
      {voices?.map(name => <option key={name} value={name}>{name[0].toUpperCase() + name.slice(1)}</option>)}
    </select></label>
    {error ? <p role="status" className="mt-1 text-amber-100">{t("Voice selection is unavailable on this gateway.")}</p> : !voices ? <p className="mt-1 text-white/45">{t("Loading voices…")}</p> : null}
    <div className="mt-3 space-y-3">{([
      ["echoCancellation", "Echo cancellation"], ["noiseSuppression", "Noise suppression"], ["autoGainControl", "Automatic microphone gain"],
    ] as const).map(([key, label]) => <label key={key} className="flex min-h-8 items-center justify-between gap-3">{t(label)}<input type="checkbox" checked={voice.settings[key]} onChange={event => voice.updateSettings({ ...voice.settings, [key]: event.target.checked })} /></label>)}</div>
    {voices ? <VoicePreviews key={language} client={client} voices={voices} /> : null}
    <p className="mt-3 text-[11px] text-white/45">{t("Changes apply to your next call. Microphone processing depends on your browser.")}</p>
  </section>;
}
