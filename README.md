# The Office

A 3D workspace for your Codex conversations.

**[Download for Mac — Apple Silicon preview](https://github.com/Aurthes/the-office/releases/download/v0.1.4-preview.1/The-Office-0.1.4-macOS-arm64.dmg)**

For **M1 or newer**, macOS 13.5+, and a ChatGPT account with Codex access.
Node and Codex are included. No terminal or manual gateway setup.

> **Developer preview:** Apple signing and notarization are not finished.
> macOS may block the app. [How to open the preview](docs/macos-install.md#if-macos-blocks-the-preview).

## Get started

1. **Install.** Open the DMG, drag **The Office** to **Applications**, then open it.
2. **Sign in.** In Office, click **Sign in with ChatGPT** and finish signing in.
3. **Start working.** Recruit an agent, choose a working folder, give it a name, and send a message.

Office asks you to sign in separately from the Codex App and keeps its own chats.
Music, server dashboards and other integrations are optional.

![The Office — projects have rooms and conversations have crewmates](docs/images/office-overview.png)

## Try it in your browser

**[Open the demo](https://aurthes.github.io/the-office/)** — no installation or login.
The demo uses sample conversations and simulated replies.

## Help and development

- [Install, troubleshoot or build the Mac app](docs/macos-install.md)
- [Run from source and connect Codex](docs/office-owned-state.md#setup)
- [Connect optional services](docs/operations.md) · [Remote access](docs/web-access.md)
- [Demo source](demo/README.md) · [Security](SECURITY.md)

---

Built on [Claw3D](https://github.com/iamlukethedev/Claw3D), originally by
[Luke The Dev](https://github.com/iamlukethedev), and independently maintained by
[Aurthes](https://github.com/Aurthes). Unofficial community project, not an OpenAI product.
[MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md).

### Independent task phases

New Office tasks use independent phases: one Owner coordinates the goal, and each phase has its own assigned agent, timer, handoff and review. Use each phase row to start work, pause timing or open its conversation. Controls appear on hover or keyboard focus and remain visible on touch devices. Different agents can work in parallel; completing one phase does not start another. Displayed time is cumulative phase work, not elapsed wall time or an individual's hours.

Running means an agent is still responsible for following the work, including an asynchronous job. Turn completion, task switching and Office restarts stop activity timing without pausing that responsibility. Pause explicitly when follow-up stops; only an explicit decision request is shown as needing the user. Older automatically paused records are not guessed or mass-restored. A targeted `todo_edit` status update can record confirmed follow-up without starting a timer or model call; existing execution or working-handoff identity is required. Task progress prioritizes current phases and keeps completed history expandable.

In managed Office, open a department to find its Toolbox and Library. The toolbox and bookcase in the first work bay open the same pages. The Library saves HTTP(S) links and file copies up to 20 MiB per file. Files are served as downloads. Office sign-in protects the Library, and department IDs group entries without adding separate department accounts.

Library data lives under `department-library` in the Studio data directory (`CLAW3D_DATA_DIR`, default `~/.local/share/claw3d`). Include that directory in host backup and migration. Storage is capped at 512 MiB and 1,024 entries per installation.

Task Progress in the chat Workspace lists Running work first, recent recorded progress next, and other follow-up last. Its recent window defaults to one hour and is remembered in the browser. Recently completed or archived work stays in that window; document edits and system timer stops do not count as progress. History reads are bounded to the newest 200 archived tasks, with a notice when limited, and do not change assignment badges or department counts. Older work remains available through the task history.

Phase-mode tool calls require an explicit `phaseId`. Active handoffs, reviews and recalls require the exact `handoffId`. Without an active handoff, an assigned unfinished phase can submit directly to its recorded independent acceptance manager. New phases and previously unassigned responsibility capture the Owner as reviewer; existing recorded reviewers survive ordinary edits, Owner changes and reassignment unless explicitly changed. A paused phase can explicitly update `acceptanceManagerId` through `phasePatch` or the complete plan; active handoffs retain their own review chain. Managers retain acceptance through the actual reporting chain. The legitimately completed final phase archives the task once every phase is complete and no handoff remains open, without another parent approval step.

Existing tasks keep their original whole-task workflow and recorded history. To configure future phases independently, finish old handoffs and pause the timer, then explicitly choose independent assignments. Existing completed phases keep their IDs and recorded time; missing historical assignees remain unknown. The Owner coordinates assignments without restricting ordinary member or user edits.

### Agent message delivery

Ordinary Agent messages and task notices are saved and combined after the recipient's current turn ends. User messages and Stop remain immediate. An Agent may specify `urgency: "urgent"` with an `urgentReason` only when the recipient must change current action. Contributors should end their turn after submitting rather than wait for a queued reply.

Each batch preserves its original senders, questions and independent handoffs. `office_tasks.delivery_status` exposes queued and uncertain receipts; reuse the original request ID when checking a direct message. A transport timeout or interrupted send is not automatically replayed: only an exact client-ID receipt confirms delivery. This does not promise exactly-once native execution.

The private `delivery-inbox.json` in the Office runtime directory persists messages and batch receipts. Batches contain at most eight messages / 128 KiB. The inbox has hard storage and receipt limits (8 MiB, 2,048 direct messages, 4,096 batches); full storage rejects new direct messages explicitly, while accepted pending work remains visible. Include it with task files in host backups. Existing task acceptance and actor conventions remain unchanged.

### Important task reminders

Department Heads can explicitly use `office_tasks.important_notify` with a stable
`eventId` and short saved brief for verified useful results, decisions or real
blockers. Routine progress and worker submission do not automatically notify.
Updates to the same event replace its notification. Reading a brief makes no model
request; its separate voice button starts the existing call only after a click.

Installed app labels distinguish local/private entry hosts (**Office · LAN**, LAN badge) from public entry hosts (**Office · Remote**, NET badge). Existing installations may retain their old name/icon; reinstalling can require login and notification permission again. The manifest identity, launch URL and scope remain unchanged.

Enable notifications in **Settings → Notifications**. iPhone requires iOS 16.4+
and opening Office from **Safari → Share → Add to Home Screen** before enabling.
The current site address is the installation boundary: changing it requires a new
Home Screen installation, permission and subscription. Delivery remains subject
to browser permission, Focus and network conditions; push-service acceptance is
not proof of lock-screen display. Actual iPhone delivery requires a device check.

This uses standard Web Push and a notification-only service worker, without
an offline cache. Lock-screen payloads contain only an opaque reminder ID and
generic text; details require the existing website login. Single-owner identity
and installation binding use the existing trusted Auth proxy, including logout
and password/MFA version invalidation. Gateway and Auth must share the existing
`CLAW3D_PROXY_TOKEN`; the Auth loopback port is `CLAW3D_ACCESS_PORT` (default 3035).
Native shared-service `actorId` remains an actor convention, not individual
cryptographic authentication. No third-party callback URLs are accepted.

Private Gateway files `push-vapid.json` and `important-notifications.json` retain
keys, subscriptions and bounded retry state across restart. Protect them like
other private runtime state; do not rotate/delete keys as a routine upgrade.
Push delivery has bounded retries and expiry; 404/410 subscriptions are retired.
Notification tags mitigate crash-window duplicate delivery, without claiming
exactly-once delivery. Corrupt reminder state disables reminders while leaving
chat available. No automatic microphone access, phone call or paid synthesis is
triggered by a notification.

### Codex backend updates

Managed Office installations check official npm and GitHub stable releases every six hours without model calls. Office shows an update event with **Details** and **Upgrade**; the entry is also available in Settings. Details list intervening official releases and link to their full notes. Responses, pages and note sizes are bounded; incomplete history is identified. Preview versions and disagreeing release channels are not silently selected. Failed scans preserve the last successful notes and respect Retry-After.

Only an authenticated, same-origin **Upgrade** click installs an exact version into a private, versioned runtime directory; project dependencies and the bundled package pin are unchanged. A fresh, credential-free temporary home checks the protocol without a model request. Office then waits for active or unconfirmed turns, sends, retries, approvals, voice calls and Workspace terminals to finish. A durable Gateway reservation blocks new native work during the switch; Stop and read operations remain available. An independent controller changes only the Gateway runtime selection. Native homes, login paths, Office thread mappings and persistent queues are retained. Later application deployments preserve this selection. Managed switching currently requires the existing macOS LaunchAgent deployment.

The running executable's verified version supplies status and usage metadata. Internal usage adapters remain version-specific: a newer backend does not imply its token format has been validated. Protocol checks do not prove every model-dependent behavior.

Native upgrades differ from ordinary application rollback. After the old native process exits, the controller keeps a private snapshot of its root SQLite file groups, including WAL/SHM. This is recovery evidence, not a complete backup of arbitrary native migrations. If a candidate may have opened real data and startup fails, the controller stops it and **does not automatically start an older binary against potentially migrated data**. Both runtimes and recovery evidence remain available for a deliberate data-compatible recovery. A restarted Office follows the same controller receipt; it never blindly repeats an uncertain switch. Private runtime, reservation, job, snapshot and state files must remain outside the repository and public assets. Preserve referenced current and recovery runtimes during maintenance.

### Session connection recovery

Chat distinguishes a lost browser-to-Office connection from a native model failure. A reported model fault replaces the working label while preserving the active turn and Stop control. Native reconnect attempts and timestamps remain unknown when the installed protocol does not expose them; error text is not parsed to invent counters. A matching new assistant output or a successful turn clears the fault, while tool updates do not. The fault survives reconnect/restart until the same turn is reconciled.

The existing Office continuation policy remains a 15-second wait with up to three attempts, showing its actual attempt and deadline. It starts only after a terminal failed/interrupted turn and does not compete with native stream recovery. This does not configure a fixed three-second native retry interval or a ten-attempt native budget. Original input and completed tools are not replayed by this UI change.

### Mounted filesystem monitoring

The server dashboard's Disk column lists each reported local or network mount separately. It shows the mount path, filesystem type, used/total capacity and percentage; these values are not summed into a physical-disk total. Unavailable capacity stays unknown while CPU, memory and network metrics remain usable. Virtual filesystems are excluded and separate NFS exports remain separate even if they share a device number.

Capacity helpers share a short deadline and a private per-user, per-mount advisory lock. The parent never waits indefinitely for a blocked `statvfs`, and subsequent probes do not pile up helpers for that mount. An uninterruptible kernel query can outlive its parent until the filesystem responds; its lock remains held. Empty lock files in the host's temporary `claw3d-monitoring-<uid>` directory are intentional coordination state and must not be removed while a helper holds them. No daemon or mount configuration is installed. The inventory is bounded to 64 mounts with an explicit notice if limited. Linux probes require Python 3; the local Mac reuses the same isolated lookup when Python is available, otherwise retaining legacy local readings with an incomplete-information notice.
