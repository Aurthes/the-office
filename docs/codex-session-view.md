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

Click a person or CHAT to inspect the original session ID, directory and recent
history. The official app-server reader uses only initialize and
thread/turns/list: it never starts, resumes, stops, archives or edits a thread.
The panel shows the latest twelve turns and bounds long message previews.
The desktop App link uses `codex://threads/<original-id>`.

This is a read-only organization surface. Continue conversations, approvals,
execution and stopping in the original App. The gateway rejects write methods;
it never starts a parallel executor against an existing App thread. Ordinary
cloud ChatGPT conversations and remote-host threads are outside this local
index. Original standalone gateway state is retained for rollback.
