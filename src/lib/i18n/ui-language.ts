"use client";

import { useMemo, useSyncExternalStore } from "react";
import { translateUi } from "./messages";

export type UiLanguage = "en" | "zh-CN";
export const UI_LANGUAGE_KEY = "claw3d:ui-language";
const CHANGE_EVENT = "claw3d:ui-language-change";
let fallbackLanguage: UiLanguage = "en";

function readLanguage(): UiLanguage {
  try {
    return localStorage.getItem(UI_LANGUAGE_KEY) === "zh-CN" ? "zh-CN" : "en";
  } catch {
    return fallbackLanguage;
  }
}

function subscribe(onChange: () => void) {
  const update = () => {
    document.documentElement.lang = readLanguage();
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, update);
  window.addEventListener("storage", update);
  update();
  return () => {
    window.removeEventListener(CHANGE_EVENT, update);
    window.removeEventListener("storage", update);
  };
}

export function setUiLanguage(language: UiLanguage) {
  fallbackLanguage = language === "zh-CN" ? "zh-CN" : "en";
  try { localStorage.setItem(UI_LANGUAGE_KEY, fallbackLanguage); } catch { /* The current tab still works without storage. */ }
  document.documentElement.lang = fallbackLanguage;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useUiLanguage() {
  const language = useSyncExternalStore(subscribe, readLanguage, () => "en" as const);
  return { language, setLanguage: setUiLanguage };
}

export function useUiText() {
  const { language } = useUiLanguage();
  return useMemo(() => (text: string, values?: Record<string, string | number>) => translateUi(text, language, values), [language]);
}
