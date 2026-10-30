import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SessionTranscript } from "../../src/features/office/components/SessionTranscript";
afterEach(cleanup);

it("collapses native commentary and tools once per turn while leaving user, partial and final answers visible", () => {
  render(React.createElement(SessionTranscript, { messages: [
    { id: "u", turnId: "t", role: "user", content: "Question" },
    { id: "c", turnId: "t", role: "assistant", phase: "commentary", content: "Investigating" },
    { id: "tool", turnId: "t", role: "tool", content: "echo fixture" },
    { id: "p", turnId: "t", role: "assistant", phase: "partial_answer", content: "Stable answer" },
    { id: "f", turnId: "t", role: "assistant", phase: "final_answer", content: "**Final answer**" },
    { id: "legacy", turnId: "old", role: "assistant", content: "Legacy answer" },
  ] }));
  const details = screen.getByLabelText("工作过程") as HTMLDetailsElement;
  expect(details.open).toBe(false);
  expect(details.textContent).toContain("Investigating");
  expect(details.textContent).toContain("echo fixture");
  for (const text of ["Question", "Stable answer", "Final answer", "Legacy answer"]) expect(screen.getByText(text).closest("details")).toBeNull();
  fireEvent.click(screen.getByText("工作过程 · 2 项"));
  // Native <details> owns expansion; no custom collapse state is needed.
  expect(screen.getAllByLabelText("工作过程")).toHaveLength(1);
});
