import React from "react";
import { flushSync } from "react-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SessionControls, type SessionClient } from "../../src/features/office/components/SessionControls";

afterEach(cleanup);

it("inserts external dictation once when React and the mention editor both delegate paste to document", async () => {
  const call = vi.fn<SessionClient["call"]>(async () => ({ connected: true, version: 1, activeTurnId: null, items: [], approvals: [], features: { prediction: false, voice: false, dictation: false } }));
  // Next's document root differs from the usual div root in component tests.
  render(React.createElement("html", {}, React.createElement("head"), React.createElement("body", {},
    React.createElement(SessionControls, { client: { call }, threadId: "document-paste", onItems: vi.fn() }))), { container: document });
  const input = screen.getByRole("textbox", { name: "Send to session" }) as HTMLTextAreaElement;
  await waitFor(() => expect(input).toBeEnabled()); input.focus();
  const descriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
  Object.defineProperty(document, "execCommand", { configurable: true, value: (_command: string, _ui: boolean, text: string) => {
    // Native insertText emits input and flushes that discrete update before
    // the original paste proceeds to the editor's other document listener.
    flushSync(() => { input.setRangeText(text, input.selectionStart, input.selectionEnd, "end"); fireEvent.input(input, { inputType: "insertText", data: text }); });
    return true;
  } });
  try {
    for (const text of ["语音第一段。", "第二段。", "第二段。"]) {
      fireEvent.paste(input, { clipboardData: { files: [], getData: (type: string) => type === "text/plain" ? text : "" } });
    }
    expect(input).toHaveValue("语音第一段。第二段。第二段。");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.send", expect.objectContaining({ message: "语音第一段。第二段。第二段。" })));
    expect(call.mock.calls.filter(([method]) => method === "session.send")).toHaveLength(1);
  } finally {
    if (descriptor) Object.defineProperty(document, "execCommand", descriptor); else Reflect.deleteProperty(document, "execCommand");
  }
});
