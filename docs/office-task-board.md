# Office task board

The monitoring room has one independent task whiteboard, on the rear wall away from the main PNL screen. It opens the global task board. Department work cabins have no whiteboards. The main screen retains its strategy/PNL monitoring action. The board shows a department → to-do → phase tree, or a compact list. Filters select department, status, owner, unassigned work and search; department totals remain global. Every task has an optional agent owner, an ordered phase plan and editable documentation.

Chat messages do not automatically create tasks or start timers. Agents first classify intent. Casual conversation, status checks, clarification and general factual questions need no task, even if answering uses a lookup tool. Actual requested work, such as research, implementation, investigation, execution or producing an artifact, must create or reuse a task before execution. A task represents one user goal. Related questions, phases and follow-ups belong to that record: queue time, callback and email options for one support case are parts of one goal. Agents check recent records, including completed tasks, before creating work. Continuing a completed goal adds or reopens a phase and preserves time. Uncertain scope is clarified with the user before creating or splitting records. A final chat reply does not by itself complete the overall goal. Existing history is not automatically imported or reclassified.

The board's **Start with agent** explicitly sends a specific task to an idle agent; **Start timer** only starts timing. A busy agent is not interrupted by the board. Scheduled messages use the same intent rules; they do not create duplicate tasks just because another message was delivered.

Checking a phase stops its clock and starts the first unfinished phase. The last check completes and automatically archives the task, recording a whole-task `completedAt` timestamp. The default current list and department counts include only queued, running and paused work; the Completed and Archived filters show history. Each completed phase and whole task shows its absolute completion date/time in the browser local time zone, alongside elapsed duration. Historical completed tasks are archived at startup and recover their completion time from their original phase timestamps, never from edit/archive time. Missing historical timestamps are shown as not recorded. Reopening a completed phase returns an archived task to current work and preserves accumulated time. Adding a follow-up phase to an archived completed task returns it as queued work and preserves all earlier phase completion dates. Documentation-only edits keep completed tasks archived and retain the original whole-task completion time. Restoring an unfinished manual archive still works; a completed task requires actual follow-up rather than a plain restore. Pause stops timing without checking a phase. Agent turn completion, failure or interruption pauses the timer if the agent has not explicitly completed its phases; it never marks unfinished work successful. Timing measures elapsed phase work, not CPU time or billable tokens. A 15-second checkpoint bounds lost timing after a crash; restarting pauses at the last checkpoint and excludes offline time.

The Office-owned Gateway stores private records in `<Office data directory>/todos/<id>.json`, outside Git. Writes replace individual files atomically. The UI and agent tools use the same authenticated Gateway RPC and change events. Revisions reject stale edits. Phase IDs preserve timing across plan edits. Archive removes a task from the active view while retaining history; restore brings it back. Task history retains removed phase names and their accumulated time. No database, separate account or external project service is required.

Agents receive the current Office agent ID and bound task ID in their developer context. The Office-owned Codex runtime discovers the bundled `office_tasks` MCP service, including on resumed conversations. The service exposes `todo_list`, `todo_get`, `todo_create`, `todo_edit`, `todo_start`, `todo_pause`, `todo_complete`, `todo_reopen`, `todo_archive` and `todo_restore`. Read a task before editing; pass its revision and your `actorId`. Preserve existing phase IDs when changing a plan. Update documentation with results and evidence, then check verified phases. On conflict, fetch the new record and reconcile the changes.

MCP responses are compact at the model-facing boundary; Gateway/UI records remain complete. Task changes return the current revision, status, phase IDs and handoff delivery state, without repeating documentation, event history or prior reports. Use the returned revision for the next change; reread after a conflict or when new work/reports arrive. `todo_list` returns summaries and phase counts; `todo_get` returns the complete plan, documentation and handoff reports, omitting event history unless `includeHistory=true`. Keep documentation as a concise current summary with evidence paths rather than repeatedly copying the full work log.

The bundled task tools are trusted to update Office task records without a separate approval for each check or edit. This policy is scoped to the Office task service. The MCP configuration is supplied only to Office's child process. Its Gateway credential is forwarded through the child environment and is never included in model context or command arguments. Native Codex App configuration and conversations remain separate. As with existing Office controls, connected operators share access to instance data. The Gateway and frontend must both support this feature; installing a new frontend alone does not add task storage or tools.

Validation: `NODE_ENV=test npx vitest run tests/unit/officeTodos.test.ts tests/unit/taskBoard.test.ts`; existing Node-side Office tests use `--environment node`. `scripts/check-macos-browser.mjs` also checks the board against an isolated real bundled runtime and browser, with synthetic local model replies exercising actual MCP tools. It never reads or changes production tasks.


Execution attribution is separate from workflow handling. `assigneeId` names the
employee who actually took the execution work; task filters and member task lists
use it. Submitting, reviewing, accepting or forwarding evidence does not transfer
that attribution to the reviewer. `handlingAgentId` is derived from the active
handoff (worker while working, manager while reviewing), and `reviewerId` is set
only during review. Notifications, task binding, timer ownership and Start with
agent use the handler. A Head explicitly starting execution after a child's
acceptance takes the assignment; a review notification does not. Recall explicitly
returns execution to its delegating manager.

`acceptanceManagerId` retains the outer manager's final acceptance duty after all
handoffs have resolved. Explicit reassignment after resolution clears that duty;
a later delegation records its own manager. This keeps final completion rights
independent of the execution assignee without inventing another approval flow.
On load, unfinished legacy handoffs recover that manager from the open chain.
Only a pending-review legacy record assigned to its exact reviewer is reassigned
to that handoff's recorded worker; completed history is not rewritten and earlier
execution is not guessed. The conversion is persisted once with a revision/event.
