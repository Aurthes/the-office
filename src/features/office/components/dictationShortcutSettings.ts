"use client";
import { useSyncExternalStore } from "react";

export const DICTATION_SHORTCUT_KEY = "claw3d:dictation-shortcut";
const CHANGE_EVENT = "claw3d:dictation-shortcut-change";
export const DEFAULT_DICTATION_SHORTCUT = "ctrl-shift-space";
export type DictationShortcut = typeof DEFAULT_DICTATION_SHORTCUT | "option" | "off";
let fallback: DictationShortcut = DEFAULT_DICTATION_SHORTCUT;

function readShortcut(): DictationShortcut {
  try {
    const value = localStorage.getItem(DICTATION_SHORTCUT_KEY);
    return value === "option" || value === "off" ? value : DEFAULT_DICTATION_SHORTCUT;
  } catch { return fallback; }
}
function subscribe(update: () => void) {
  window.addEventListener(CHANGE_EVENT, update);
  window.addEventListener("storage", update);
  return () => { window.removeEventListener(CHANGE_EVENT, update); window.removeEventListener("storage", update); };
}
export function setDictationShortcut(value: DictationShortcut) {
  fallback = value;
  try { localStorage.setItem(DICTATION_SHORTCUT_KEY, value); } catch { /* Keep working in this tab. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
export function useDictationShortcutSetting(): DictationShortcut {
  return useSyncExternalStore<DictationShortcut>(subscribe, readShortcut, () => DEFAULT_DICTATION_SHORTCUT);
}
export function dictationShortcutLabel(shortcut: DictationShortcut) {
  return shortcut === "option" ? "Option / Alt" : shortcut === "off" ? "Off" : "Ctrl + Shift + Space";
}
export function matchesDictationShortcut(event: KeyboardEvent, shortcut: DictationShortcut) {
  if (event.metaKey) return false;
  if (shortcut === "option") return event.key === "Alt" && !event.ctrlKey && !event.shiftKey;
  return shortcut === "ctrl-shift-space" && event.code === "Space" && event.ctrlKey && event.shiftKey && !event.altKey;
}
