# Codex commands and references

Type `/` in an Office chat to browse commands. Choose an entry with a click,
Enter, or Tab; Escape closes the menu. Commands invoke explicit operations and
are never submitted as slash-command text to the model.

| Command | Behavior |
| --- | --- |
| `/compact` | Request native context compaction while this chat is idle |
| `/status` | Inspect this Office chat, model, permissions, and context usage |
| `/model` | Open the existing model and reasoning controls |
| `/permissions` | Open permission controls, retaining Full access confirmation |
| `/new [name]` | Create a fresh Office chat in the same project or working folder |
| `/fork [name]` | Use native history branching to create another Office chat |
| `/rename <name>` | Rename this Office chat and its existing Codex thread |
| `/agents`, `/resume` | Browse and open other Office workers/chats |
| `/mention` | Search attached workspace folders for a file reference |
| `/skills`, `/apps` | Browse the runtime's skills or apps |
| `/mcp` | Inspect configured MCP server status and tool counts |
| `/help` | Open the supported command menu |

Type `@` to select a reference. The picker has Workers / chats, Files, Skills,
and Apps categories. `$` opens skills directly. Selected references appear as
removable chips and remain with an unsent draft. File searches use attached
project folders and reject symlinks escaping those folders. Skill and app choices
come from Codex discovery; disabled skills and non-callable apps cannot be used.
Office does not import desktop App plugins or connection credentials.

## Official integration and limits

The implementation uses the documented [Codex App Server protocol](https://learn.chatgpt.com/docs/app-server)
and is validated against the pinned `@openai/codex@0.166.0`. The interface and
dynamic-tool extension are experimental, so upgrades require compatibility checks.
The [official CLI command reference](https://learn.chatgpt.com/docs/developer-commands)
describes the corresponding user-facing actions. This is an Office composer,
not an embedded copy of the desktop or terminal UI.

Compaction calls `thread/compact/start`. Forking uses `thread/fork`. File search
uses `fuzzyFileSearch`; skills use `skills/list` plus structured `skill` input;
apps use `app/list`, `app/installed`, and structured `mention` input. Office
retains its ordinary textarea and native text/paste behavior.

An isolated test of the unmodified CLI confirms that task references use
`thread://` links and client-provided dynamic tools. Office registers its own
`office.list_threads` and `office.read_thread` using public `dynamicTools` and
answers `item/tool/call` through public history RPC. It does not impersonate
`codex_tui` tools, copy desktop state, or inject another chat's transcript into
every user message. A reference lets the current worker read context; it does
not send a message or start work in the referenced conversation.

**Existing-chat limit:** this CLI version accepts dynamic tools on `thread/start`,
but not on `thread/resume`. New Office chats get these tools, which persist
through restart and native forks. Older chats without them remain valid targets
for references, but cannot use the chat-reading picker themselves. Start a new
chat with `/new` to reference an older worker. Existing histories and identities
are preserved; no private database migration is performed.

## Validation

Install the locked dependencies including developer tools with
`npm ci --include=dev`. Focused UI and backend tests cover command dispatch,
reference scope, disabled capabilities, draft preservation, and native input.
`scripts/check-office-codex.mjs` additionally exercises the actual pinned Codex
engine against a loopback synthetic model: chat reads, restart, fork, and native
compaction. These fixtures create and clean up their own state and use no native
App home or paid model endpoint.
