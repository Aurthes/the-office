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
| `NEXT_PUBLIC_CLAW3D_SESSION_VIEW` | Unneeded | `1` at build time |
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
  with public `skills/extraRoots/set`. Codex performs discovery and deduplication.
- Public `config.toml` is parsed as TOML. The allowlist is `model`,
  `model_reasoning_effort`, `model_verbosity`, `personality`, `service_tier`,
  `developer_instructions`, `project_doc_max_bytes`,
  `project_doc_fallback_filenames`, `skills.max_context_tokens` and per-skill
  enablement. Office-specific settings win; model/access controls still govern
  each Office turn. Custom-provider model defaults are not imported into the
  independently authenticated OpenAI provider.
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

| Feature | Independent runtime behavior and validation |
| --- | --- |
| Projects and sessions | Office-only create, rename, reassign and archive. Empty chats survive restart. Restore/unarchive UI is not connected yet. No native App import or two-way management |
| Text and task progress | Public thread/turn APIs; streaming, saved history, continuation after process restart and interrupt tested through the gateway. Separate real-account two-turn continuation also passed |
| Models and reasoning | Account's public model catalog; validated choices persist in Office and apply to the next turn. Additional messages during a task use its current settings |
| Access and approvals | Public sandbox/approval fields; Read only, Default permissions and confirmed Full access. Command/file/question handlers reused; permission grants are limited to the requested permissions for that turn. Fixtures verify response routing; not every real approval variant has been induced |
| Context usage | Displays reported last-input tokens and nullable model context window. Real usage events received. This is not a hidden-prompt inspector or cumulative billing-token percentage |
| Images | Signed browser upload, saved image history and public image input passed with the real account and a loopback fixture. Vision answer quality was not measured |
| Other files and previews | Uploaded host paths, workspace browsing/text reads and existing supported previews. Upload is not universal PDF/Word/Excel understanding; converters/tools must be available separately |
| Workspace terminal | Public `command/exec` PTY, output, input, resize and terminate tested using the real engine; uses the session's sandbox policy |
| Dictation | Optional public file-transcription API, recording/cancel/retry/Option/Enter UI. Disabled without a server API key. Mocked tests cover request/error handling and existing recording controls; real transcription, device/browser behavior and account access remain unvalidated |
| Suggested prompts | Optional public Responses API, using recent visible messages, no tools and `store:false`. Disabled without a key. Request shape tested; quality, account access and latency not measured. Not native App prediction reuse |
| Live voice | Unavailable. Public Realtime exists, but voice-to-Codex task/tool/approval/transcript integration needs a separate design |

## Optional speech and suggestions

OpenClaw transcription and ElevenLabs reply playback have been removed. Office
keeps Codex session speech controls visible and disabled when the runtime reports
those capabilities as unavailable. There is no fallback to an OpenClaw runtime.

Configure `OPENAI_API_KEY` on the **gateway only**, then restart it. This enables
dictation and suggested prompts. Defaults are `gpt-transcribe` for
`/v1/audio/transcriptions` and `gpt-6.1-sol` for `/v1/responses`.
`CLAW3D_TRANSCRIPTION_MODEL` and `CLAW3D_SUGGESTION_MODEL` override those models.
API access, usage and billing are separate from the Codex account sign-in; no
assumption is made that a ChatGPT subscription covers these requests.

The [file-transcription guide](https://developers.openai.com/api/docs/guides/speech-to-text)
documents the speech route. The
[Responses API](https://developers.openai.com/api/docs/guides/text) supplies
suggestions. No private dictation token, prediction-config endpoint,
`thread/sample` or experimental Codex realtime method is used by this runtime.
Transcription errors keep the recording; an HTML response becomes a readable
service error rather than a JSON parse error. There is no automatic resend.

## Reproduce validation

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
