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
The first request reads one page of 12 turns and bounds visible text to 128 KiB.
Tool entries contain short labels only, never raw command output or raw reasoning.
Long previews are explicitly marked as truncated. Ordinary text is preserved
when it fits the preview budget. Native `commentary` messages and public work
summaries are grouped in one closed disclosure per turn. User messages, stable
`partial_answer` text and `final_answer` replies remain expanded. Missing phases
remain visible for compatibility; text is never guessed to be a final answer.
Scroll upward or use the older-records button to read one earlier page. The panel
allows one history request at a time, preserves the visible position when
prepending, and rejects stale responses after switching sessions. A page may
contain only hidden tool items; it does not automatically scan additional pages.
The five-second timer reads metadata only. Use Refresh latest to replace the
current history window with the newest page. This avoids silently rereading long
histories and keeps each history read a deliberate, paginated operation. The
128 KiB budget bounds browser text, not the native API's full turn response. A
12-turn response can contain tool items that are filtered before transmission;
turn count alone is not evidence that a reported delay comes from history size.
The desktop App link uses `codex://threads/<original-id>`.

By default this is a read-only organization surface. Continue conversations, approvals,
execution and stopping in the original App. The gateway rejects write methods;
it never starts a parallel executor against an existing App thread. Ordinary
cloud ChatGPT conversations and remote-host threads are outside this local
index. Original standalone gateway state is retained for rollback.

## Optional shared execution owner

Set `CLAW3D_CODEX_CONTROL_SOCKET` on the gateway only after the desktop App and
the gateway have been configured to connect to one native app-server through its
private Unix WebSocket listener. In this mode the gateway never starts another
app-server, falls back to a second executor, or changes a thread's ID, directory,
model or permissions. The socket must belong to the current user and have no
group/other permissions. A lost shared connection stops the gateway; launchd may
reconnect it, but uncertain write operations are never automatically retried.

The App must have loaded a thread before the web client can attach to it. Open
the original conversation in the App once if requested. This preserves its
registered tools and active configuration. The web client attaches before reading
the latest history page so live events cannot fall into a subscription gap.

The inspector then supports plain-text continuation, steering the active turn,
interrupting that same turn, live assistant messages and compact tool activity.
Command approvals and complete, small file-change approvals can be answered from
either client. Answers are cleared only on native resolution or turn completion.
Only the backend's offered one-time decisions are exposed; persistent policy
amendments are not exposed. Oversized or unsupported requests remain for the App
to handle. Attachment upload, other structured prompts and full historical tool
logs are not implemented here, so this is not yet complete native UI parity.

Native changes trigger coalesced `session.updated` WebSocket events. The visible
chat immediately reads changed items, draining bounded chunks sequentially without
advancing its cursor past omitted items. A visibility refresh and 15-second read
repair a missed notification. Live messages preserve phases and up to 64 KiB of
UTF-8 text; only unusually large messages retain a marked preview limit. The final
native `item/completed` replaces streamed text authoritatively. Native turn errors
and interruption status remain visible beside the composer.

The pinned Mac App starts its normal owner over stdio. Switching to a shared
listener requires one deliberate App quit/relaunch after current work finishes.
Its bundled transport supports `CODEX_APP_SERVER_WS_URL`; this is a version-bound
App configuration, not a promise of a stable public App setting. The tested Unix
URL has a localhost hostname, for example
`ws+unix://localhost/absolute/path/app-server-control.sock:/rpc`, so the App's
network selector keeps the connection local rather than using its SOCKS proxy.
The paired `CODEX_APP_SERVER_USE_LOCAL_DAEMON=1` selects its shared-server tool
configuration. Both the owner and App use the existing Codex home and pinned CLI;
the owner's launch arguments retain the App's code-mode host and App-tools plugin
configuration. No App bundle patch or client impersonation is involved.

Before enabling the gateway's shared mode, run the read-only preflight:

```sh
CLAW3D_CODEX_CONTROL_SOCKET=/absolute/private/socket \
  node scripts/check-codex-shared.js ORIGINAL_THREAD_ID OLD_OWNER_PID
```

It refuses while the old owner is alive or the expected original thread has not
been loaded in the shared owner. Prepare backups of the original gateway service
and App environment first. Never stop an active owner merely to perform this
migration. Rollback requires closing the App, disabling web writes, restoring
the original App environment and read-only gateway configuration, then relaunching
the App. Check for active native turns before stopping the shared owner.

Isolated integration validation used the pinned native app-server, two real
protocol clients and a local fake model provider in a temporary Codex home. It
verified one original thread, cross-client approval, steer and stop, without a
real model request. That evidence does not replace validating the actual App
reconnection and its tools after the migration.
