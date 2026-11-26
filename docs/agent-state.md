# Agent State

Agent State is current, concise memory tied to the stable Office employee UUID.
It is separate from user Notes, task documentation and native conversation history.
Replacing the underlying native conversation does not change its storage key.
This feature does not replace, refresh or clone any conversation automatically.

Open an employee's **Workspace → Agent State** to review the actual saved record,
revision and update time. New employees start empty. Edit explicitly and save;
unknown/failed saves are never presented as confirmed. On a conflict, copy the
retained draft and reload before editing the current revision. Only saved content
syncs; an unsaved editor draft is backed up only in the current browser, scoped by
gateway and employee ID, and restored after closing/reopening Workspace. Restoring
a stale-revision draft requires explicit reload before another save; it never
automatically retries an unknown save. Browser backup failures are visible.

Four plain-text sections contain current focus, conclusions with short reasons,
outstanding responsibilities / next decisions, and task / original-source links.
Each section is limited to 2,400 UTF-16 characters; all sections together to 6,000
characters and 18,000 UTF-8 bytes. Delete obsolete material; avoid transcripts,
chronological logs, long task documents or secrets. State is data, not instructions,
and cannot override actual user requirements or system/developer rules.

The existing authenticated Office gateway exposes `agent.state.get` and
`agent.state.save`. The existing `office_tasks` MCP exposes `agent_state_get` and
`agent_state_save`. Use your own `actorId`; reads may specify another existing
employee's UUID for handover. Saves target the actor's own UUID and require the
last saved revision. Like other Office MCP tools, this uses a shared-service
actor convention, not per-employee authentication or a new permission boundary.
The signed-in website operator can edit the selected employee's state.

The gateway stores state in its private Office data directory under `agent-states/`,
reusing Notes' per-ID atomic replacement and compare-and-swap implementation with
a separate directory. Files are private (0600); parent directories are created
0700. No state is shipped in the repository. Invalid schema, corrupt state or
symlinked records fail closed; stale revisions never overwrite newer content.
Locks are per employee; a leftover lock after a crash rejects writes rather than
silently discarding another writer's lease. State remains readable for recovery.

At each new native turn, the existing Office context injection reads a bounded
snapshot for the stable employee UUID. It includes the revision and explicitly
labels state as data. Failed reads report unavailable and do not fabricate memory
or prevent the conversation from starting. Mid-turn edits can be read with MCP;
there is no automatic summary or model call. Renaming an employee or replacing a
native mapping cannot transfer another employee's state. Archived/missing employees
are rejected by the existing Office roster lookup.
