# Codex session workspace

The session header opens a workspace beside the chat. On narrow screens it takes
the chat's place until closed; the conversation and its draft remain mounted.
Clicking a chat attachment opens the same preview in this workspace.

The existing authenticated Gateway connection carries workspace requests and
terminal events. The Office-owned `CodexOfficeClient` serves the selected Office
session through its independent Codex process:

- `fs/readDirectory` and `fs/readFile` supply the project file view.
- `command/exec`, `command/exec/write`, `command/exec/resize`, and
  `command/exec/terminate` supply an interactive PTY using the session's sandbox
  policy. xterm.js and its fit addon render the terminal.
- Existing signed asset references and `SessionAssetPreview` render images,
  Markdown, and HTML. Plain code/text files have a read-only preview.
- The Browser tab retains a legacy desktop link. It does not provide an embedded
  browser or synchronize Office sessions with native App conversations.

This does not embed Codex's desktop UI or attach to terminal tabs created by
another client. A manual terminal is opened explicitly for the selected chat's
project directory. Closing the sidebar or reconnecting the browser keeps that
process; Close terminal stops it. Restarting the Gateway ends its manual PTYs
and the Office-owned Codex process.

Terminal output is pushed only to subscribed views, coalesced over 30 ms, with
64 KiB of recent output retained for reconnect. Slow clients reconnect to a
snapshot. Input is ordered per PTY; an uncertain write is not replayed. Files
remain within the selected canonical project folder, including symlink checks. Directory
views show at most 300 entries; plain text previews are limited to 256 KiB.
Supported assets retain their existing preview limits.

The feature uses Office's existing Codex process and does not start an inference
turn. See [Office-owned state and validation](office-owned-state.md) and the
official [app-server protocol](https://learn.chatgpt.com/docs/app-server).
