import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DICTATION_SHORTCUT_KEY, setDictationShortcut, useDictationShortcutSetting } from "@/features/office/components/dictationShortcutSettings";

afterEach(() => { cleanup(); vi.restoreAllMocks(); setDictationShortcut("ctrl-shift-space"); localStorage.clear(); });
it("saves choices, follows other tabs, and rejects unknown stored values", () => {
  const view = renderHook(useDictationShortcutSetting);
  expect(view.result.current).toBe("ctrl-shift-space");
  act(() => setDictationShortcut("off"));
  expect(view.result.current).toBe("off"); expect(localStorage.getItem(DICTATION_SHORTCUT_KEY)).toBe("off");
  view.unmount(); const next = renderHook(useDictationShortcutSetting);
  expect(next.result.current).toBe("off");
  act(() => { localStorage.setItem(DICTATION_SHORTCUT_KEY, "option"); window.dispatchEvent(new StorageEvent("storage", { key: DICTATION_SHORTCUT_KEY })); });
  expect(next.result.current).toBe("option");
  act(() => { localStorage.setItem(DICTATION_SHORTCUT_KEY, "unknown"); window.dispatchEvent(new StorageEvent("storage", { key: DICTATION_SHORTCUT_KEY })); });
  expect(next.result.current).toBe("ctrl-shift-space");
});
it("keeps the current tab usable if browser storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("blocked"); });
  const view = renderHook(useDictationShortcutSetting);
  act(() => setDictationShortcut("off")); expect(view.result.current).toBe("off");
});
