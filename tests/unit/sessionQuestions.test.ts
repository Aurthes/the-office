import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionQuestions } from "@/features/office/components/SessionQuestions";
afterEach(cleanup);
const request = { requestId: "original-prompt", questions: [{ id: "q", question: "选择方向", isOther: true, options: [{ label: "One", description: "First direction" }, { label: "Two" }] }] };
describe("native question form", () => {
  it("preselects an async recommendation and waits for an explicit submission", async () => {
    const call = vi.fn(async () => ({}));
    render(React.createElement(SessionQuestions, { client: { call }, threadId: "async-thread", request: { ...request, questions: [{ ...request.questions[0], defaultAnswer: "One" }] } }));
    expect(screen.getByRole("radio", { name: /One/ })).toBeChecked();
    expect(call).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" })); await act(async () => {});
    expect(call).toHaveBeenCalledExactlyOnceWith("session.question.reply", expect.objectContaining({ answers: { q: "One" } }));
  });
  it("requires an explicit choice and submits to the original thread once", async () => {
    const call = vi.fn(async () => ({}));
    render(React.createElement(SessionQuestions, { client: { call }, threadId: "original-thread", request }));
    expect(screen.getByRole("button", { name: "Submit answer" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /One/ })); fireEvent.submit(screen.getByRole("form"));
    fireEvent.submit(screen.getByRole("form")); await act(async () => {});
    expect(call).toHaveBeenCalledExactlyOnceWith("session.question.reply", expect.objectContaining({ threadId: "original-thread", promptId: "original-prompt", answers: { q: "One" } }));
    expect(screen.getByRole("status")).toHaveTextContent("Answer submitted");
  });
  it("supports custom answers and retains them if submission fails", async () => {
    const call = vi.fn(async () => { throw new Error("not confirmed"); });
    render(React.createElement(SessionQuestions, { client: { call }, threadId: "t", request }));
    fireEvent.click(screen.getByRole("radio", { name: "Custom answer" }));
    fireEvent.change(screen.getByLabelText("选择方向"), { target: { value: "another direction" } });
    fireEvent.submit(screen.getByRole("form")); await act(async () => {});
    expect(screen.getByRole("alert")).toHaveTextContent("not confirmed");
    expect(screen.getByLabelText("选择方向")).toHaveValue("another direction");
  });
});
