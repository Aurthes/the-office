"use client";
import { useCallback, useEffect, useRef, useState } from "react";
type Recognition = { lang: string; continuous: boolean; interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void };
type RecognitionWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
type Phase = "idle" | "starting" | "listening" | "finishing";
export function useDictation(onText: (text: string) => void, draft: string) {
  const active = useRef<Recognition | null>(null);
  const latest = useRef({ draft, onText });
  useEffect(() => { latest.current = { draft, onText }; }, [draft, onText]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const finish = useRef<(() => void) | null>(null);
  const dispose = useRef<(() => void) | null>(null);
  const stop = useCallback(() => { if (active.current) { setPhase("finishing"); finish.current?.(); } }, []);
  const start = useCallback(() => {
    if (active.current) return;
    setError(""); setNotice("");
    const surface = window as RecognitionWindow;
    const Constructor = surface.SpeechRecognition || surface.webkitSpeechRecognition;
    if (!Constructor) { setError("此浏览器不支持听写，请使用系统听写或 Chrome / Safari 的麦克风按钮。"); return; }
    let recognition: Recognition;
    try { recognition = new Constructor(); } catch { setError("无法创建听写服务，原草稿已保留。"); return; }
    const base = latest.current.draft;
    let transcript = "", stopping = false, failed = false, ended = false;
    let timer: ReturnType<typeof setTimeout>;
    const end = () => {
      if (ended) return;
      ended = true; clearTimeout(timer);
      if (active.current !== recognition) return;
      active.current = null; finish.current = null; setPhase("idle");
      if (!failed) {
        if (transcript) setNotice(stopping ? "听写文字已保留，请检查后发送。" : "浏览器已结束听写，已识别文字保留在草稿中；继续说话请重新开始。");
        else setError("这次没有收到识别文字，原草稿已保留。请重新开始听写，确认显示‘正在听写’后再说话。");
      }
    };
    active.current = recognition; setPhase("starting");
    recognition.lang = "zh-CN"; recognition.continuous = true; recognition.interimResults = true;
    recognition.onstart = () => {
      if (active.current !== recognition || ended) return;
      if (stopping) { try { recognition.stop(); } catch { /* The finishing deadline stays armed. */ } }
      else { clearTimeout(timer); setPhase("listening"); }
    };
    recognition.onresult = event => {
      if (active.current !== recognition || ended) return;
      const next = Array.from(event.results, result => result[0].transcript).join("");
      // Chrome may withdraw an interim result before ending. Keep the last
      // nonempty draft instead of silently erasing already recognized speech.
      if (!next.trim()) return;
      transcript = next;
      if (!stopping) { clearTimeout(timer); setPhase("listening"); }
      latest.current.onText(base + (base.trim() ? " " : "") + transcript);
    };
    recognition.onerror = event => {
      if (active.current !== recognition || ended) return;
      if (event.error !== "aborted" || !stopping) {
        failed = true;
        setError(["not-allowed", "service-not-allowed"].includes(event.error) ? "请允许麦克风及浏览器语音识别。原草稿已保留。" : event.error === "no-speech" ? "没有识别到声音，已识别文字和原草稿均已保留。" : "浏览器听写中断，已识别文字保留在草稿中。请检查网络后重试。");
      }
      end(); recognition.abort();
    };
    recognition.onend = end;
    finish.current = () => {
      stopping = true; clearTimeout(timer);
      timer = setTimeout(() => { if (!ended) { failed = true; setError("听写结束超时，已识别文字保留在草稿中。"); end(); recognition.abort(); } }, 8000);
      try { recognition.stop(); } catch { /* onstart will honor the queued stop. */ }
    };
    timer = setTimeout(() => {
      if (!ended) { failed = true; setError("听写服务未能启动，原草稿已保留。请检查麦克风和网络后重试。"); end(); recognition.abort(); }
    }, 12000);
    dispose.current = () => {
      ended = true; clearTimeout(timer); active.current = null; finish.current = null;
      recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
      recognition.abort();
    };
    try { recognition.start(); } catch { failed = true; setError("无法启动听写，原草稿已保留，请重试。"); end(); }
  }, []);
  useEffect(() => {
    const cancel = () => { dispose.current?.(); dispose.current = null; setPhase("idle"); };
    window.addEventListener("pagehide", cancel);
    return () => { window.removeEventListener("pagehide", cancel); cancel(); };
  }, []);
  return { listening: phase !== "idle", phase, error, notice, start, stop };
}
