import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionQuestions } from "@/features/office/components/SessionQuestions";
afterEach(cleanup);
const request = { requestId: "original-prompt", questions: [{ id: "q", question: "选择方向", isOther: true, options: [{ label: "One", description: "First direction" }, { label: "Two" }] }] };
describe("native question form", () => {
  it("submits a clicked option immediately to the original thread and blocks double clicks", async () => {
    let resolve!: (value: unknown) => void;
    const call = vi.fn(() => new Promise(r => { resolve = r; }));
    render(React.createElement(SessionQuestions, { client: { call }, threadId: "original-thread", request }));
    expect(screen.queryByRole("button", { name: "Submit answer" })).not.toBeInTheDocument();
    const choice = screen.getByRole("button", { name: /One/ });
    fireEvent.click(choice); fireEvent.click(choice);
    expect(call).toHaveBeenCalledExactlyOnceWith("session.question.reply", expect.objectContaining({ threadId: "original-thread", promptId: "original-prompt", answers: { q: "One" } }));
    expect(screen.getByRole("status")).toHaveTextContent("Submitting");
    await act(async () => resolve({}));
    expect(screen.getByRole("status")).toHaveTextContent("Answer submitted");
    expect(choice).toBeDisabled();
  });
  it("waits for every explicit choice instead of submitting other questions' defaults", async () => {
    const call = vi.fn(async () => ({}));
    const questions = [{ ...request.questions[0], defaultAnswer: "One" }, { id: "second", question: "Second question", defaultAnswer: "A", options: [{ label: "A" }, { label: "B" }] }];
    render(React.createElement(SessionQuestions, { client: { call }, threadId: "multi-thread", request: { ...request, questions } }));
    expect(call).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /One/ }));
    expect(call).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /One/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Submit answer" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "B" })); await act(async () => {});
    expect(call).toHaveBeenCalledExactlyOnceWith("session.question.reply", expect.objectContaining({ answers: { q: "One", second: "B" } }));
  });
  it("requires Submit for custom text and retains the answer if submission fails", async () => {
    const call = vi.fn(async () => { throw new Error("not confirmed"); });
    render(React.createElement(SessionQuestions, { client: { call }, threadId: "t", request }));
    fireEvent.click(screen.getByRole("button", { name: "Custom answer" }));
    expect(screen.getByRole("button", { name: "Submit answer" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("选择方向"), { target: { value: "another direction" } });
    expect(call).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" })); await act(async () => {});
    expect(call).toHaveBeenCalledExactlyOnceWith("session.question.reply", expect.objectContaining({ answers: { q: "another direction" } }));
    expect(screen.getByRole("alert")).toHaveTextContent("not confirmed");
    expect(screen.getByLabelText("选择方向")).toHaveValue("another direction");
  });
  it("does not send a custom draft when another question's option is clicked", async () => {
    const call = vi.fn(async () => ({}));
    const questions = [...request.questions, { id: "second", question: "Second question", options: [{ label: "A" }] }];
    render(React.createElement(SessionQuestions, { client: { call }, threadId: "mixed-thread", request: { ...request, questions } }));
    fireEvent.click(screen.getByRole("button", { name: "Custom answer" }));
    fireEvent.change(screen.getByLabelText("选择方向"), { target: { value: "my custom answer" } });
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    expect(call).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" })); await act(async () => {});
    expect(call).toHaveBeenCalledExactlyOnceWith("session.question.reply", expect.objectContaining({ answers: { q: "my custom answer", second: "A" } }));
  });
  it("lets a preset replace a custom draft and sends only the clicked choice", async () => {
    const call = vi.fn(async () => ({}));
    render(React.createElement(SessionQuestions, { client: { call }, threadId: "switch-thread", request }));
    fireEvent.click(screen.getByRole("button", { name: "Custom answer" }));
    fireEvent.change(screen.getByLabelText("选择方向"), { target: { value: "unsent custom draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Two" })); await act(async () => {});
    expect(call).toHaveBeenCalledExactlyOnceWith("session.question.reply", expect.objectContaining({ answers: { q: "Two" } }));
    expect(screen.queryByRole("button", { name: "Submit answer" })).not.toBeInTheDocument();
  });
  it("keeps Submit and form submission for questions without presets", async () => {
    const call = vi.fn(async () => ({}));
    render(React.createElement(SessionQuestions, { client: { call }, threadId: "text-thread", request: { requestId: "text", questions: [{ id: "q", question: "Your answer" }] } }));
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "anything I want" } });
    expect(call).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByRole("form")); await act(async () => {});
    expect(call).toHaveBeenCalledExactlyOnceWith("session.question.reply", expect.objectContaining({ answers: { q: "anything I want" } }));
  });
});
