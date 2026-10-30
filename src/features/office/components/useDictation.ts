"use client";
import { useCallback, useEffect, useRef, useState } from "react";
type Recognition = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void; abort: () => void };
type RecognitionWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
export function useDictation(onText: (text: string) => void, draft: string) {
  const active = useRef<Recognition | null>(null);
  const latest = useRef({ draft, onText });
  useEffect(() => { latest.current = { draft, onText }; }, [draft, onText]);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const stop = useCallback(() => active.current?.stop(), []);
  const start = useCallback(() => {
    if (active.current) return;
    setError("");
    const surface = window as RecognitionWindow;
    const Constructor = surface.SpeechRecognition || surface.webkitSpeechRecognition;
    if (!Constructor) { setError("此浏览器不支持听写，请用 Chrome 或 Safari，或使用键盘上的语音输入。"); return; }
    const recognition = new Constructor(), base = latest.current.draft;
    active.current = recognition; recognition.lang = "zh-CN"; recognition.continuous = true; recognition.interimResults = true;
    recognition.onresult = event => {
      if (active.current !== recognition) return;
      const transcript = Array.from(event.results, result => result[0].transcript).join("");
      latest.current.onText((base + (base.trim() ? " " : "") + transcript).slice(0, 16000));
    };
    recognition.onerror = event => {
      if (event.error === "aborted") return;
      setError(["not-allowed", "service-not-allowed"].includes(event.error) ? "请允许麦克风及浏览器语音识别。" : event.error === "no-speech" ? "没有识别到声音，请重新听写。" : "浏览器听写失败，请检查网络后重试。");
    };
    recognition.onend = () => { if (active.current === recognition) { active.current = null; setListening(false); } };
    try { recognition.start(); setListening(true); } catch { active.current = null; setListening(false); setError("无法启动听写，请重试。"); }
  }, []);
  useEffect(() => {
    const cancel = () => { const value = active.current; active.current = null; value?.abort(); setListening(false); };
    window.addEventListener("pagehide", cancel);
    return () => { window.removeEventListener("pagehide", cancel); cancel(); };
  }, []);
  return { listening, error, start, stop };
}
