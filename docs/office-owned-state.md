# Office-owned Codex runtime

Office runs an independently installed Codex CLI as its own `app-server` child,
using the public stdio protocol. Office owns its project/session records and
Codex data directory. It does not attach to the native Codex/ChatGPT App.

This implements the ownership decision of 2026-10-31 and supersedes the shared
session direction evaluated in the [historical audit](codex-interop-audit.md).

## Ownership boundary

- No native App project/session discovery, import, synchronization or management.
- No changes to App startup, global environment, configuration, authentication,
  private databases/caches or process ownership. No App client/tool impersonation.
- The same OpenAI account may authorize Office through an official login flow.
  Office never copies credentials from the App.
- Selecting the same filesystem folder in both products shares files, not
  project identity, conversation history or task ownership.
- Public global instructions, standalone skills and selected ordinary defaults
  are automatically discovered without changing their source files. MCP servers,
  plugins and App-specific document/browser bridges are not copied from the App.

The [Codex platform overview](https://developers.openai.com/blog/codex-as-a-platform)
describes this integration layer. The public
[App Server reference](https://learn.chatgpt.com/docs/app-server) supplies the
protocol. The [CLI reference](https://learn.chatgpt.com/docs/developer-commands)
still labels app-server Experimental: a documented interface is not a guarantee
of permanent compatibility. Pin the CLI and validate before upgrading it.

## Setup

Use Node.js 24. `npm ci` installs Office's own pinned official Codex CLI
(`@openai/codex@0.166.0`); a globally installed CLI is not required. Do not point
Office at the native App's executable or data directory. Configure both Office services:

| Setting | Gateway | Studio |
| --- | --- | --- |
| `CLAW3D_GATEWAY_TOKEN` | Required private token | Same token |
| `CLAW3D_CODEX_BIN` | Optional independent CLI override; defaults to Office's npm package | Unneeded |
| `CLAW3D_CODEX_CONFIG_HOME` | Optional public configuration source override | Unneeded |
| `CLAW3D_GATEWAY_URL` | Unneeded | `ws://127.0.0.1:18790` |
| `CLAW3D_CODEX_GATEWAY` | Unneeded | `1` |
| `NEXT_PUBLIC_CLAW3D_SESSION_VIEW` | Unneeded | Optional; defaults to `1` (spaceship). Set `0` at build time for legacy Office. |
| `CLAW3D_UPLOAD_DIR` | Optional upload directory | Same directory |

Start `npm run codex-gateway`, then Studio with `npm run dev` (or build with
`npm run build -- --webpack` and start with `npm start`). Keep services on
loopback; use the existing authenticated web-access gateway for remote access.

The gateway defaults to port 18790 (`CODEX_ADAPTER_PORT` overrides it).
Its default records directory is `$HOME/.local/share/claw3d/office-runtime`;
`CLAW3D_OFFICE_DATA_DIR` overrides it. Its Codex home defaults to the `codex`
subdirectory; `CLAW3D_OFFICE_CODEX_HOME` overrides it. The runtime rejects the
native App home and overlapping/symlinked directories. It strips inherited
App connection/tool-bridge settings and uses its own file credential store and SQLite
directory. No global environment settings are changed.

If not signed in, Office shows **Sign in with ChatGPT**. Complete the official
device-code flow. If OpenAI requests it, enable device-code login in ChatGPT's
web account Security settings yourself, then request a fresh code. Native App
sign-in remains separate. API keys for optional features below are not passed
to the Codex child and do not replace its account login.

Create a project by attaching one or more existing folders on the Office host,
then recruit a session. No repository is created, copied, moved, or Git-initialized.
The first folder is primary; new chats use it as their working directory. Chats
are grouped by Office project and retain independent Codex histories. The folder
picker browses the Office computer, including when opened from a phone.

Recruitment also offers **Open Space (no project)**, including when there are no
projects. Choose an existing working folder for the agent. It is saved without
a project; its folder context and workspace-write scope use only that folder.

Use **Edit project** to add/remove folders or select a new primary. Changing the
primary affects new chats only. Removing a folder used as a chat's working
directory requires an explicit replacement for each affected chat; those tasks
and terminals must be stopped first. Moving a chat between projects preserves
its working directory, which must be attached to the destination project.

Folder changes apply to the next turn and new terminals. Running turns and open
terminals keep their existing scope. Workspace browsing offers the attached
folders separately and validates containment within the selected root.

Office supplies its folder context through public `thread/inject_items` developer
messages, separate from user-visible messages, only when the context changes.
Every new turn receives explicit `cwd` and `sandboxPolicy`; do not put mutable
folder access into per-thread config overrides or rely on `thread/resume` to
update loaded threads. Project folders organize context; the selected Codex
permission mode remains authoritative (including read-only and Full access).
Repository instructions and configuration remain Codex-managed; secondary
repositories' `AGENTS.md` files are not concatenated by Office.

 Office saves grouping, titles, settings and Codex thread IDs in its own
`office.json`. Codex owns conversation persistence through RPC. Empty chats are
saved without an invisible seed prompt; the first message creates their Codex
thread. Neither product reads or writes the other's session database.

## Automatic configuration discovery

Every Office backend start discovers the public Codex configuration directory:
`CLAW3D_CODEX_CONFIG_HOME`, then inherited `CODEX_HOME`, then `~/.codex`.
No App installation, private preference store, database or running process is
inspected. A nonstandard App profile not exported through `CODEX_HOME` needs the
explicit source override; Office cannot infer private launcher settings.

- Global `AGENTS.md` and `AGENTS.override.md` are linked into Office's own home.
  Both Codex instances read the same source, with Codex's own precedence rules.
  Office-specific rule files take priority and are never overwritten. Source
  edits are visible through the links; loaded chats refresh instructions when
  resumed after a backend restart. Other already-loaded contexts are not patched.
- Repository rules and `$HOME/.agents/skills` use Codex's normal discovery.
  Older standalone skills under the discovered `skills/` directory are added
  with public `skills/extraRoots/set`. For standalone skills sharing a declared
  name, Office supplies per-path `skills.config` disables to its own child only:
  Office-local skills take priority over imported skills, then user skills.
  Real-file aliases count once. Explicit per-path enablement and named choices
  remain authoritative. Skill files, symlinks and global config are not changed.
- Public `config.toml` is parsed as TOML. The allowlist is `model`,
  `model_reasoning_effort`, `model_verbosity`, `personality`, `service_tier`,
  `developer_instructions`, `project_doc_max_bytes`,
  `project_doc_fallback_filenames`, `skills.max_context_tokens` and per-skill
  enablement. Office-specific settings win; model/access controls still govern
  each Office turn. Custom-provider model defaults are not imported into the
  independently authenticated OpenAI provider.
- Fixed Office Q/company/task rules are appended to the effective user
  `developer_instructions` through child-process overrides. Dynamic turn
  injections contain only project/task/organization/Q data and are cached when
  unchanged. Department descriptions, membership, roles and reporting remain
  available; repeated department labels and full Head records are omitted from
  that projection. Explicit organization reads still return the full directory.
  Native resume/compaction retains fixed rules. Existing conversations can still
  contain earlier injections until normal context compaction removes them.
- Model-facing Q context carries selected Q/step IDs and summaries plus a short
  index for selecting other known Qs directly. Full parent chains, provenance and
  original-message excerpts remain in stored/UI records. Exact source candidates
  are injected only when multiple inputs require disambiguation; a unique source
  still resolves server-side during direct registration. No discovery query is
  added to normal Q registration or switching. Project/task/organization context
  and Q context are cached separately and changed items share one injection RPC,
  so a Q change does not resend the unchanged company directory.
- Model-facing `todo_get` returns the complete current plan/documentation, all
  open handoffs and the latest full handoff per manager/worker pair. Older closed
  rounds retain identities/status with `detailsOmitted: true`; use
  `includeHistory: true` to read every report and event. Storage, UI and acceptance
  permissions remain unchanged. Compact mutation receipts supply the next
  revision so an unchanged plan need not be fetched again.
- Task notifications carry the revision and only the current handoff input:
  instructions and acceptance criteria for new work, the new report for review,
  or correction feedback for a return. They do not repeat task documentation,
  phase notes or earlier reports. Reuse known context; call `todo_get` when
  necessary context is missing or a real revision conflict requires refreshing
  it. Reports and feedback are preserved in full, without silent truncation.
  Manual task starts and automatic handoffs use the same formatter. Delivery receipts still persist
  and notify the UI, but do not invalidate the task revision; actual plan,
  report, assignment and workflow changes retain optimistic concurrency checks.
  Managers can finish their turn while awaiting the existing durable report
  notification, leaving the worker and its timer running.
- Keep task documentation focused on current scope, restrictions, status, next
  action and evidence paths. Archive long chronology before summarizing it;
  preserve unfinished acceptance requirements, phase identities and time.
- Selected defaults are supplied through Codex's public `-c key=value` arguments.
  The pinned app-server does not support named `--profile` selection.
  `config.toml` itself is never linked or copied. Credentials, projects, trust,
  sessions, memory, databases, MCP, plugins, hooks, notifications, feature flags
  and sandbox/approval settings remain independent.

Startup logs and the gateway health response report shared rules, imported key
names and any discovery warnings, without printing setting values. Symlink
creation requires OS support; on Windows this may require Developer Mode or
appropriate privileges. Failure is reported rather than silently making a stale
copy of the rules. Missing Codex configuration is a normal independent setup.
Discovery is automatic, but first-time account authorization is still required.

The official [global instruction rules](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
[skills discovery](https://learn.chatgpt.com/docs/build-skills),
[configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) and
[environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables)
describe these public configuration surfaces.

## Chat feature map

Office-owned [scheduled tasks](scheduled-tasks.md) send recurring instructions
to an existing Office conversation. Manage them using the small screen beside
the operations console. The gateway schedules them independently of browser tabs.

| Feature | Independent runtime behavior and validation |
| --- | --- |
| Projects and sessions | Office-only create, rename, reassign and archive. Empty chats survive restart. Restore/unarchive UI is not connected yet. No native App import or two-way management |
| Text and task progress | Public thread/turn APIs; streaming, saved history, continuation after process restart and interrupt tested through the gateway. Separate real-account two-turn continuation also passed |
| Interrupted tasks | Gateway startup checks stored latest turns without resuming or starting tasks. Interrupted sessions show a red `!` and an Interrupted label; an empty composer shows Play. Play submits “Continue where you left off.” in the same thread after rechecking its latest status |
| Questions and status markers | Public blocking requests and asynchronous agent-message question fields render choice cards. Yellow `!` means input is needed; yellow `?` means a completed result has not been viewed in this browser. Pending asynchronous cards persist in Office state; ordinary chat replies dismiss earlier cards |
| Models and reasoning | Account's public model catalog; validated choices persist in Office and apply to the next turn. Additional messages during a task use its current settings |
| Access and approvals | Public sandbox/approval fields; Read only, Default permissions and confirmed Full access. Command/file/question handlers reused; permission grants are limited to the requested permissions for that turn. Fixtures verify response routing; not every real approval variant has been induced |
| Context usage | Displays reported last-input tokens and nullable model context window. Real usage events received. This is not a hidden-prompt inspector or cumulative billing-token percentage |
| Composer commands and references | Native compaction, forks, settings and runtime discovery through the [composer command menu](codex-composer.md). New chats can read other Office chats using Office-owned public dynamic tools; older chats without those tools remain reference targets |
| Images | Signed browser upload, saved image history and public image input passed with the real account and a loopback fixture. Vision answer quality was not measured |
| Other files and previews | Uploaded host paths, workspace browsing/text reads and existing supported previews. Upload is not universal PDF/Word/Excel understanding; converters/tools must be available separately |
| Workspace terminal | Public `command/exec` PTY, output, input, resize and terminate tested using the real engine; uses the session's sandbox policy |
| Dictation | Standalone recorded-audio transcription with Office-owned ChatGPT login, or an explicitly configured public-API key. The subscription HTTP endpoint is undocumented, not an app-server RPC or Voice Chat. Failure temporarily disables the capability; audio is retained for manual retry/download. See the scope and recovery behavior below |
| Suggested prompts | Experimental Codex 0.166.0 `thread/sample` on the completed Office thread, using Office's ChatGPT login and loaded context. No API key or new turn. Real-account sampling, unchanged history and no tool execution verified; account availability and usage limits still apply. Not native App prediction reuse |
| Live voice | Experimental Codex 0.166.0 WebRTC V3 on the selected Office thread, using Office's ChatGPT login. Browser audio travels directly to the voice service; tasks and approvals use the existing Office handlers. Real-account tests cover an empty chat, generated speech triggering a completed Codex task, received audio packets, and hangup. Physical microphone behavior and subjective voice quality still need manual testing |

## AI usage response detail

**AI Center** opens with today's usage by purpose. Daily token bars also open a
purpose overview (click or Enter/Space), then a purpose's composition, then
optional response records. Filter by employee/configured model/Task; records
can be sorted by total or uncached input. Task labels use the existing short
code/title only when a real stored dispatch binding exists; historical missing
bindings remain unattributed. Configured model is not proof of the actual model.

This feature is a read-only **Codex 0.166.0 internal-format compatibility
adapter**, not a stable public billing or per-HTTP-request API. It reads only
Office-owned, mapped `sessions`/`archived_sessions` rollout metadata and counts
top-level `token_usage_record.usage` by origin thread plus response ID. It ignores
cumulative turn/thread usage and inherited duplicates. It never reads native App
data or stores prompt, tool-output or reasoning bodies. Unsupported runtime/source
versions or schemas are reported explicitly; an unverified custom CLI override
disables this reader. Ordinary account usage remains usable.

Office's default view uses the last **24 complete hours**, anchored by the
server to the UTC hour: `[end - 24 hours, end)`. Overview, purpose composition,
records and pages share that anchor and immutable snapshot. A new hour opens a
new first page; stale replies cannot replace it. Local time is for display only,
so daylight-saving changes still cover 24 real hours. The existing date/timezone
query and account-day drill-down remain available. New clients use `schemaVersion: 2`
for the expanded purpose/source union (rolling queries imply v2); old day clients
receive unsupported new categories under their existing Unknown label, with
`recordedPurpose` retaining the actual category. Token totals are unchanged; provider account numbers are
an independent reference and are never used to scale Office totals.

Coverage is incomplete. Known Office roots, metadata-proven descendants and
helpers in the same isolated runtime home use the existing read-only reader.
Helpers without a proven employee association remain unattributed. Metadata
recovery uses bounded background `thread/list` pages, including archived and
subagent source kinds; chat/frame callbacks only enqueue bounded metadata.
Native and suggestion records with the same provider response identity are
counted once across roots, children, forks, replay and restart. Conflicting
values are exposed, not added. Different response IDs still count separately.

Dictation records existing HTTP response usage before text validation. Valid
reported input + output tokens are counted; missing cache/reasoning components
stay null. Duration-only seconds are not converted to tokens. Every actual
POST has its own attempt ID, including an existing auth retry; preflight rejection
is not a provider attempt. Request IDs are namespace-scoped deduplication aliases.
Failed, cancelled or malformed results without usage stay unknown. No audio,
transcript, authentication data or full provider response is retained. Numeric
receipts use the same asynchronous index; a hard crash can lose an unflushed
HTTP/sample receipt when upstream offers no replayable ledger.

Foreground compaction response records are already counted. Background
compaction budget updates lack recoverable per-response identity; native realtime
audio and arbitrary external AI tools also lack a usable usage contract here.
The coverage status list distinguishes embedded cost, partial measurement,
upstream-unavailable and unsupported paths. Unknown usage is not zero and unknown
purpose does not discard known usage. No claim of 100% numerical coverage is made;
original historical purposes and failed upstream usage are never guessed.

A private asynchronous derived index under `office-runtime/token-usage` avoids
rescanning original logs on each query. Detail covers at most the latest **14
local natural days**, with extra UTC shards for timezone/DST boundaries, and a
**64 MiB** derived-storage budget. Capacity can evict older complete UTC days
earlier: the displayed start date moves forward, and a first local day cut by a
UTC eviction boundary is marked partial. Dates outside the current retained
range are identified explicitly. Original logs are never deleted by this index.
Current-day saturation stops indexing with a visible coverage warning.

Purpose tags come from existing business entry points, not message keywords or
the latest Task/Owner. The exclusive measured categories are chat/user work,
gray suggestions, dictation, scheduled work, firefighter work, collaboration-triggered
work, mixed and unknown. Collaboration includes actual task execution; it is
not a measurement of pure coordination overhead. Continue/recovery inherit the
recorded original purpose; different-purpose steering makes that turn mixed.
Uploads, references, edits and retries do not create a second copy of usage.
The view reports when purpose recording began (`purposesRecordedFrom`); older
untagged records stay unknown.

For a date/timezone/employee/model/Task snapshot, **S** is the sum of all deduped
observed responses with a known total, including mixed and unknown purposes.
Each purpose's share and average use that full set, not the current record page
or account-day bar. Choosing a purpose keeps the same S until refresh or a base
filter change. Missing-usage results are disclosed and excluded from S; these
shares are therefore not percentages of all actual account consumption.

AI Center keeps a compact Overview and a separate **Token breakdown** page in
the same dialog. The v2 detail snapshot optionally adds `breakdown`: components
of total-known responses only, complete Task/Agent/Source contributors, costs,
and a pricing version. Partial fields from total-unknown rows do not become part
of S. Top five plus Other uses the complete server aggregate, not a record page.
The three groupings show the same consumption and must not be added together.
Records are fetched only on request; changing a base filter creates a new
snapshot at the same hour anchor. An expired snapshot requires explicit refresh.
An older gateway without this projection shows the capability as unavailable.

Costs are **USD Standard/global API equivalents**, using the model recorded in
each response's configuration, not proof of its served model, subscription bill
or quota consumption. A small versioned static table identifies the official
sources and check date. Unknown models/aliases or missing required quantities
remain unpriced. Each response gets its own applicable long-context tier before
aggregation. Cache reads, ordinary input and writes are mutually exclusive;
reasoning is already part of output. Never add either a second time.

Native cache-write zero can come from `serde(default)`. Without presence or
retention evidence it is not a verified zero. Existing raw telemetry is kept,
but the new projection does not count such zeros as verified writes. Cost uses
an explicitly labeled range for possible writes/retention; all-cached input can
mathematically imply no writes. The page shows priced/unpriced coverage and the
estimated portion's range. It excludes external tools, storage and compute.

Source labels describe triggers. The current numeric collector has no reliable
response-to-action join for general work versus communication. This capability
is shown as not collected, without a fabricated percentage or new classifier.
No prompt/body collection, producer change, model request or send-path work is
introduced by the breakdown projection.

Gray suggestions additionally retain the existing `thread/sample` response's
`responseId`, source context turn and reported input/cache/output counters,
including empty or unused suggestions. Cache hits do not count again; a new
native response after restart does. Input plus output derives the total. Sample
reasoning/cache-write counts and actual child thread/turn are not provided and
remain unknown, rather than zero or invented parent IDs. Native rollout records
retain their stricter validation and complete four-part split. Across sources,
a matching actual response ID is reconciled within this Office scope; conflicting
counts are flagged and not added twice. Metering never starts another model
request or waits for index I/O in the send/suggestion path.

Source/question identification is embedded in main responses and cannot be
separately apportioned. Compaction lacks reliable independent response linkage;
dictation and voice-call audio tokens are not currently measured. Hidden native
work and third-party AI tools are not fully observed. These appear as unknown
or embedded cards outside S. Company planning's legacy route is statically
unsupported by this backend; this view does not revive it or infer consumption.
Ordinary history/config/account/file reads, uploads, screenshots, local music,
monitoring and mock calls do not themselves create a model-token entry; any
tool/context content consumed by a later model response stays in that response's
input. Exact new-user/history/instruction/tool input token splits are unavailable.

## Optional speech and suggestions

OpenClaw transcription and ElevenLabs reply playback have been removed. Office
keeps Codex session speech controls visible and disabled when the runtime reports
those capabilities as unavailable. There is no fallback to an OpenClaw runtime.

Suggested prompts use Office's existing ChatGPT sign-in through Codex's
experimental `thread/sample` method. They require no API key and leave the native
desktop App untouched. Sampling uses the latest completed turn and does not append
a message, start a task or execute tools. One result is reused per completed turn
while the gateway runs; a new user turn invalidates the suggestion. Unsupported
sampling or account errors leave the composer without a suggestion. This is
version-specific behavior verified with Codex 0.166.0, not a stable cross-version
or native App prediction contract. The Apply button accepts an editable draft on desktop and touch devices; Tab in the input does the same. Clicking the suggestion text only focuses the input. Send submits it.

Dictation records locally, then submits the completed WAV for text to fill the
composer. It never starts a Voice Chat session or a Codex turn. The existing
explicit Enter/send action remains available; merely stopping or retrying a
recording does not submit a chat message.

Without `OPENAI_API_KEY`, the gateway reads **only its Office-owned Codex home's**
file-backed ChatGPT login and calls `https://chatgpt.com/backend-api/transcribe`.
This is an **undocumented, unofficial endpoint**, not a stable public API or a
guarantee for all accounts. It was separately tested with an Office-owned login
and synthetic Chinese audio. The implementation does not inspect the native
App installation, home, keychain, database or sessions. Credentials stay on the
gateway and requests reject redirects. See the community implementations
[codex-asr](https://github.com/Wangnov/codex-asr) and
[GPT Voice](https://github.com/entropyconquers/gpt-voice) for route provenance;
community results do not establish account entitlement or long-term availability.

An explicitly configured `OPENAI_API_KEY` on the **gateway only** continues to
select the [public file-transcription API](https://developers.openai.com/api/docs/guides/speech-to-text),
with `CLAW3D_TRANSCRIPTION_MODEL` or the default `gpt-transcribe`. There is no
silent fallback to a separately billed provider. Subscription credentials never
go to the public API. Transcription requests use the service's configured HTTP
proxy without changing the process-wide network dispatcher.

An expired subscription token or first HTTP 401 gets one renewal through the
Office-owned Codex client's public `account/read` and one retry. Network,
timeout, permission, missing-route, rate-limit and unexpected-response failures
publish a disabled capability to every subscribed composer. The normal cooldown
is 60 seconds; rate limits honor a bounded `Retry-After` (15 seconds to 15 minutes).
After cooldown the button permits another **user-initiated** attempt, without
claiming the upstream is healthy and without uploading retained audio in the
background. Signing in again immediately re-evaluates availability. Missing login
stays disabled. There is no automatic resend for network/service failures.

Upstream requests have a 60-second timeout and two concurrent recordings maximum.
Cancellation, silence, invalid/oversized audio and local request errors do not
trip the service-wide capability. Failures retain the recording for retry or
download; users can still stop an active recording while the capability is
disabled. Errors sent to the UI are fixed messages, never raw upstream bodies,
credential paths or tokens. Greyed controls explain the reason and recover from
streamed capability changes without a reload. Account access, browser microphone
permissions and recording quality can still vary by device.

## Experimental voice calls

The headphones button starts `thread/realtime/start` with WebRTC V3 on the
current Office-owned Codex thread; hangup calls `thread/realtime/stop` without
interrupting a coding task. This uses Office's own ChatGPT login, subject to
account voice availability and limits, and does not require the optional
transcription API key. Codex itself performs authentication and call negotiation.
Office enables the app-server experimental API for this version-specific path.

Calls on idle chats capture the current model, reasoning effort, folder roots
and access policy; an already running task keeps its existing configuration.
Change settings after hanging up. Native automatic startup context
collection stalled during the installed-version probe, so Office disables it
and supplies only the selected project's folder context (up to 4 KB) and recent
visible user/assistant messages (up to 12 KB, at most 12 messages). It does not
scan other projects or the user's home for voice context. The backing Codex task
retains its original thread and full managed history. The voice and task models
have different prompts; native delegation can consult the original task context.
A disposable real-WebRTC test on 0.166.0 recovered an old chat label excluded
from the bounded startup messages, then remembered a newly spoken label in a
normal task turn after hangup. This confirms both directions in the tested
version, not identical context windows or a stable cross-version contract.

Saved chat uses native `thread/timeline/list`, and live chat uses committed
`thread/realtime/item/completed` entries. Spoken messages are marked Voice;
ordinary task messages retain their native IDs. Browser captions show only the
last four completed utterances, using V3 `turn.done`, and are not a second history
store. History remains paginated and bounded per response.

The Office screen owns the call independently of the selected chat. Switching
workers or closing the chat pane preserves the original connection and recent
captions. An away-from-chat control shows the call's owner and lets the user
return, mute, or hang up. Microphone mute toggles browser audio tracks without
ending the call. Voice choice comes from native `thread/realtime/listVoices`
(V3 choices); voice and browser microphone processing preferences apply on the
next call and are stored in that browser. Physical microphone behavior still
needs device testing.

Only the initiating browser tab receives call events and can hang up. Closing
the tab or losing its gateway connection ends its call and releases browser
audio resources. One call is admitted at a time. HTTPS (or localhost), microphone
permission and a working WebRTC network path are required. Failure is reported
without falling back to a paid API or attaching to the native App.

## Reproduce validation

Confirmed failed or interrupted turns receive a gateway-owned continuation
after 15 seconds, regardless of error code. Each recovery episode permits at
most three automatic attempts; success or new user input resets that budget.
The retry count and explicit Stop intent persist in Office metadata, so a
gateway restart cannot reset the limit or restart a stopped session. Startup
reconciles the latest native turns and also recovers existing failed/interrupted
sessions. Older installations did not record manual Stop intent; it cannot be
reconstructed retrospectively from an interrupted status alone.

The timer survives closing the chat, shows a cancellable countdown, and keeps
the worker in the working state. Stop cancels the timer or interrupts its
in-flight continuation. A new user message or new turn cancels the old timer.
Every automatic attempt rechecks the same original conversation for a terminal
turn, available account, no active work, and no pending approval/question. It
never replays the original user input or attachments. An ambiguous RPC result
is checked against the latest native turn before another attempt; an active or
completed turn is never replayed. Native in-progress retries remain native.
Merely opening a historical conversation does not schedule a continuation.

Run the focused unit tests and TypeScript check, then the opt-in integration:

```sh
npm run test -- --run tests/unit/codexOfficeRuntime.test.ts tests/unit/officeModelServices.test.ts
npm run typecheck
node scripts/check-office-codex.mjs --codex /absolute/path/to/pinned/codex
```

The integration uses a real Codex engine, disposable Office directories, a
loopback synthetic model and a separate foreign-state sentinel. It tests 12
behaviors, including restart/continuation, images, terminal controls and stop.
It does not use the native App home or a paid model endpoint. Its own processes
and temporary state are removed on completion. Browser validation additionally
checks Office project/chat creation, settings and unavailable feature controls.

Legacy native-session gateway/index, shared-owner, private dictation and private
prediction implementations have been removed. The independent gateway retains
the shared session controls, history, stream, uploads, assets and workspace modules.

Turn-state recovery tracks turn lifecycle revisions separately from token usage, questions and item updates. An unrelated streamed update must not discard the latest-turn read; a newer turn start/completion must still win.

## Agent message-chain diagnostics

The usage reader revalidates canonical rollout paths through the existing official
resolver at most once per minute (and on a normal turn start), even if the old
file remains. Canonical_segment filenames require the same allowlisted real
path, non-symlink regular file, canonical session_meta ID and supported version.
An unresolved current path is unavailable, not an old EOF advertised as ready.
Rotation replays numeric records safely through existing response-ID deduplication.

Accepted dispatches retain registered sender metadata, receiving Office identity,
request ID and the actual start/steer result. Metadata is not personal identity
proof on the shared authenticated service. Immutable multi-entry bindings keep
old snapshots stable. Each receiving turn's observed responses are summed once;
multiple messages never multiply that pool. Per-message incremental tokens and
net savings remain unknown. Unconfirmed dispatches are not invented as starts.

A bounded private communication.json sidecar shares the numeric index lifecycle:
64 entries per turn, 2,048 entries globally, bounded message-item identities and
turn tool metadata, and the existing metadata byte limit. Truncation/recovery gaps
are explicit and do not stop numeric metering. No message, command, output or
reasoning body is stored in this diagnostic ledger. Exact native clientId/itemId
joins permit an explicit click to use the existing protected message-context API.
Tool evidence is turn-level; absence is not proof of waste, and MCP activity is
not automatically classified as engineering. Original receiving-session history
remains available. Old history without a captured ledger is not guessed/backfilled.


### Native code-mode scope metadata (opt-in, Codex 0.166.0)

`CLAW3D_CODEX_SCOPE_LOGS=1` enables an identity-only adapter for the Office-owned
Codex child. It is off by default; merging this code does not activate it in an
existing service. It sets only that child's `LOG_FORMAT=json` and
`RUST_LOG=warn,codex_code_mode::timing=info,codex_otel.trace_safe=info`.
No full rollout trace or global debug logging is enabled.

Only validated conversation/turn/call/cell/tool identities are retained in the
existing private `token-usage/communication.json` sidecar. Raw JSON, spans,
JavaScript, arguments, tool output and reasoning are not retained. Warnings and
errors keep their message; stderr is drained without pausing native execution.
Oversize/malformed records, a saturated error relay and missing identities
produce explicit gaps. Existing native process/RPC failure handling is unchanged.

The creator is the `exec` host-timing event, never a later `wait` for the same
cell. Child receipts join only by native process generation + conversation +
cell, preserving late/out-of-order delivery. Each native process gets a new
generation, so reused cell numbers cannot join across restarts. Missing or
conflicting identities stay unlinked; no time or name-prefix matching is used.
This establishes a parent edge, not a response boundary or a Purpose label.

The queue holds at most 1,024 events; retained scope evidence is limited to
2,048 records and 256 KiB, with the existing 16-day retention boundary. Scope
limits cannot stop numeric metering or displace the existing message ledger.
Historical missing scope events are not inferred or backfilled. Runtime logging
activation and production coverage remain separate acceptance steps.
