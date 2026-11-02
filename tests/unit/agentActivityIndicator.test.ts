import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AgentActivityIndicator } from "@/features/office/components/AgentActivityIndicator";
import { ScheduledTaskIndicator } from "@/features/office/components/ScheduledTaskIndicator";
import { getAgentActivity } from "@/features/retro-office/core/agentActivity";

afterEach(cleanup);
it.each([
  [{ status: "working" as const }, "Working"],
  [{ status: "idle" as const }, "Idle"],
  [{ status: "idle" as const, needsInput: true }, "Needs your input"],
  [{ status: "idle" as const, needsReview: true }, "New result to review"],
] as const)("shows a pending schedule alongside %j", (agent, label) => {
  const renderIndicators = (active: boolean) => React.createElement("div", null,
    React.createElement(AgentActivityIndicator, { activity: getAgentActivity(agent) }),
    React.createElement(ScheduledTaskIndicator, { active }));
  const view = render(renderIndicators(true));
  expect(screen.getByRole("img", { name: "Pending scheduled task" })).toBeVisible();
  expect(screen.getByRole("img", { name: label })).toBeVisible();
  view.rerender(renderIndicators(false));
  expect(screen.queryByRole("img", { name: "Pending scheduled task" })).toBeNull();
  expect(screen.getByRole("img", { name: label })).toBeVisible();
});
it("distinguishes input requests, unread results and errors with the scene's status markers", () => {
  const view = render(React.createElement(AgentActivityIndicator, { activity: getAgentActivity({ status: "working", needsInput: true }) }));
  expect(screen.getByRole("img", { name: "Needs your input" })).toHaveTextContent("!");
  expect(screen.getByRole("img", { name: "Needs your input" })).toHaveStyle({ color: "#facc15" });
  view.rerender(React.createElement(AgentActivityIndicator, { activity: getAgentActivity({ status: "idle", needsReview: true }) }));
  expect(screen.getByRole("img", { name: "New result to review" })).toHaveTextContent("?");
  expect(screen.getByRole("img", { name: "New result to review" })).toHaveStyle({ color: "#facc15" });
  view.rerender(React.createElement(AgentActivityIndicator, { activity: getAgentActivity({ status: "error", needsInput: true }) }));
  expect(screen.getByRole("img", { name: "Error" })).toHaveStyle({ color: "#fb7185" });
});
it("clears attention markers after review and prioritizes a new run over an old result", () => {
  const view = render(React.createElement(AgentActivityIndicator, { activity: getAgentActivity({ status: "idle", needsReview: true }) }));
  view.rerender(React.createElement(AgentActivityIndicator, { activity: getAgentActivity({ status: "idle", needsReview: false }) }));
  expect(screen.getByRole("img", { name: "Idle" })).toHaveTextContent("");
  expect(screen.queryByRole("img", { name: "New result to review" })).toBeNull();
  view.rerender(React.createElement(AgentActivityIndicator, { activity: getAgentActivity({ status: "working", needsReview: true }) }));
  expect(screen.getByRole("img", { name: "Working" })).toHaveTextContent("⚙︎");
});
