# Existing App session view

Use this mode to organize existing local Codex/Work conversations. Each person
uses the original thread UUID, App title and working directory. Archived threads
and child-agent sources are excluded. No conversation is copied or forked.

Run `server/codex-session-gateway.js` instead of the standalone Codex gateway.
Use the same loopback port, private gateway token, Studio proxy, authenticated
HTTPS entry and `CLAW3D_CODEX_GATEWAY=1` host binding. Set
`NEXT_PUBLIC_CLAW3D_SESSION_VIEW=1` when building and running Studio; `/agents`
then returns to the office rather than opening a second chat surface.

The session index opens `$CODEX_HOME/state_5.sqlite` read-only (default
`~/.codex/state_5.sqlite`). This format is pinned to the installed Codex
`0.165.0-alpha.1.2` and Node `24.22.1`; verify compatibility before upgrading.
Task start/completion events provide observed working/idle state. Missing or
older unsupported records are reported as unknown. These observations do not
claim to reproduce every App state such as approval prompts or a crashed turn.
The visible office refreshes its roster and observed state every five seconds.

The company view doubles the original floor depth, retaining the original office
as Open Workspace (shared desks, lounge and roaming) and adding project work areas
behind a shared passage. Use the work-area selector to frame the whole company or
one area; it also fits narrow phone viewports. Each App project gets a named area,
including projects without a visible session. Project members receive desks in
their area and can visit the shared space when idle. Projectless chats have their
home area and shared desks in Open Workspace.

Project membership is read from the same local `.codex-global-state.json` as the
App: explicit projectless membership takes precedence; explicit assignments also
recognize worktrees outside a project's root. Otherwise a matching project root
is used. An unmatched or unavailable project goes to Open Workspace. This is an
internal, version-pinned App format, like the session index above. The layout is
derived from membership without writing App project assignments or replacing the
user's saved furniture layout. Existing thread IDs stay unchanged. Changes in the
App appear on the next roster refresh. Idle movement is visual animation, not an
indication that the model is executing a task.

Click a person or CHAT to inspect the original session ID, directory and recent
history. The official app-server reader uses only initialize and
thread/turns/list: it never starts, resumes, stops, archives or edits a thread.
The first request reads one page of 12 turns, filters out tools and
reasoning, and bounds total visible text to 48 KiB (at most 8 KiB per message).
Long previews are explicitly marked as truncated. Ordinary text is preserved
when it fits the preview budget. User messages and intermediate assistant replies
remain visible; turn-summary mode is not used because it omits some of them.
Scroll upward or use the older-records button to read one earlier page. The panel
allows one history request at a time, preserves the visible position when
prepending, and rejects stale responses after switching sessions. A page may
contain only hidden tool items; it does not automatically scan additional pages.
The five-second timer reads metadata only. Use Refresh latest to replace the
current history window with the newest page. This avoids silently rereading long
histories and keeps each history read a deliberate, paginated operation. The
48 KiB budget bounds browser text, not the native API's full turn response. A
12-turn response can contain tool items that are filtered before transmission;
turn count alone is not evidence that a reported delay comes from history size.
The desktop App link uses `codex://threads/<original-id>`.

This is a read-only organization surface. Continue conversations, approvals,
execution and stopping in the original App. The gateway rejects write methods;
it never starts a parallel executor against an existing App thread. Ordinary
cloud ChatGPT conversations and remote-host threads are outside this local
index. Original standalone gateway state is retained for rollback.
