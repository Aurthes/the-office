# Scheduled conversation tasks

The small amber screen beside the operations console opens **Scheduled tasks**.
The console's **Open scheduled tasks** button provides the same entry on small
screens. Tasks belong to Office and target one existing Office conversation.
They do not belong to the screen, project, browser tab or native Codex App.

Choose **New task**, enter a name, target conversation, first run time, repeat
interval and instructions. The first time is entered in the browser's local time
zone (shown below the field) and saved as an absolute timestamp. Intervals are
fixed elapsed minutes: one day means 24 hours, including across daylight saving
changes. For an hourly report at :10, choose the next :10 as the first time and
repeat every 1 hour. **Edit**, **Pause/Resume**, **Run now** and **Delete** are
available on each task. Deleting a task preserves its conversation. An executing
run must finish or be stopped in its conversation before deletion.

The Office gateway owns one 10-second scheduling timer and writes its own
`scheduled-tasks.json` beside `office.json`, using an atomic rename. No separate
Python daemon, per-task system timer, native App storage or external scheduler
is needed. Closing the web page does not stop scheduling. The host must be awake
and its Office gateway and authorized Codex runtime must be running. There is
no wake-from-sleep or cloud-execution guarantee.

## Execution

- A due task waits for its target conversation to be idle, including pending
  questions/approvals, voice and terminal activity. It never intentionally steers
  an active user turn. The existing send path applies the conversation's current
  model, workspace and permission settings. Scheduled prompts are ordinary user
  messages; their responses appear in that same conversation.
- The message carries the original occurrence timestamp and actual dispatch
  time. Missed occurrences remain due and run in order, one active run per task.
  Instructions that calculate report windows should use the occurrence time.
- A send acknowledgement marks **Running**, not **Completed**. Public
  `turn/completed` events mark completion, failure or interruption. Completion
  means the Codex turn finished, not independent verification of its answer or
  external effects. The ten latest run records are retained per task.
- Pause removes an unsent occurrence; it does not interrupt a running turn.
  Resume starts at the next future slot. **Run now** works even while paused and
  leaves the recurring schedule unchanged. Editing a task replaces queued work;
  an already dispatched run keeps its captured target and instructions.
- A missing/archived target disables the task and retains the error. Tasks never
  silently switch to another conversation.
- The gateway persists a dispatch claim before sending. A send error or backend
  restart during dispatch/execution leaves **Check conversation** and pauses the
  task. The message may already have run: inspect the conversation, then resume
  or use **Run now**. This avoids blind duplicate sends; it is not an exactly-once
  transaction with Codex. A restart while merely waiting safely preserves the
  pending occurrence. A browser reconnect alone does not reset runs.

## Office gateway API

These methods use the existing authenticated Office gateway WebSocket. They are
Office APIs, not Codex app-server methods. Standard `connect` authentication and
the existing same-origin gateway proxy still apply; no new public HTTP endpoint
or credential is introduced.

| Method | Parameters |
| --- | --- |
| `schedule.list` | `{}`; returns tasks and available Office conversations |
| `schedule.create` | `requestId`, `name`, `threadId`, `prompt`, `firstRunAt` (Unix ms), `intervalMinutes`, `enabled` |
| `schedule.update` | Same full configuration plus task `id` |
| `schedule.delete` | `requestId`, task `id` |
| `schedule.run` | `requestId`, task `id`; queue one manual occurrence |

Create/update return `{id}`; delete returns `{deleted:true}`; run returns
`{queued:true}`. Reuse the same `requestId` and identical arguments when retrying
an unconfirmed management operation; Office's existing operation cache retains
the latest 128 operations. Changed task/run state broadcasts `schedules.updated`.
The task panel subscribes while open and reloads on reconnect. Limits: 100 tasks,
120-character names, 32,768-character instructions, intervals of 1–525,600 minutes.
Task names and instructions remain user content and are never translated.

Task configuration and run evidence may contain private instructions. They stay
under the Office data directory and must not be committed to this repository.
The scheduler never reads, imports or edits native Codex App automations. To move
an existing workflow, create an Office task with the required ordinary script
paths and instructions, validate it in the chosen Office conversation, then
disable the original through its own owner. Do not run both schedules in parallel
for the same reporting window.

## Validation

From a service shell that exports `NODE_ENV=production`, install development
tools with `npm ci --include=dev` and run unit tests with `NODE_ENV=test` so React
test helpers and Node module resolution use the test environment. For example:

```sh
NODE_ENV=test npm test -- --run tests/unit/officeSchedules.test.ts tests/unit/scheduledTasks.test.ts
node scripts/check-office-codex.mjs --codex /absolute/path/to/office-installed/codex
```

The integration check uses the actual pinned CLI against a loopback synthetic
model and disposable Office state. It covers scheduling with no browser attached,
same-conversation output, management retry deduplication, manual execution,
persistence and deletion without touching real accounts or native App state.
