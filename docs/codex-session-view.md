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
Roster changes are pushed as `roster.updated` over the existing authenticated
WebSocket. Native project/thread/lifecycle notifications trigger a coalesced
snapshot comparison. A watcher also covers legacy App state and SQLite WAL
updates. One server-side check every 30 seconds recovers missed notifications;
unchanged snapshots and text deltas do not trigger browser roster reads. The
browser reconciles on connection, event gaps and visibility recovery, queues a
trailing read if another change arrives during a read, and retains the last good
roster on read errors. Failed reads retry after 30 seconds; creation never
automatically retries. Hidden pages catch up immediately when visible.

The company view retains the original office
as Open Workspace (shared desks, lounge and roaming) and adds project work areas
behind a shared passage. Use the work-area selector to frame the whole company or
one area; it also fits narrow phone viewports. Each App project gets a named area,
including projects without a visible session. Project members receive desks in
their area and can visit the shared space when idle. Projectless chats have their
home area and shared desks in Open Workspace. Project areas use three fixed-width
lanes with three desks per row, fixed desk spacing and clear aisles. Each area's
height grows with its session count; additional projects append down the lanes.
Shared-desk overflow gets additional rows too. Floor, exterior walls, camera
bounds, movement bounds and the measured-geometry navigation grid grow together.
Existing areas never shrink just because another project is added.

Project definitions and new thread assignments come from the native SQLite
project tables, opened read-only. For older App conversations without a native
assignment, the legacy `.codex-global-state.json` supplies explicit assignments
and projectless membership. Host-scoped migration IDs translate legacy App
Project IDs to canonical server IDs while thread migration is incomplete;
otherwise a matching project root is used. Unknown
projects go to Open Workspace. These are internal, version-pinned formats.
Layout derivation does not write App state or replace saved furniture. Idle
movement is animation, not evidence that the model is working.

With the shared owner connected, the work-area controls offer **+ Project** and
**+ 招募 agent**. A Project needs a name and an existing absolute directory on
the Codex host. `project/create` uses a native idempotency key. Recruitment selects
an existing Project and calls `thread/start` with its native project ID and first
root directory, then `thread/name/set`; it creates an empty original conversation
without sending a prompt. Native project model/tool/permission configuration is
inherited. Opening the new chat permits its first message through the same shared
owner. Existing chats keep their UUIDs and are never forked or reset.

The pinned desktop App still maintains a separate legacy sidebar Project cache.
A native `project/create` is durable and visible to protocol clients, but that
alone does not guarantee an immediate new Project entry in the desktop sidebar.
This integration does not rewrite its private cache or restart the App. Use the
chat's **⋯ → 在桌面 App 中打开原会话** link to open the exact created conversation;
desktop sidebar Project refresh remains an App compatibility limitation.

Duplicate requests are coalesced in the gateway. Creation is never automatically
retried after a timeout or disconnect: check the existing Project/session list
before submitting a new request. A naming failure after thread creation returns
the created thread ID and a warning. Read-only mode disables creation. The pinned
native project APIs and two-client notifications are covered by
`CLAW3D_NATIVE_CODEX_BIN=/path/to/codex npx vitest run tests/unit/nativeWorkspaceCreation.test.ts`
in a disposable Codex home, without inference.

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

The chat uses the available window height, with a desktop enlarge/restore button.
On phones it fills the visual viewport, including when the keyboard is open;
Return to office restores the 3D view. The conversation roster is closed by
default and opens from the header. Technical session information is behind the
overflow menu, and the raw event console is hidden outside explicit debug mode.

Image attachments and referenced PNG/JPEG/GIF/WebP files render in the chat and
open a larger preview. Markdown and HTML file links open a reader with Return to
chat and Download. Native ambient context is removed before the text page budget
is applied, so a large app screenshot description cannot displace the user's
actual request. Original stored messages are never changed.

The file API accepts signed references created from native message links and
attachments, not arbitrary filesystem paths. It retains the existing password
and TOTP protection. References pin resolved paths; changed symlinks, unsupported
types and oversized files are rejected. Previews are limited to 20 MiB (Markdown
1 MiB). Native base64 images become private generated cache files under
`~/.cache/claw3d/session-images`, keeping image bytes out of history responses.
This cache can be removed without deleting original chat attachments.

HTML uses an opaque-origin sandbox with inline scripts enabled, no access to the
parent document, and no network connections or form submissions. Self-contained
reports with inline SVG and JavaScript work; bundles requiring external scripts,
network data or separate relative resources are outside this preview. Markdown
is rendered without raw HTML; its relative supported file/image links are signed
only when that Markdown file is opened. Missing files show an error rather than
silently redirecting a local path onto the public website.

By default this is a read-only organization surface. Continue conversations, approvals,
execution and stopping in the original App. The gateway rejects write methods;
it never starts a parallel executor against an existing App thread. Ordinary
cloud ChatGPT conversations and remote-host threads are outside this local
index. Original standalone gateway state is retained for rollback.

## Optional shared execution owner

Set `CLAW3D_CODEX_CONTROL_SOCKET` on the gateway only after the desktop App and
the gateway have been configured to connect to one native app-server through its
private Unix WebSocket listener. In this mode the gateway never starts another
app-server, falls back to a second executor, or changes a thread's ID or directory.
It preserves the original model and permissions unless the user explicitly changes
them through the native settings controls. The socket must belong to the current user and have no
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
amendments are not exposed. Oversized or unsupported structured requests and full
historical tool logs remain for the App, so this is not complete native UI parity.

The composer shows the current native model, reasoning effort and access mode.
Available models and permission profiles come from `model/list` and project-scoped
`permissionProfile/list`. Changes use the pinned native `thread/settings/update`
API, apply to subsequent turns, and synchronize through `thread/settings/updated`
events. Current work is not restarted; steering continues its existing turn.
Managed profile restrictions are honored. Enabling Full access requires an explicit
confirmation of its file, command and network permissions. Settings calls cannot
change workspace, instructions or arbitrary native configuration fields.

When reading older messages, the “latest messages” arrow returns to the bottom and
resumes following live replies without another history read. Normal chat headers
have no manual refresh button; connection and history failures expose targeted
retry controls.

The composer accepts file selection, image paste and drag/drop. Each message can
include eight files of at most 20 MiB each. Uploads stream to owner-only files under
`~/.local/share/claw3d/uploads/<thread-id>/<upload-id>/`; they remain there so the
original conversation can keep referring to them. Uploading alone never starts
a turn. Send uses signed references bound to the original thread, native
`localImage` inputs for validated PNG/JPEG/GIF/WebP, and the App's file-reference
message format for documents. It never changes workspace or permissions to read
an attachment. An attachment can therefore require the native sandbox's normal
read approval. Unsupported document preview formats download as attachments;
generic downloads are limited to this upload directory, not arbitrary local paths.

The microphone button records directly in the web page on desktop and mobile.
Click to start, then click again to stop. Web Audio captures mono 16 kHz PCM and
streams ordered audio chunks through the authenticated gateway while recording.
The draft receives text only after recording ends. The local gateway
uses the installed Codex owner's existing ChatGPT authentication, native account
routing and SDK user agent to call the desktop App's native `/dictation/stream`
service. Credentials stay in the local gateway. This is the native dictation
protocol, not a Realtime chat instructed to transcribe, browser speech recognition,
an OpenClaw provider, or a separate API-key transcription model. Its private,
version-bound protocol was verified against Codex CLI 0.165.0-alpha.1.2 and the
installed desktop App. It requires a logged-in ChatGPT account with dictation
available; other auth modes are rejected explicitly.

Only authoritative final transcripts are inserted after a clean native completion.
Native connection preparation overlaps microphone permission and worklet setup.
Ordered WebSocket audio frames and the finish request are sent without an extra
audio-ACK round trip; final insertion still requires all audio requests to succeed.
The composer labels recording duration separately from stop-to-draft elapsed time.
Recovery retries show their own elapsed time, which includes real-time audio replay.
Utterance order and final revisions are preserved. Dictation never starts a Codex
turn; review the draft and Send normally. A recording is limited to 10 minutes and
20 MiB. Interruption and limit stops preserve the captured portion and expose retry
and WAV download. Audio stays in browser memory through retries and chat switches;
refreshing or closing the page warns while a recording is unsent. The local gateway
does not write an audio file. Recovery uploads the retained WAV and replays it at
the native audio rate; retry can take about as long as the recording. Accelerated
replay is avoided because the native service can reject long audio bursts. Sending successfully
or explicitly clearing the recording releases the browser copy. Capture stops when
the page is hidden or the chat closes. Recognition failures keep the original draft
and audio instead of inserting a partial transcript. The gateway limits concurrent
transcriptions and authenticates the binary endpoint before reading uploads.

The headphones button starts the pinned native `thread/realtime/start` v3 WebRTC
transport on the same loaded thread, using its existing Codex account. SDP and
control events cross the authenticated gateway; media uses the native WebRTC
connection. This experimental protocol is version-bound. Only the tab that owns
the call receives its control/caption events and can stop it; another tab cannot
replace it. Closing the chat/page releases its microphone and peer connection;
gateway disconnect/logout stops the owned native call. Ending voice does not
interrupt the Codex task. Browser microphone permission, audio playback policy,
account availability and the device's WebRTC network reachability still apply.

Working people face their desk screen and alternate staggered typing, thinking,
breathing and small posture changes. These are visual animations, not inferred
model reasoning or additional agent activity.

The selected chat uses `session.subscribe` and receives `session.stream` WebSocket
frames directly from native events, coalesced over 40 ms. In-progress text travels
as small appends with a checked base version. Native `item/completed` sends an
authoritative replacement, including shorter or revised final text. The server
drains bounded bootstrap chunks itself; no browser timer or `session.live` read is
needed for message updates. Each socket owns one chat subscription, released on
chat change or disconnect. Slow consumers reconnect and resynchronize rather than
silently skipping content.

Opening the chat reads one recent history page. Reconnecting reads that page once
to recover anything missed during a gateway restart; older pages load only on
upward scrolling or an explicit request. Visibility recovery, a detected event gap
or a missing append base starts a new subscription. Legacy `session.updated` and
`session.live` remain available to older tabs. Live messages preserve phases and
up to 64 KiB of UTF-8 text; only unusually large messages retain a marked preview
limit. Native turn errors and interruption status remain beside the composer.

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

Physical scene geometry is the shared collision source for pathfinding, movement
and interaction positions. `SceneColliders` captures the actual rendered meshes,
including instanced props, arbitrary furniture rotations and model scale. New
physical props belong under this collector; do not infer runtime collisions from
editor footprints or maintain a furniture-type whitelist. The footprint fallback
in `buildNavGrid` is only for layouts that have not been rendered.

Static meshes use oriented boxes and people use a floor-projected body radius
of 16 canvas units (0.288 metres), with avatar-height filtering. Thin ground
coverings can be stepped over; overhead objects block only when they intersect
the body height. Animated door leaves are checked at their current transform;
static navigation plans through the doorway while movement waits for clearance.
Swept movement prevents tunnelling and slides along obstacles. People in every
state, including seated workers and janitors, collide; contact triggers bounded
rerouting around other people instead of moving through them.

Only the assigned chair is exempt during its owner's seat interaction. Other
chairs remain solid. If neighbouring furniture occupies a workstation's approach,
choose clear standing floor from the same collision world. Table/social interaction
points use the measured object volume too. The generated desk/chair GLB metadata
(`npm run prebuild`) still supplies the precise cushion height and work pose.
This is lightweight collision and navigation, not a rigid-body simulation.


## Attention markers and interactive questions

An idle character shows a yellow `?` for a completed result that the Codex App
marks unread. Completion is identified from the original task-complete record,
so ordinary idle, interrupted, and running work does not produce a question mark.
Opening that chat in a visible browser records the viewed completion locally;
receipts survive reloads and synchronize across tabs on the same origin. These
browser receipts do not modify the Codex App's private read-state file.

A yellow `!` takes priority while a question awaits input. Native
`item/tool/requestUserInput` requests use their original request/response channel.
Accepted `request_user_input_async` calls are indexed from structured rollout
records because public turn items omit those calls. Their answers use the same
question IDs and user-reply envelope as the desktop App, sent to the original
thread through the existing deduplicated send path. A normal chat reply or new
steering message supersedes older async prompts. Historical prose lists remain
transcript text; they are never guessed to be actionable requests.

The question index reads append-only records incrementally, with a bounded line
buffer. Question snapshots are bounded and pushed on the existing session stream.
Forms require an explicit selection or custom answer and preserve the message
composer draft. Duplicate submissions and replies to another thread are rejected.

The legacy main-agent Option recorder is also disabled in Codex session view.
Option passes through to the operating system and the native desktop App. Neither
the OpenClaw transcription endpoint nor browser speech recognition is used by the
Codex composer.
