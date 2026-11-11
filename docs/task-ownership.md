# Task ownership and departmental follow-up

Each task has one persistent ID and two independent people fields:

- `ownerId`: the person following up on the outcome.
- `assigneeId`: the person doing the execution work.

Both fields are nullable. The same person can hold both roles. A task appears
under each of these people in the agent directory, with the relevant role shown;
holding both roles produces one entry with both labels. Different tasks remain
separate. Completing or archiving a task removes it from current task lists.

Owner and Assignee record coordination and execution responsibility, not extra
system permissions. Direct user instructions authorize the addressed employee
without additional Head approval. Reporting lines are default routing; an
explicit recipient need not be a direct report. Existing task-state and review
checks protect active work and evidence, not permission to do user work.
`handlingAgentId`, `reviewerId`, and `acceptanceManagerId` retain their workflow
meaning and are not interchangeable with Owner. Delegating, submitting, accepting,
recalling, reassigning execution, or adding follow-up phases preserves Owner.
Changing Owner requires an explicit edit.

After an explicit Owner change, the current Owner can use `todo_recall` with the
exact phase and handoff IDs to end their own old upstream handoff once all deeper
handoffs in that phase are closed. This records a recalled transfer, not an
acceptance. The original manager, reports and actual execution Assignee remain
recorded; when no upstream remains, this phase's subsequent acceptance belongs to
the current Owner. It cannot recall or accept another worker's open handoff on
their behalf, and uncertain deliveries must be resolved first. Ordinary manager
recall keeps its active-worker safety checks.

For independently assigned phases without an active handoff, the current phase
Assignee can start its timer directly. **Start with agent** notifies that employee
without manufacturing an Owner-to-worker handoff; starting one's own timer sends
no model message. Owner coordination keeps time, context and usage attached to
the executing employee. Explicit handoffs preserve their actual report/review
chain. Busy employees, uncertain deliveries, real actor identities and stale
revisions remain protected.

Agent task creation defaults an omitted Owner to the creating actor. An explicit
`ownerId`, including `null`, is respected. Human creation can select Owner in the
existing task editor. `todo.list` accepts independent `ownerId` and `assigneeId`
filters; supplying both takes their intersection. Task cards, details, and editor
show the two roles separately.

Older records without `ownerId` use recorded acceptance ownership or an
unambiguous original handoff. A connected nested handoff retains its original
root; unrelated or conflicting evidence remains unknown. Current department Heads
and transient reviewers are never guessed as owners. Reading does not write files
or alter timestamps. Before an existing normal mutation, resolved ownership is
materialized; unresolved ownership is saved as unassigned (`null`). This prevents
later changes to handoff evidence from inventing an owner. Explicit `null` is never
backfilled. There is no bulk migration job.

Department details show the existing **Needs follow-up** set: tasks that are not
archived and not completed. This includes queued, running, paused, and submitted
work awaiting review. Stored task department membership determines placement;
Owner's department does not move a task. Open Workspace uses `departmentId: null`.
The existing paginated task loader is shared with the directory and runs when
either chat or department details are open. Task events refresh it. Selecting a
task closes the department panel and opens the existing TaskBoard detail for that
same ID, without starting a conversation or sending a message.
