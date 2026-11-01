# Codex interoperability audit — 2026-10-31

**Subsequent decision:** the product will use independent Office projects and
sessions, without native-App interoperability. The experiments and recommendation
below are historical evidence, not the selected implementation direction. See
[Office-owned state and chat features](office-owned-state.md).

The Office can reuse the Codex agent engine and some saved-session workflows
without replacing the desktop App's backend. It cannot promise that two
independent UIs control the same live execution or share the App's entire project
catalog. In particular, an official **queued message** worked with an unchanged
App in this audit; that is different from taking over or steering its active turn.

This is an evidence report, not an implemented integration or an architecture
decision. The deployed existing-App gateway remains read-only. “Office-side”
below means a separate protocol probe, not acceptance of the website's controls.

## Goal and boundary

Reuse documented Codex/OpenAI capabilities while preserving normal App startup,
configuration, authentication, permissions, and backend ownership. Use the
smallest diagnostic changes; do not redesign the product in this round.

No App installation, launcher, global environment, or configuration was changed.
No private database or cache was edited directly. Normal Codex APIs were allowed
to save the disposable test session. No existing user conversation was modified.

The native test used one explicitly authorized temporary App chat and exactly
two fixed-marker messages, with no agent tools or file work. It ended archived.
All other execution and project-mutation tests used fresh temporary Codex homes, a
loopback synthetic model, and no real model account. Those processes and temporary
homes were removed afterward.

## The concepts that must stay separate

| Concept | What it means | What sharing it does not establish |
| --- | --- | --- |
| OpenAI account / Codex login | Identity and access for a client | Shared conversations, projects, tools, or billing for every separate API |
| Model API | Text, audio, or other model inference | The Codex agent loop or the desktop UI |
| Codex agent engine | Conversation execution, tools, approvals, streaming | Access to a different process's loaded turn |
| Saved thread | Persisted identity and conversation history | A live event subscription or permission to run a second writer |
| Live execution owner | The process currently holding a loaded thread | Automatic release merely because its last turn finished |
| Working directory / repository | Files that clients can explicitly work with | The App's sidebar project registration, ordering, or workspace metadata |
| App project catalog | The App's grouping and presentation of work | A stable two-way project API for third-party clients |

The official [App Server documentation](https://learn.chatgpt.com/docs/app-server)
explicitly presents Codex's open-source agent backend as an integration surface
for other products. Reusing Codex therefore goes beyond calling a model. However,
the [CLI reference](https://learn.chatgpt.com/docs/developer-commands) currently
labels `app-server` Experimental; documented APIs and a release-independent
desktop synchronization guarantee are different promises.

## Capability map

| Capability | Documentation / empirical result | Practical boundary |
| --- | --- | --- |
| Run Office-owned Codex conversations | Official App Server integration; isolated execution and streaming worked | Separate owner; App-only tools and UI context are not automatically inherited |
| Read saved sessions and history | Published thread APIs; isolated and native-fixture reads worked | List visibility can lag; process-local status is not the App's exact live status |
| Send a follow-up into an App-owned chat | Official stable `codex queue`; native App processed the second marker in the original chat | Text only; successful enqueue is not proof of execution, immediate delivery, or steering |
| Rename saved chats both ways | Published `thread/name/set`; independent probe and native App read back each other's names | Readback passed; real-time cross-process UI refresh was not established |
| Archive / restore saved chats | Published lifecycle methods; App-to-probe archive and probe-to-App restore passed | Use only intentional lifecycle actions, not archive/unarchive tricks to seize execution |
| Continue the same saved thread in another client | Published resume workflow; isolated handoff retained model-visible history | Original owner must release it. In this version, merely finishing a turn did not release it |
| Both independent servers execute the same loaded thread | Maintainer warning and native writer-lock rejection agree | Do not offer concurrent writers or bypass the lock |
| Observe/control an App-owned active turn | No externally attachable normal App endpoint was available in this installation | No supported external steer, interrupt, approval answer, or complete live tool stream was demonstrated |
| Two clients attached to one Office-owned server | Isolated observer received turn-completion events | Valid for a server Office owns; does not authorize rerouting the native App to it |
| Full App project synchronization | Experimental project CRUD works in isolation; native catalog comparison matched folders but not project IDs | App management-tool IDs were rejected by the protocol project reader. Matching folders is not an interchangeable project identity or a safe two-way editing contract |
| Exact native dictation / voice / grey suggestions | Existing Office paths use private endpoints or experimental methods | These paths cannot be presented as stable public App integrations |
| Office dictation, voice, or suggestions through public APIs | Separate documented model/audio integration is possible | Requires its own implementation and access/billing validation; not tested or implemented by this audit |

The native queue result is an important correction to the earlier blanket
assessment that sending to an App-owned conversation was unavailable. The
supported operation found here is **enqueue a text follow-up**, not direct
`turn/start` or `turn/steer` against the App's private stdio owner.

## What the official guidance and public discussions actually establish

### Positive examples of sharing

The [CLI documentation](https://learn.chatgpt.com/docs/developer-commands)
documents `/app` opening the same saved CLI chat in the desktop App, stable
resume/fork/archive workflows, and stable `codex queue`. Its queue section also
states that image attachments are unsupported. These are positive evidence for
specific saved-session workflows, not a promise to expose every App capability.

An OpenAI maintainer [confirmed using CLI sessions in the App](https://github.com/openai/codex/issues/24197#issuecomment-4527832901).
In the same discussion, the maintainer [explained that sidebar project registration filters which chats appear](https://github.com/openai/codex/issues/24197#issuecomment-4531830034).
The reporter closed that issue on 2026-10-29 after using the chronological sidebar
view. Its resolution does not establish a two-way project-management API.

The [Windows/WSL guide](https://learn.chatgpt.com/docs/app/windows#share-config-auth-and-sessions-with-wsl)
also explicitly describes sharing configuration, authentication, and saved
sessions. That platform-specific guidance is not authorization to alter a Mac
App's environment or run concurrent independent writers.

### A saved session is not shared live execution

In a [2026-05-07 maintainer response](https://github.com/openai/codex/issues/21513#issuecomment-4398242133),
OpenAI distinguished sequential resume from simultaneous use by independent
app-server processes. The current writer-lock tests below reproduce that
distinction. A closed issue is not evidence that the simultaneous-writer workflow
became supported.

The external-steering requests [#48928](https://github.com/openai/codex/issues/48928)
and [#51625](https://github.com/openai/codex/issues/51625) remain open at this
audit's date. They distinguish queued follow-ups from `turn/steer` and describe
the missing connection to the App-owned stdio server. These are user reports and
requests, not an official assurance that no future endpoint can exist.

### Known pitfalls, with their dates and limits

| Source | Observation | What it does not prove |
| --- | --- | --- |
| [#52705](https://github.com/openai/codex/issues/52705), 2026-10-09, CLI 0.160.1 / Windows App 26.1002 | Externally queued items can wait behind an active goal until manual intervention | Our ordinary idle-chat success does not validate goal-driven delivery or a fix in the current Mac version |
| [#34076](https://github.com/openai/codex/issues/34076), 2026-07-18, CLI 0.145 / App 26.715 | Saved session data can exist while project/sidebar discovery misses it | Not proof the current release reproduces the old failure; do not repair private catalogs from this report |
| [codex-plugin-cc #382](https://github.com/openai/codex-plugin-cc/issues/382), CLI 0.139, updated 2026-09-29 | Multiple independent processes using one home can interact through global mutable state | A community report, not proof that every shared-home operation fails on 0.166; proposed credential/file workarounds are not adopted |
| [#14722](https://github.com/openai/codex/issues/14722), closed 2026-08-04 | The original reporter said the reported session-sharing behavior appeared to work | Not a comprehensive App/project synchronization contract |

The official [own-app integration recipe](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
demonstrates an application using Codex app-server and resuming its stored threads.
It does not promise automatic desktop project sync. Separately, the third-party
[OpenClaw native-feature guide](https://docs.openclaw.ai/plugins/codex-harness/native-features)
documents isolated homes and cautions against independently resuming the same
thread concurrently. It is useful implementation experience, not an OpenAI support
commitment.

## Experiments and results

Tested on 2026-10-31, macOS, desktop App `26.1027.30824` (build `22943`), with
bundled command `codex-cli 0.166.0-alpha.5.1`. These results cover this installation
and binary, not all releases, machines, authentication types, or cloud sessions.

### Generated protocol contracts

Generated JSON schemas with and without `--experimental` from that exact binary:

| Interface | Default schema | Experimental schema |
| --- | --- | --- |
| Thread start/list/read/resume/fork/name/archive/restore | Present | Present |
| Project list/read/create/update/delete | Absent | Present |
| Project ID on thread start/list/metadata update | Absent | Present |
| Native thread realtime start/stop and `thread/sample` | Absent | Present |
| Queue change notification | Present | Present |
| Queue mutation RPCs | Absent | Present |

The public **CLI command** `codex queue` is separately documented as Stable.
Its implementation using experimental RPCs is not a reason to bypass the CLI
contract or directly write queue storage.

### Read-only native project comparison

Compared the native App's first-party project-management tool with a separate
Codex client using `experimentalApi: true` and only `project/list` / `project/read`.
No project creation, update, deletion, or thread reassignment was requested in the
normal user home.

Both interfaces listed four projects with the same four canonical directory
paths. **None of the four project IDs matched.** Passing each App management-tool
ID to `project/read` returned `project not found`; the protocol list was complete,
not a partial page. The read-only probe then exited.

This establishes a folder mapping in this installation, not identity equivalence
between the two interfaces. It does not identify the App's private storage model,
prove every release behaves this way, or justify translating IDs by editing a
database. In particular, the App's first-party management tools are not themselves
an external integration contract for Office.

### Twenty isolated observations

The probe script was retired with the native-App backends. Its
[original source](https://github.com/Aurthes/the-office/blob/ca30001/scripts/audit-codex-interop.mjs)
remains in Git history. These observations record that historical experiment;
current runtime validation uses `scripts/check-office-codex.mjs` as described in
[Office-owned state](office-owned-state.md#reproduce-validation).

The original probe used private temporary Unix sockets and homes, stripped
inherited Codex settings from child environments, and simulated model responses
locally. It did not connect to the desktop owner or open the user's session
databases. Its default clients did not opt into experimental APIs; only the
separate project fixture did.

| # | Observation | Result |
| --- | --- | --- |
| 1 | Process B lists A's saved session | Pass |
| 2 | B reads A's saved turn history | Pass |
| 3 | B renames; A explicitly reads the new name | Pass |
| 4 | Cross-process rename notification within 300 ms | Not observed; not proof that a later refresh is impossible |
| 5 | A renames; B reads the new name | Pass |
| 6 | `project/list` without experimental opt-in | Rejected as requiring experimental capability |
| 7 | B resumes while A executes | Blocked: active writer |
| 8 | B resumes after A's turn ends but A remains loaded | Still blocked: idle is not release |
| 9 | A exits; B resumes and continues the same ID | Pass; all three turns readable |
| 10 | B's actual synthetic-model input includes the original prompt | Pass; more than a transcript-display check |
| 11 | Archive visible to a fresh reader | Pass |
| 12 | Restore visible to another process | Pass |
| 13 | Reverse rename/archive after owner release | Pass |
| 14 | A separate Codex home has separate sessions | Pass |
| 15 | Another client resumes an empty thread before its first turn | No rollout yet; durable visibility requires a persisted record |
| 16 | Two clients on one server receive turn completion | Pass |
| 17 | Experimental project create/list/read across peers | Pass in the isolated project home |
| 18 | Experimental project rename read back by the other peer | Pass |
| 19 | Experimental project membership on start and filtered list | Pass after persisting a synthetic turn |
| 20 | Experimental project delete | Pass; member thread remains readable and its project ID becomes null |

These are compatibility observations, including intentional rejections and
limitations. They are not twenty affirmative feature-support guarantees. Project
mutations were confined to the isolated home; native project comparison was
read-only.

### Native App / independent client fixture

| Step | Result |
| --- | --- |
| Native App creates a temporary chat and replies to marker A | Completed; no agent tool work |
| Independent client reads that chat's saved history | Marker A readable |
| Independent client renames; native App reads the result | Pass |
| Native App renames; independent client reads the result | Pass |
| Independent client resumes while the App holds the idle chat | Rejected: active writer |
| Official CLI queues authorized marker B, without `--resume` | CLI accepted the item; native App then actually replied B in the original chat |
| Independent reader checks the saved original chat | Both A and B turns present |
| Native App archives; independent client lists archived chats | Fixture present |
| Independent client restores; native App lists active history | Fixture present |
| After that lifecycle released ownership, independent resume | Accepted; both turns readable; no third message sent |
| Cleanup | Original test title restored, fixture archived, probe process exited |

The initial saved-session list did not find the fixture even though reading it
by ID worked. A later list found it after the second normal user turn. The audit
did not isolate which event made it visible. Do not claim instantaneous catalog
sync or diagnose database corruption from that observation.

The native observer was the App's first-party management tools. That establishes
App-side catalog readback, not visual acceptance of the sidebar, and it does not
make those first-party tools a public third-party connection interface. No private
UI-control workaround was used. Full native-App-to-Office-model continuation was
not tested with a third message; model-visible history handoff was tested only in
the isolated fixture.

Creating a new Office-origin thread and checking its appearance in the App's
default sidebar was not tested. Official CLI-to-App sharing evidence does not
establish that every third-party source/originator gets identical App discovery.
Do not impersonate the App to make an Office-created thread appear there.

## Voice and suggestions: interfaces, not inherited App features

At the time of this audit, `server/codex-dictation.js` used a private ChatGPT backend
dictation stream and native token access. `server/codex-composer-predictions.js`
used a private prediction-config endpoint plus experimental `thread/sample`.
`server/codex-session-voice.js` used experimental native thread-realtime methods.
Those implementations have since been removed.
Starting a separate Codex process does not convert those paths into stable public
interfaces.

Public [speech-to-text](https://developers.openai.com/api/docs/guides/speech-to-text)
and [Realtime](https://developers.openai.com/api/docs/guides/realtime) interfaces
can support separately built Office voice experiences. Their account access,
cost, audio quality, and end-to-end Office UX were not validated here. Native
experimental voice/sample methods were deliberately not invoked with App data. This
audit does not claim that the earlier mobile dictation timeout or retry bug is
fixed.

## Decision implications

There is useful middle ground between a model-only independent harness and a
replacement for the App's backend:

- Reuse the documented Codex engine for Office-owned work.
- Treat saved-thread reads and official queued text submission as specific
  interoperability features, with version checks and explicit delivery state.
- Keep Office project grouping independent unless a documented, tested App
  project contract becomes available. A repository path is a useful reference,
  not a reason to rewrite the native catalog.
- Do not require live takeover, concurrent independent writers, private database
  edits, internal token extraction, or App startup overrides.

This is a recommendation for the next decision, not a shipped redesign. Existing
private read-only adapters remain version-dependent; “read-only” alone does not
turn their formats into supported public APIs. A future implementation should
prefer the published Codex interfaces and keep unknown combinations unavailable.

Still unverified: goal-driven queue delivery on the current Mac App; attachment
submission through queue (currently unsupported by its documented contract);
cross-device/cloud synchronization; App-only tool/context parity after handoff;
visual sidebar refresh; compatibility across CLI/App versions; and stable
two-way App project synchronization. Do not fill these gaps by modifying private
storage or by treating a successful local probe as a general support promise.
