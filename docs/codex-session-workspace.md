# Codex session workspace

The session header opens a workspace beside the chat. On narrow screens it takes
the chat's place until closed; the conversation and its draft remain mounted.
Clicking a chat attachment opens the same preview in this workspace.

The existing authenticated Gateway connection carries workspace requests and
terminal events. `CodexSharedClient` reuses the current Codex owner:

- `fs/readDirectory` and `fs/readFile` supply the project file view.
- `process/spawn`, `process/writeStdin`, `process/resizePty`, and `process/kill`
  supply an interactive PTY. xterm.js and its fit addon render the terminal.
- Existing signed asset references and `SessionAssetPreview` render images,
  Markdown, and HTML. Plain code/text files have a read-only preview.
- The Browser tab uses the existing desktop chat link. Open the browser tabs in
  Codex to retain their pages and sign-ins.

This does not embed Codex's desktop UI or attach to terminal tabs created by
another client. A manual terminal is opened explicitly for the selected chat's
project directory. Closing the sidebar or reconnecting the browser keeps that
process; Close terminal stops it. Restarting the Gateway ends its manual PTYs,
without interrupting agent turns owned by the original Codex app.

Terminal output is pushed only to subscribed views, coalesced over 30 ms, with
64 KiB of recent output retained for reconnect. Slow clients reconnect to a
snapshot. Input is ordered per PTY; an uncertain write is not replayed. Files
remain within the canonical project root, including symlink checks. Directory
views show at most 300 entries; plain text previews are limited to 256 KiB.
Supported assets retain their existing preview limits.

The feature requires the shared Codex owner and its experimental `process/*`
API. It does not start another Codex runtime or inference turn. See the official
[app-server protocol](https://learn.chatgpt.com/docs/app-server).
