# Office organization and delegation

Projects are departments. The CEO and every employee are normal persistent Office
sessions. The scene and gateway share the same reporting-graph reconciliation.
Gateway-scoped Studio preferences store `organization`, keyed by stable Office
session ID, with `{ title, reportsTo, delegationMode? }`. Direct reports are
computed from upward edges; multiple managers are supported and cycles rejected.
Legacy `npc:ceo` identities are normalized to the real CEO session ID.

Use **Character → Organization → Edit organization → Work strategy** to choose
an employee's default. With **Role default**, CEO prefers delegation, managers
and employees with direct reports delegate when useful, and other workers handle
work directly. Explicit user instructions override these defaults. They guide
model decisions; they do not force every request through the hierarchy.
Changing a title/reporting line preserves an explicit strategy. Older clients
that omit the strategy cannot erase it; `null` explicitly restores the default.

The shared protocol lives in `server/office-company.js` (`WORKFLOW`). Office
injects the current role, managers, direct reports and task inbox at turn start,
using the existing change-only context injection. It requires no per-session
page, extra model call or copy of an organization's names in AGENTS.md. The
protocol stays Office-specific and does not alter user-global or repository
AGENTS.md files. Changing the protocol requires a gateway release; changing an
employee's strategy or reporting line applies to subsequent turns without one.
If optional organization data cannot be read, ordinary chat continues with an
explicit unavailable/self-work context; delegation fails rather than guessing.

## One task, real employee conversations, manager acceptance

The existing Office Tasks MCP connection exposes five additional tools, including
in resumed conversations:

- `todo_organization`: read the current employee's live reporting line.
- `todo_delegate`: give the current assigned task to an existing direct report,
  with bounded scope/deliverables, the original user's restrictions and explicit
  acceptance criteria. The gateway checks the reporting graph again after its
  readiness read and sends through the normal session sender. It does not spawn
  temporary employees, change sandbox/approval policies or interrupt a busy chat.
- `todo_submit`: record evidence and return the same task to the delegating
  manager for review. The final unfinished phase remains open.
- `todo_review`: the delegating manager accepts with verification evidence or
  returns concrete correction feedback to the same worker. Acceptance itself
  does not close the goal. Nested handoffs return up the same chain before the
  final manager checks the last phase.

`todo_recall` lets the delegating manager take an unsuccessful handoff back,
without treating it as accepted. Inspect the worker first; active work must be
stopped before recall. The first version uses one responsible assignee and one
active handoff chain per goal, rather than parallel branches of the same task.

A task stores its handoff history and current assignment. Existing phase IDs,
prior timing and unrelated tasks remain intact. Open handoffs prevent final
completion, archival and ordinary reassignment, including through the task board.
Employees involved in open handoffs must finish or recall them before their
conversation can be archived, so a task cannot lose its responsible manager.
A report and successful model turn never imply acceptance. The board shows the
handoff chain, criteria, reports and review notes; submitted work is labelled
**Awaiting manager review**. Questions and small tasks continue to be answered
directly without creating work records merely for a lookup.

Task metadata is the durable delivery inbox. A busy manager receives the review
notification after a normal turn completes. Pending unsent deliveries survive a
gateway restart. Stop intent, pending user questions/approvals and retry activity
are respected. A dispatch marked `sending` or `uncertain` is never blindly
replayed: inspect its conversation first; the report remains in the task and
next-turn context. The existing task board's **Start with agent** can be used
for explicit follow-up. There is no additional periodic scheduling service.

Office Tasks retains its existing single-user gateway-token trust model:
`actorId` identifies the attributed employee, not a separate authenticated user.
The gateway checks task responsibility and reporting edges, but this is not a
security boundary against an operator impersonating an actor or a fully trusted
agent using another actor ID. Reporting relationships grant no additional file,
account, approval or tool permissions. Do not delegate around a user's limits.

## Organization edits

New recruits inherit the existing department manager. When a manager is archived,
reports inherit the nearest surviving upstream managers, with CEO as fallback.
No surviving worker is automatically promoted. On first promotion to **Head** or
**Manager**, department peers sharing the selected upstream manager report to the
new manager; their other reporting lines and descendants remain intact. Entirely
new departments keep the existing initial Head assignment. Selecting a person
or reporting link still focuses the camera and opens their normal conversation.
