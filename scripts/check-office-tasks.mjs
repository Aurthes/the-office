// Used by check-macos-browser: real Office storage, gateway, MCP and browser;
// only the model response is a local fixture. No production data is accessed.
export async function checkOfficeTasks({ page, call, expect, setModelFixture, screenshots, browserName, fs, path }) {
  const roster = await call("office.snapshot"), agent = roster.agents.find(agent => agent.name === "Mac verification recruit"), alpha = roster.projects.find(project => project.name === "Alpha team");
  const initial = await call("todo.list");
  if (initial.todos.length) throw Error("A greeting or general chat created an unwanted task");
  const wholeShip = page.getByRole("button", { name: "Whole ship", exact: true });
  if (await wholeShip.getAttribute("aria-pressed") === "true") await wholeShip.click();
  const whiteboard = page.locator("[data-task-whiteboard]");
  await expect(whiteboard).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Open tasks:/ })).toHaveCount(0);
  const mainScreen = page.locator("[data-monitor-main-screen]");
  await expect(mainScreen.locator("svg.monitor-illustration")).toHaveCount(1);
  await expect(mainScreen.getByRole("button")).toHaveCount(0);
  await mainScreen.dispatchEvent("click");
  await expect(page.getByRole("dialog", { name: "Monitor room", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close monitoring dashboard", exact: true }).click();
  await whiteboard.dispatchEvent("click");
  const board = page.getByRole("dialog", { name: "Task board", exact: true });
  await expect(board).toBeVisible();
  await page.getByRole("button", { name: "New to-do", exact: true }).click();
  await page.getByLabel("Task title", { exact: true }).fill("Shared task browser check");
  await page.getByLabel("Department", { exact: true }).selectOption(alpha.id);
  await page.getByLabel("Assigned to", { exact: true }).selectOption(agent.id);
  await page.getByLabel("Documentation", { exact: true }).fill("Browser-created plan.");
  await page.getByRole("button", { name: "Save to-do", exact: true }).click();
  await expect(board.getByRole("heading", { name: "Shared task browser check", exact: true })).toBeVisible();
  let todo = (await call("todo.list", { query: "Shared task browser check" })).todos[0];
  if (!todo || todo.phases.length !== 3 || todo.departmentId !== alpha.id || todo.assigneeId !== agent.id) throw Error("Human task creation failed");
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  await expect.poll(async () => (await call("todo.get", { id: todo.id })).todo.status).toBe("running");
  await page.getByRole("checkbox", { name: "Plan", exact: true }).click();
  await expect.poll(async () => (await call("todo.get", { id: todo.id })).todo.progress).toBe(1);
  await page.getByRole("button", { name: "Pause timer", exact: true }).click();
  await expect.poll(async () => (await call("todo.get", { id: todo.id })).todo.status).toBe("paused");
  await page.getByRole("button", { name: "Close task board", exact: true }).click();
  // The unique control-room whiteboard opens all departments; filter inside.
  await whiteboard.dispatchEvent("click");
  await expect(board).toBeVisible();
  await expect(board.locator("header p")).toHaveText("All departments");
  await board.getByRole("button", { name: /^Alpha team/ }).click();
  await expect(board.locator("header p")).toHaveText("Alpha team");
  await expect(board.getByText("Shared task browser check", { exact: true })).toBeVisible();
  await board.getByRole("button", { name: /Shared task browser check/ }).click();
  // Feed actual MCP function calls through the bundled Codex app-server. The
  // tools are discovered from the real request, never hard-coded model names.
  const mcp = await call("session.mcp", { threadId: agent.id });
  if (!mcp.servers.some(server => server.name === "office_tasks" && server.tools === 15)) throw Error("Office task tools were not registered");
  const toolCalls = []; let stage = 0;
  setModelFixture(async (payload, res, number) => {
    try {
      const current = (await call("todo.get", { id: todo.id })).todo;
      const operations = [
        ["todo_edit", { id: todo.id, revision: current.revision, actorId: agent.id, documentation: "Agent verified the shared task through the Office MCP service." }],
        ["todo_complete", { id: todo.id, revision: current.revision, actorId: agent.id, phaseId: current.phases[1].id }],
        ["todo_complete", { id: todo.id, revision: current.revision, actorId: agent.id, phaseId: current.phases[2].id }],
      ];
      const catalog = payload.tools || (payload.input || []).filter(item => item.type === "additional_tools").flatMap(item => item.tools || []);
      const exec = catalog.find(tool => tool.name === "functions")?.tools?.find(tool => tool.name === "exec");
      const operation = catalog.length ? operations[stage++] : null;
      let item;
      if (operation) {
        toolCalls.push(operation[0]);
        if (exec) {
          // Current Codex models expose MCP tools through their native code
          // mode. Resolve the real tool registry inside that runtime.
          item = { id: "tool-item-" + number, type: "custom_tool_call", call_id: "office-call-" + number, name: "exec", namespace: "functions", input: `const tool=ALL_TOOLS.find(tool=>tool.name.endsWith(${JSON.stringify(operation[0])}));if(!tool)throw new Error("Office task tool is missing");text(await tools[tool.name](${JSON.stringify(operation[1])}));` };
        } else {
          const namespace = catalog.find(tool => tool.name === "mcp__office_tasks"), tool = namespace?.tools?.find(tool => tool.name === operation[0]) || catalog.find(tool => tool.name?.endsWith(operation[0]));
          if (!tool) throw Error("Bundled Codex did not discover Office MCP tool " + operation[0]);
          item = { id: "tool-item-" + number, type: "function_call", call_id: "office-call-" + number, name: tool.name, ...(namespace ? { namespace: namespace.name } : {}), arguments: JSON.stringify(operation[1]) };
        }
      } else item = { id: "task-reply-" + number, type: "message", role: "assistant", content: [{ type: "output_text", text: "OFFICE_TASK_MCP_VERIFIED" }] };
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [{ type: "response.created", response: { id: "task-response-" + number } }, { type: "response.output_item.done", output_index: 0, item }, { type: "response.completed", response: { id: "task-response-" + number, output: [item], usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 } } }]) res.write("data: " + JSON.stringify(event) + "\n\n");
      res.end();
    } catch (error) { console.error(error); res.writeHead(500); res.end(error.message); }
  });
  await page.getByRole("button", { name: "Start with agent", exact: true }).click();
  await expect.poll(async () => (await call("todo.get", { id: todo.id })).todo.status, { timeout: 30000 }).toBe("done");
  await expect(board.getByText("Agent verified the shared task through the Office MCP service.", { exact: true })).toBeVisible();
  if (toolCalls.join(",") !== "todo_edit,todo_complete,todo_complete") throw Error("Agent task progress did not use the shared MCP service");
  await expect.poll(async () => (await call("session.inspect", { threadId: agent.id, includeHistory: false })).status).toBe("idle");
  const beforeQuestion = (await call("todo.get", { id: todo.id })).todo, countBeforeQuestion = (await call("todo.list")).total;
  if (!beforeQuestion.archived || !Number.isFinite(beforeQuestion.completedAt) || countBeforeQuestion !== 0) throw Error("Completed work did not automatically leave the current board");
  await expect(board.locator('[data-completion-kind="task"] time')).toHaveAttribute("datetime", new Date(beforeQuestion.completedAt).toISOString());
  await expect(board.locator('[data-completion-kind="phase"] time')).toHaveCount(3);
  await call("session.send", { threadId: agent.id, message: "Just a general question: what does PNL stand for? Do not perform any work.", requestId: "task-board-general-question" });
  await expect.poll(async () => (await call("session.inspect", { threadId: agent.id, includeHistory: false })).status).toBe("idle");
  if ((await call("todo.list")).total !== countBeforeQuestion) throw Error("A general follow-up created a task");
  const afterQuestion = (await call("todo.get", { id: todo.id })).todo;
  if (afterQuestion.revision !== beforeQuestion.revision || afterQuestion.status !== "done") throw Error("A general question reopened or changed completed work");
  const reopened = (await call("todo.reopen", { id: todo.id, revision: afterQuestion.revision, phaseId: afterQuestion.phases[2].id })).todo;
  const paused = (await call("todo.pause", { id: todo.id, revision: reopened.revision })).todo;
  await call("session.send", { threadId: agent.id, message: "Thanks! Just chatting, no work requested.", requestId: "task-board-casual-paused" });
  await expect.poll(async () => (await call("session.inspect", { threadId: agent.id, includeHistory: false })).status).toBe("idle");
  const afterChat = (await call("todo.get", { id: todo.id })).todo;
  if (afterChat.revision !== paused.revision || afterChat.status !== "paused" || afterChat.elapsedMs !== paused.elapsedMs) throw Error("Casual chat resumed a paused task timer");
  await call("todo.complete", { id: todo.id, revision: paused.revision, phaseId: paused.phases[2].id });
  const completedHistory = (await call("todo.get", { id: todo.id })).todo;
  await expect(board.locator('[data-completion-kind="task"] time')).toHaveAttribute("datetime", new Date(completedHistory.completedAt).toISOString());
  // A narrow phone keeps the board within the viewport and preserves controls.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  const fits = await board.evaluate(node => node.getBoundingClientRect().width <= innerWidth && node.scrollWidth <= node.clientWidth + 1);
  if (!fits) throw Error("Task board overflows the phone viewport");
  if (screenshots) { fs.mkdirSync(screenshots, { recursive: true }); await page.screenshot({ path: path.join(screenshots, browserName + "-task-board-mobile.png") }); }
  await page.getByRole("button", { name: "Task list", exact: true }).click();
  await expect(board.getByText("No to-dos here yet.", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Task status", exact: true }).selectOption("archived");
  await board.getByRole("button", { name: /Shared task browser check/ }).click();
  await page.getByRole("button", { name: "Add follow-up", exact: true }).click();
  await page.getByLabel("Phase title", { exact: true }).last().fill("Check follow-up");
  await page.getByRole("button", { name: "Save to-do", exact: true }).click();
  await expect.poll(async () => (await call("todo.get", { id: todo.id })).todo.status).toBe("queued");
  const followup = (await call("todo.get", { id: todo.id })).todo;
  if (followup.archived || followup.completedAt != null || followup.phases.slice(0, 3).some((phase, i) => phase.completedAt !== completedHistory.phases[i].completedAt)) throw Error("Follow-up lost the completed phase history");
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect.poll(async () => (await call("todo.get", { id: todo.id })).todo.archived).toBe(true);
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect.poll(async () => (await call("todo.get", { id: todo.id })).todo.archived).toBe(false);
  const restored = (await call("todo.get", { id: todo.id })).todo;
  await call("todo.complete", { id: restored.id, revision: restored.revision, phaseId: restored.phases[3].id });
  if ((await call("todo.list")).total !== 0) throw Error("Completed follow-up stayed on the current board");
  await page.getByRole("button", { name: "Close task board", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (screenshots) {
    await page.waitForTimeout(800); // Let the room camera settle after the modal closes.
    await page.screenshot({ path: path.join(screenshots, browserName + "-control-room-whiteboard.png") });
  }
  await whiteboard.dispatchEvent("click");
  await expect(board).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Task status", exact: true })).toHaveValue("all");
  await expect(board.getByText("No to-dos here yet.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close task board", exact: true }).click();
  // Task badges follow unfinished assignments even while the session is idle.
  await page.getByRole("button", { name: "CHAT", exact: true }).click();
  await page.getByRole("button", { name: "Open session: Mac verification recruit", exact: true }).first().click();
  const directory = page.locator("#session-chat-list");
  await expect(directory).toBeVisible();
  await page.getByRole("combobox", { name: "Organize agents", exact: true }).selectOption("activity");
  let assigned = (await call("todo.create", { title: "Persistent assignment (PA)", departmentId: alpha.id, assigneeId: agent.id, phases: [{ title: "First" }, { title: "Second" }], requestId: "persistent-assignment-browser" })).todo;
  const badge = directory.getByRole("button", { name: "Open task: Persistent assignment (PA)", exact: true });
  await expect(badge).toBeVisible(); // Queued, with an idle agent.
  assigned = (await call("todo.start", { id: assigned.id, revision: assigned.revision })).todo;
  await expect(badge).toBeVisible();
  assigned = (await call("todo.complete", { id: assigned.id, revision: assigned.revision, phaseId: assigned.phases[0].id })).todo;
  await expect(badge).toBeVisible(); // Completing one phase retains the assignment.
  assigned = (await call("todo.pause", { id: assigned.id, revision: assigned.revision })).todo;
  await expect(badge).toBeVisible();
  const extra = (await call("todo.create", { title: "Secondary assignment (SA)", departmentId: alpha.id, assigneeId: agent.id, phases: [{ title: "Execute" }], requestId: "secondary-assignment-browser" })).todo;
  const count = directory.getByRole("button", { name: "Tasks assigned to Mac verification recruit: 2", exact: true });
  await expect(count).toBeVisible();
  await count.click();
  const assignedList = directory.getByRole("group", { name: "Tasks assigned to Mac verification recruit", exact: true });
  await expect(assignedList.getByRole("button")).toHaveCount(2);
  // Expanded task titles stay inside the narrow sidebar and remain clickable.
  await page.setViewportSize({ width: 390, height: 844 });
  const contained = await assignedList.evaluate(node => {
    const list = node.getBoundingClientRect(), sidebar = node.closest("aside").getBoundingClientRect();
    return list.left >= sidebar.left && list.right <= sidebar.right + 1 && node.scrollWidth <= node.clientWidth + 1;
  });
  if (!contained) throw Error("Assigned task dropdown overflows the sidebar");
  if (screenshots) await page.screenshot({ path: path.join(screenshots, browserName + "-assigned-tasks-mobile.png") });
  await assignedList.getByRole("button", { name: "Open task: Secondary assignment (SA)", exact: true }).click();
  await expect(board.getByRole("heading", { name: "Secondary assignment (SA)", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close task board", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const otherAgent = roster.agents.find(other => other.id !== agent.id);
  let moved = (await call("todo.edit", { id: extra.id, revision: extra.revision, assigneeId: otherAgent.id })).todo;
  await expect(count).toHaveCount(0);
  await expect(badge).toBeVisible();
  const movedCard = directory.locator(`[data-person-id="${otherAgent.id}"]`);
  await expect(movedCard.getByRole("button", { name: "Open task: Secondary assignment (SA)", exact: true })).toBeVisible();
  moved = (await call("todo.edit", { id: moved.id, revision: moved.revision, assigneeId: null })).todo;
  await expect(directory.getByRole("button", { name: "Open task: Secondary assignment (SA)", exact: true })).toHaveCount(0);
  await call("todo.archive", { id: moved.id, revision: moved.revision });
  await call("todo.complete", { id: assigned.id, revision: assigned.revision, phaseId: assigned.phases[1].id });
  await expect(badge).toHaveCount(0);
  await page.getByRole("button", { name: "Close chat and return to office", exact: true }).click();
  console.log(JSON.stringify({ assignedBadgesPersistQueuedPausedIdle: true, phaseCompletionKeepsBadge: true, multipleAssignmentsExpandable: true, mobileAssignmentListFits: true, taskLinksOpenDetails: true, reassignmentMovesBadge: true, unassignmentAndCompletionRemoveBadge: true }));
  setModelFixture(null);
  console.log(JSON.stringify({ globalTaskEntry: true, singleControlRoomWhiteboard: true, pnlScreenIndependent: true, departmentFilter: true, sharedTaskRecords: true, generalChatCreatesNoTask: true, generalFollowupCreatesNoTask: true, casualChatLeavesPausedTimerStopped: true, phaseAdvance: true, humanEditing: true, agentMcpProgress: true, mobileTaskBoard: true, autoArchiveOnCompletion: true, phaseAndTaskCompletionTimes: true, followupPreservesHistory: true, archiveRestore: true }));
}
