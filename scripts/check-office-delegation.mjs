// Runs through the actual pinned Codex + MCP transport against a loopback model.
// No user's employee is messaged, and no paid model endpoint is used.
export async function checkOfficeDelegation({ client, restart, workspace, stateDirectory, data, fs, path, setModelFixture, payloads, check }) {
  const { project } = await client.call("project.create", { name: "Delegation fixture", rootPaths: [workspace], requestId: "delegation-project" });
  const manager = (await client.call("session.create", { name: "Fixture manager", projectId: project.id, requestId: "delegation-manager" })).threadId;
  const worker = (await client.call("session.create", { name: "Fixture worker", projectId: project.id, requestId: "delegation-worker" })).threadId;
  const ceo = "00000000-0000-4000-8000-000000000001";
  fs.mkdirSync(path.join(stateDirectory, "claw3d"), { recursive: true });
  fs.writeFileSync(path.join(stateDirectory, "claw3d/settings.json"), JSON.stringify({ office: { [`ws://localhost:${new URL(client.ws.url).port}`]: { organization: {
    [ceo]: { title: "CEO", reportsTo: [] }, [manager]: { title: "Head", reportsTo: [ceo] }, [worker]: { title: "Worker", reportsTo: [manager] },
  }, departmentDescriptions: { [project.id]: "Scoped fixture product work", "open-workspace": "Unassigned fixture work" } } } }));
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(predicate, label, timeout = 25000) {
    const end = Date.now() + timeout;
    while (!await predicate()) { if (Date.now() > end) throw new Error(label); await pause(30); }
  }
  // A new row may briefly show idle before its first native start event.
  // Wait for a terminal turn status before testing restart/resume.
  for (const id of [manager, worker]) {
    await client.call("session.send", { threadId: id, message: "Seed an existing conversation", requestId: "seed-" + id });
    await until(async () => { const state = await client.call("session.inspect", { threadId: id, includeHistory: false }); return state.status === "idle" && state.turnStatus === "completed"; }, "Seed turn did not finish");
  }
  const nativeIds = () => JSON.parse(fs.readFileSync(path.join(data, "office.json"), "utf8")).sessions.filter(row => [manager, worker].includes(row.id)).map(row => [row.id, row.codexThreadId]);
  const before = JSON.stringify(nativeIds());
  client = await restart();
  await client.call("office.snapshot"); // Wait for native turn reconciliation, not just HTTP readiness.
  const own = await client.call("todo.organization", { actorId: worker });
  const directory = await client.call("todo.organization", { actorId: worker, allDepartments: true });
  const shared = await client.call("todo.organization", { actorId: worker, departmentId: null });
  check("department context defaults to own scope and explicit read-only lookups use saved responsibilities", own.departments.length === 1 && own.departments[0].id === project.id && own.departments[0].description === "Scoped fixture product work" && directory.departments.length === 2 && shared.departments[0].id === "open-workspace" && directory.departments.find(row => row.id === project.id).heads[0].id === manager);
  const tools = await client.call("session.mcp", { threadId: manager });
  check("existing resumed conversations discover delegation MCP tools", tools.servers.some(server => server.name === "office_tasks" && server.tools === 15));
  const task = (await client.call("todo.create", { actorId: manager, assigneeId: manager, title: "One delegated user goal", phases: [{ title: "Execute" }, { title: "Manager acceptance" }], requestId: "delegation-task" })).todo;
  const operations = [], stages = new Map([[manager, 0], [worker, 0]]);
  let sawBusyInbox = false, number = 0;
  setModelFixture(async (payload, res) => {
    try {
      const serialized = (payload.input || []).filter(item => item.role === "developer").flatMap(item => item.content || []).map(item => item.text || "").join("\n");
      const caller = [...serialized.matchAll(/"company":\{"agentId":"([^"]+)"/g)].at(-1)?.[1];
      if (![manager, worker].includes(caller)) throw new Error("Fixture could not identify Office caller context");
      const stage = stages.get(caller); stages.set(caller, stage + 1);
      const current = (await client.call("todo.get", { id: task.id })).todo;
      const args = { id: task.id, revision: current.revision, actorId: caller, requestId: "fixture-op-" + (++number) };
      let operation;
      if (caller === manager) {
        if (stage === 0) operation = ["todo_delegate", { ...args, assigneeId: worker, instructions: "Implement one bounded fixture result. Do not deploy.", acceptanceCriteria: "Verified result and explicit no-deployment confirmation" }];
        else if (stage === 1) {
          // Keep the manager genuinely busy until the worker has submitted.
          await until(async () => (await client.call("todo.get", { id: task.id })).todo.delegations?.at(-1)?.state === "review", "Worker did not submit while manager was busy");
          const submitted = (await client.call("todo.get", { id: task.id })).todo;
          sawBusyInbox = submitted.delegations.at(-1).delivery.state === "pending" && !submitted.archived;
        } else if (stage === 2) operation = ["todo_review", { ...args, accept: false, notes: "Return once: include the missing no-deployment confirmation." }];
        else if (stage === 4) operation = ["todo_review", { ...args, accept: true, notes: "Read the corrected report and verified the expected result and no deployment." }];
        else if (stage === 5 || stage === 6) operation = ["todo_complete", { id: task.id, revision: current.revision, actorId: caller, phaseId: task.phases[stage - 5].id }];
      } else {
        if (stage === 0 || stage === 5) operation = ["todo_organization", { actorId: caller, ...(stage === 0 ? { allDepartments: true } : { departmentId: null }) }];
        else if (stage === 1 || stage === 2) operation = ["todo_complete", { id: task.id, revision: current.revision, actorId: caller, phaseId: task.phases[stage - 1].id }];
        else if (stage === 3 || stage === 6) operation = ["todo_submit", { ...args, report: stage === 3 ? "First result with test evidence" : "Corrected verified result; no deployment. Artifact: loopback fixture only." }];
      }
      let item;
      if (operation) {
        operations.push([caller, operation[0]]);
        const catalog = payload.tools || (payload.input || []).filter(item => item.type === "additional_tools").flatMap(item => item.tools || []);
        const exec = catalog.find(tool => tool.name === "functions")?.tools?.find(tool => tool.name === "exec");
        if (exec) item = { id: "handoff-call-" + number, type: "custom_tool_call", call_id: "handoff-call-" + number, name: "exec", namespace: "functions", input: `const tool=ALL_TOOLS.find(tool=>tool.name.endsWith(${JSON.stringify(operation[0])}));if(!tool)throw new Error("Missing Office delegation tool");text(await tools[tool.name](${JSON.stringify(operation[1])}));` };
        else {
          const namespace = catalog.find(tool => tool.name === "mcp__office_tasks"), tool = namespace?.tools?.find(tool => tool.name === operation[0]) || catalog.find(tool => tool.name?.endsWith(operation[0]));
          if (!tool) throw new Error("Delegation tool absent from native model request");
          item = { id: "handoff-call-" + number, type: "function_call", call_id: "handoff-call-" + number, name: tool.name, ...(namespace ? { namespace: namespace.name } : {}), arguments: JSON.stringify(operation[1]) };
        }
      } else item = { id: "handoff-reply-" + number, type: "message", role: "assistant", content: [{ type: "output_text", text: "OFFICE_HANDOFF_FIXTURE_OK" }] };
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [{ type: "response.created", response: { id: "handoff-response-" + number } }, { type: "response.output_item.done", output_index: 0, item }, { type: "response.completed", response: { id: "handoff-response-" + number, output: [item], usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 } } }]) res.write("data: " + JSON.stringify(event) + "\n\n");
      res.end();
    } catch (error) { console.error(error); res.writeHead(500); res.end(error.message); }
  });
  await client.call("session.send", { threadId: manager, message: "Implement the bounded fixture goal through your direct report and verify it. Do not deploy.", requestId: "manager-start" });
  await until(async () => (await client.call("todo.get", { id: task.id })).todo.status === "done", "Native delegation chain did not finish", 45000);
  await until(async () => (await client.call("office.snapshot")).agents.filter(row => [manager, worker].includes(row.id)).every(row => row.status === "idle"), "Native handoff turns did not finish");
  const finished = (await client.call("todo.get", { id: task.id })).todo;
  check("handoff keeps both pre-existing native thread identities", JSON.stringify(nativeIds()) === before);
  check("busy manager keeps a persistent pending review instead of being steered", sawBusyInbox);
  check("worker cannot close the final phase without manager acceptance", payloads.some(payload => JSON.stringify(payload).includes("obtain manager acceptance")));
  check("manager can return and accept the corrected report through real MCP", finished.delegations.length === 1 && finished.delegations[0].state === "accepted" && finished.delegations[0].report.includes("no deployment") && finished.events.some(event => event.message.includes("Manager returned for changes")));
  check("one user goal stays one task until manager closes it", (await client.call("todo.list", { status: "done" })).total === 1 && (await client.call("todo.list")).total === 0 && finished.archived);
  for (const id of [manager, worker]) {
    const history = await client.call("session.history", { threadId: id });
    check(`real ${id === manager ? "manager" : "worker"} conversation contains handoff and replies`, history.messages.some(message => message.role === "assistant" && message.content.includes("OFFICE_HANDOFF_FIXTURE_OK")) && history.messages.some(message => message.role === "user" && message.content.includes(task.id)));
  }
  check("real tool chain includes delegation, submission and two manager reviews", operations.filter(([, name]) => name === "todo_review").length === 2 && operations.filter(([, name]) => name === "todo_submit").length === 2);
  check("actual resumed MCP calls can read all departments and Open Workspace", operations.filter(([, name]) => name === "todo_organization").length === 2 && payloads.some(payload => JSON.stringify(payload).includes("Unassigned fixture work")));
  setModelFixture(null);
  return client;
}
