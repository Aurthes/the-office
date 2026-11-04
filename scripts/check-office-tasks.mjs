// Used by check-macos-browser: real Office storage, gateway, MCP and browser;
// only the model response is a local fixture. No production data is accessed.
export async function checkOfficeTasks({ page, call, expect, setModelFixture, screenshots, browserName, fs, path }) {
  const roster = await call("office.snapshot"), agent = roster.agents.find(agent => agent.name === "Mac verification recruit"), alpha = roster.projects.find(project => project.name === "Alpha team");
  const initial = await call("todo.list");
  if (!initial.todos.some(todo => todo.assigneeId === agent.id && todo.status === "paused")) throw Error("Chat intake or turn-end timer pause failed");
  const wholeShip = page.getByRole("button", { name: "Whole ship", exact: true });
  if (await wholeShip.getAttribute("aria-pressed") === "true") await wholeShip.click();
  // Open the global monitoring-room screen. Html can be off-camera in overview;
  // its actual scene button is still the entry being exercised.
  await page.getByRole("button", { name: "Open task board", exact: true }).first().dispatchEvent("click");
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
  // A department whiteboard opens the same durable record, scoped to that team.
  await page.getByRole("button", { name: /^Open tasks: Alpha team/ }).first().dispatchEvent("click");
  await expect(board).toBeVisible();
  await expect(board.locator("header p")).toHaveText("Alpha team");
  await expect(board.getByText("Shared task browser check", { exact: true })).toBeVisible();
  await board.getByRole("button", { name: /Shared task browser check/ }).click();
  // Feed actual MCP function calls through the bundled Codex app-server. The
  // tools are discovered from the real request, never hard-coded model names.
  const mcp = await call("session.mcp", { threadId: agent.id });
  if (!mcp.servers.some(server => server.name === "office_tasks" && server.tools === 10)) throw Error("Office task tools were not registered");
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
  // A narrow phone keeps the board within the viewport and preserves controls.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  const fits = await board.evaluate(node => node.getBoundingClientRect().width <= innerWidth && node.scrollWidth <= node.clientWidth + 1);
  if (!fits) throw Error("Task board overflows the phone viewport");
  if (screenshots) { fs.mkdirSync(screenshots, { recursive: true }); await page.screenshot({ path: path.join(screenshots, browserName + "-task-board-mobile.png") }); }
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect.poll(async () => (await call("todo.get", { id: todo.id })).todo.archived).toBe(true);
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect.poll(async () => (await call("todo.get", { id: todo.id })).todo.archived).toBe(false);
  await page.getByRole("button", { name: "Close task board", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  setModelFixture(null);
  console.log(JSON.stringify({ globalTaskEntry: true, departmentWhiteboardEntry: true, sharedTaskRecords: true, chatIntake: true, phaseAdvance: true, humanEditing: true, agentMcpProgress: true, mobileTaskBoard: true, archiveRestore: true }));
}
