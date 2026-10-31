# Office-owned projects, sessions, and chat capabilities

Decision recorded on 2026-10-31: Office projects and sessions are independent of
the native Codex/ChatGPT App. Reuse the documented Codex agent engine, not the
App's project catalog, session store, running conversations, or private services.

This supersedes the limited shared-session direction considered in the
[interoperability audit](codex-interop-audit.md). That audit remains evidence of
what was tested, not a requirement to ship every operation that happened to work.

## Ownership boundary

- Office owns its project records, session records, and runtime state. Its Codex
  process needs a separate Office-owned Codex home; sharing the native App's home
  is not the new architecture.
- Do not list, import, mirror, rename, archive, resume, queue messages into, or
  otherwise manage native App sessions/projects as an Office feature. This
  includes read-only private-database adapters.
- Do not modify App startup, global environment, configuration, authentication
  storage, private databases/caches, or backend ownership. Never impersonate the
  App's client or tool identities.
- Authentication must use a documented flow for Office's own runtime. The same
  account can be used where supported; App tokens and private services are not
  integration shortcuts. Access and billing for separate APIs need verification.
- A filesystem directory can be independently selected in both products. That
  shares files, not project identity, conversation history, or execution ownership.

The official [Codex platform overview](https://developers.openai.com/blog/codex-as-a-platform)
describes applications owning their interface and business context while using
the open agent harness. This is the intended layer of reuse.

## Chat feature map

“Available interface” below is not “already migrated and accepted in Office.”
The [App Server reference](https://learn.chatgpt.com/docs/app-server) is the
published integration surface. Installed `0.166.0-alpha.5.1` default and
experimental schemas were inspected separately. The app-server command as a whole
is still labeled Experimental in the [CLI reference](https://learn.chatgpt.com/docs/developer-commands).
Default-schema membership is not a Stable product-maturity label.

| Feature | Documented capability / current evidence | Office work and limits |
| --- | --- | --- |
| Text chat, streamed answers, tool progress, stop, steer | Published thread/turn/event APIs for a server Office owns | Wire Office's own session lifecycle and UI. The minimal standalone adapter already has text/stream/stop, not the full feature set |
| Model and reasoning-effort selectors | `model/list`; `turn/start` can set model/effort for that and subsequent turns | Use the returned account/client catalog. Apply changes to the next turn; do not promise every App model or arbitrary mid-turn changes |
| Access controls and approvals | Public approval-policy and sandbox-policy fields; documented command/file approval requests | Keep settings within Office sessions. Provide the Office UI and approval responses; native App settings are not modified |
| Context-use indicator | `thread/tokenUsage/updated`; installed schema includes per-turn/cumulative usage and nullable model context window | Display reported usage; unknown window remains unknown. Cumulative billing tokens are not remaining context capacity, and this is not a complete hidden-prompt inspector |
| Image attachments | Published `image` / `localImage` turn inputs | Office manages uploads, accessible host paths, thumbnails and model modality checks |
| Text/code and other file attachments | Codex can use its allowed workspace tools; the existing uploader references non-image files by path | Upload is not document understanding. PDF/Word/Excel parsing, preview and editing depend on available tools/converters; no blanket native-format parity |
| Dictation: speech to draft text | Public speech-to-text API exists | Office owns recording, transcription, cancellation/retry and keyboard/mobile interaction. The private native dictation stream is retired as an integration path |
| Live voice conversation | Public Realtime API exists; native Codex thread-realtime methods are experimental in the installed schema | A separate voice integration needs explicit task/tool/approval/transcript routing to Office's Codex session. A Realtime connection alone does not provide that integration |
| Grey suggested prompts / predictions | Existing path uses a private config endpoint plus experimental `thread/sample`; no stable native-equivalent interface was established | An Office suggestion feature can be designed using documented model calls. It is a separate feature, not automatic native prediction reuse |
| Skills, MCP tools and App-specific capabilities | Codex has documented extension mechanisms | Configure tools explicitly for Office. App-only connectors, document panels, browser bridges and private tool registrations are not inherited |

The public [speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text)
and [Realtime guide](https://developers.openai.com/api/docs/guides/realtime)
provide supported routes for separately built voice features. This review did not
validate their account access, billing, Office implementation, or end-to-end UX.
It did not fix the earlier mobile dictation failure.

## Existing implementation that must not be carried over unchanged

| Component | Migration implication |
| --- | --- |
| `server/codex-session-index.js`, native project mapping and App-store watchers | Retire from the independent-state path; no private native catalog scanning or synchronization |
| Existing-App session gateway and shared-owner launch/setup paths | Legacy implementation, not the new runtime or an installation recommendation |
| `server/codex-gateway-adapter.js` | Existing own-thread prototype; it does not yet enforce the complete ownership boundary and currently rejects attachments |
| `server/codex-session-settings.js` and controls | Model/permission UI concepts are reusable, but the current `thread/settings/update` call is experimental; public next-turn overrides provide the core feature |
| `server/codex-session-uploads.js` | Generic Office upload handling can be reused with Office-owned thread IDs/storage and permission checks; non-images are paths, not a universal document API |
| `server/codex-dictation.js` | Replace private ChatGPT dictation/token access if dictation is implemented |
| `server/codex-session-voice.js` | Native realtime methods are experimental; do not advertise production parity from their existence |
| `server/codex-composer-predictions.js` | Do not retain the private prediction-config request or App tool identity assumptions |

## Current status and next implementation boundary

This change records the product decision and capability assessment. It does not
switch a running deployment, migrate old data, implement new speech services, or
claim that every existing composer button works with an independent backend.
The existing native-session deployment remains legacy until deliberately replaced.

The next implementation must first establish Office-owned state/authentication
and demonstrate a new Office session, send/stream/stop, restart/resume, and absence
of native-App state access. Then validate each additional chat feature on that
runtime. Missing features stay unavailable rather than enabling private or
experimental native-App paths to fill the gap.
