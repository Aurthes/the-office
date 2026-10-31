# Non-invasive Codex integration: capability assessment

**Accepted product decision (2026-10-31):** Office projects and sessions are
independent of the native App. Do not implement App project/session sharing,
including read-only discovery or queued messages. Reuse Codex for Office-owned
conversations. [Office-owned state and chat features](office-owned-state.md)
defines the current direction; the assessment below records earlier research,
not the selected architecture. The running legacy mode has not been migrated by
this documentation change.

The Office is an optional companion to an unmodified Codex/ChatGPT App. Installing,
running, upgrading, or removing Office must not require changing the App's files,
launcher, global environment, configuration, or execution ownership. Office adapts
to the capabilities an ordinary installation offers. Missing capabilities must
remain unavailable rather than trigger a private App override.

This assessment distinguishes existing-App observation from Office-owned Codex
sessions. It is not approval to implement a replacement execution architecture.

The [2026-10-31 interoperability audit](codex-interop-audit.md) adds native-App
and isolated tests plus official/public-source evidence. In particular, it
verified official queued text submission without taking over the App. Tested
capabilities below are prospective integrations, not newly enabled web controls.

## What went wrong

The shared-owner integration replaced the App's normal backend startup with an
Office-managed `codex app-server`. Private launch environment overrides directed
the App to that service. Both clients could then operate the same loaded threads,
but the App depended on Office's service. Using an official executable did not
make that change non-invasive. That integration is retired.

The existing session gateway can instead run without a shared control socket.
It then opens the local session index read-only and launches a separate history
reader whose allowed requests are `initialize` and `thread/turns/list`. It does
not attach to, resume, or execute the App's active threads. Write controls are
unavailable. Removing shared control from this gateway does not by itself change
an already-running desktop App; the App's launch environment and owner must also
be restored.

## Feature assessment

| Feature | With the App untouched | Current implementation and limit |
| --- | --- | --- |
| 3D office, character layout, session list, search, manual collapse, responsive layout | Available independently | Office UI and local preferences need no App changes. |
| List existing local App sessions and projects | Available for compatible local versions | The current adapter reads private SQLite and App state formats. These are not a universal installation contract. |
| Read saved conversation history, render images and linked reports | Available for compatible versions | The gateway uses paginated history reads and bounded local asset access. This is saved history, not ownership of the running turn. |
| Observe working/idle state and completion | Best effort | Persisted task events can lag or be incomplete. Do not present this as the App's exact live runtime state. |
| Open the original conversation in the App | Version-specific | The current `codex://threads/…` link does not require a backend change. Availability must be checked for the installed App. |
| Queue a text follow-up in an existing App-owned conversation | Official stable `codex queue`; native App fixture processed it successfully | Still disabled in the deployed read-only adapter. Queue receipt is not proof of execution; goal-driven delivery and attachments are not validated/supported by this result. |
| Directly start/steer/stop an App-owned turn or answer its approvals/questions | No external connection to the normal App owner demonstrated | The current controls need the retired shared owner. Do not start a second executor against the same loaded thread. |
| Exact live token/tool stream from the App's active owner | Unavailable through the unchanged App interface inspected here | Reading persisted records is not a substitute for access to the active owner's event stream. |
| Rename/archive/restore saved native App chats | Published thread APIs; native fixture readback passed both directions | Disabled in the current adapter. Instant sidebar refresh is unverified; lifecycle actions must not be used as a hidden execution-takeover mechanism. |
| Create/reassign/manage App projects in both UIs | No stable App project-sync contract established | Experimental CRUD passed in isolation. Native read-only comparison matched folders but not IDs; App management-tool IDs were rejected by protocol reads. No private database/cache writes. |
| Native App voice calls, dictation, and grey prompt suggestions | Current implementations unavailable | These implementations use the retired owner and native context. Independent Office speech or suggestions could be designed separately, without claiming App parity. |
| Browse workspace files or run a terminal | Current workspace controls unavailable | They currently use the shared owner. Independent, explicitly scoped file/terminal access is possible without changing the App; it is a separate implementation. |
| Run conversations owned by Office using an installed Codex | Feasible without changing the App | The existing standalone adapter launches `codex app-server` over stdio. Own-thread text, streaming, and stop already exist. It does not inherit the desktop App's live thread ownership or App-only tools. |
| Resume a stored thread using an Office-owned server | Documented; isolated sequential handoff retained model-visible history | Another process's loaded thread remains locked even when its turn is idle. Release is required; App-only tool/context parity is not established. |
| All Codex/App versions, hosts, cloud chats, and native-only plugins | Cannot promise | Installation discovery, protocol compatibility, account/tool availability, and local versus remote ownership differ. Unsupported combinations need a clear unavailable state. |

## Public interfaces and compatibility

The [official App Server documentation](https://learn.chatgpt.com/docs/app-server)
describes starting a server, initialization, thread/history APIs, turn execution,
steering, interruption, streaming, and approvals. It also describes version-specific
schema generation and marks the app-server command and WebSocket transport as
experimental (see the [CLI maturity reference](https://learn.chatgpt.com/docs/developer-commands)). These are documented integration interfaces, not a guarantee that
every release or desktop App exposes an externally controllable active backend.

The [official CLI documentation](https://learn.chatgpt.com/docs/codex/cli) describes
the separately installable Codex CLI. Office should discover an installed CLI
rather than require a hard-coded path inside a desktop App bundle. Compatibility
must be stated as a tested version/capability range. Private App data adapters
must be identified separately from documented protocol support.

If a future App provides a documented external interface in its normal setup,
Office can use it within that interface's advertised capabilities. Its absence
must never be solved by taking over the App's backend or injecting launch flags.

## Development rule

For each proposed feature, first identify the interface it needs and confirm it
works on an ordinary installation without App modifications. If not, report the
limit and keep the feature unavailable. Do not copy App-specific tool identities,
rewrite private App databases/caches, silently transfer live thread ownership, or
change user authentication/model/permission settings to simulate compatibility.

The selected baseline is independent Office projects, sessions, and runtime
state. Read-only native discovery, queued follow-ups, and metadata interoperability
are not planned product extensions even where a bounded experiment succeeded.
The audit is retained as evidence, not authorization to rebuild shared controls.
