import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AgentActivityIndicator } from "@/features/office/components/AgentActivityIndicator";
import { getAgentActivity } from "@/features/retro-office/core/agentActivity";

afterEach(cleanup);
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
