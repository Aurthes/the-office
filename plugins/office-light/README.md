# The Office — Light

An optional desktop plugin: a small 3D office with role shortcuts to native
Codex chats. The standalone Office application is not changed or required.

## What this version does

- Add a role with a name, color and existing local Codex chat link.
- Click its duck, nameplate or crew-list entry to open that native chat.
- Edit or remove the Office shortcut. The native chat is kept.
- Save role shortcuts across restarts. Reload Office to see edits from another
  plugin view.

Chatting, models, attachments and any other available native chat controls stay
in the native App. This plugin does not copy conversations, discover history,
manage native projects, create chats, poll native status or start a Codex backend.
There are no hooks, account tokens, model API keys, or remote UI assets.
The scene reuses the repository's existing duck model and renders on demand.

## Build and install

Requirements: Node.js 20+ and npm on the desktop. The host must support local
Agent Plugins and MCP Apps. This package targets the desktop surface; mobile
host support has not been established.

From the repository root:

    npm --prefix plugins/office-light ci --ignore-scripts
    npm --prefix plugins/office-light run build

No root-app dependencies, Next.js build, gateway or Office server are needed.
The build creates a self-contained installable package at
build/office-light/plugin. It contains the portable plugin manifest, stdio MCP
server, UI, and license notices. Node must be available on the host's launch PATH.
If the host cannot launch Node, report the installation problem; do not change
the native App's launcher, environment, cache or database to make it work.

The repo marketplace is .agents/plugins/marketplace.json. Use the normal plugin
directory to install “The Office — Light” from that local source, or open the
documented local-plugin link below after replacing the absolute path:

    codex://plugins/the-office-light?marketplacePath=<URL-encoded-absolute-path-to-marketplace.json>

The official CLI can also install it on the desktop computer, including when
that computer is being operated remotely. After building, run from the repo:

    codex plugin marketplace add .
    codex plugin add the-office-light@the-office-local
    codex plugin list --marketplace the-office-local --json

These commands register the local marketplace and install/enable the package
through normal plugin management. They do not require clicking the App UI.
Do not treat an unavailable UI-automation or mobile install link as proof that
installation requires the user to be physically at the computer. Confirm the
installed/enabled state using the final list command. Installation does not
establish mobile panel support or prove that an already-running chat has
refreshed its tool set; verify those separately without replacing the backend.

Mention the installed plugin and ask “Open The Office”, or open its global
sidebar entry. It can also be opened beside a conversation.

## Add your first role

1. Open an existing local Codex chat.
2. Use “Copy chat deep link” (macOS: Command + Option + L).
3. Open The Office, choose Add role, name it and paste that link.
4. Click the character to return to the chat.

Only canonical local links of the form codex://threads/<technical-chat-UUID>
are supported. Remote-host, web, new-chat and project URLs are intentionally not
accepted. Office role names are labels; they do not change the chat's name,
instructions, model, permissions or agent behavior.

## Data and removal

The plugin's only persistent data is one JSON file per Office role:

    $XDG_DATA_HOME/the-office/light-plugin/roles/

When XDG_DATA_HOME is unset, the base is ~/.local/share. This directory is
separate from both the native App and the existing Office runtime.
OFFICE_LIGHT_DATA_DIR can select a separate plugin-data base for tests.
Only name, color, chat URL, role ID and creation timestamp are stored.

Remove the plugin through the normal native plugin UI. Role metadata is retained
so that reinstalling can recover shortcuts; no native chat is removed.
The plugin does not edit native configuration during installation or removal.
The host may retain its own plugin preferences.

## Validation

From this directory:

    npm test
    npm run build
    npm run check

Or run npm run validate to execute this batch with one consistent Node runtime.

The checks use temporary role directories and the real MCP stdio transport.
An optional Codex CLI loader check runs entirely in a disposable home, starts
only an ephemeral validation thread, makes no model calls, and removes its home:

    npm run check:codex

Set OFFICE_LIGHT_CODEX_BINARY to a specific CLI executable to pin its version.
Never point the test at the native App's home or reuse a running App backend.

For browser interaction testing:

    npm run preview

This loopback-only development host uses the official MCP Apps AppBridge and
the actual bundled MCP server. It stores temporary sample role data and captures
chat-link requests instead of opening them. It clearly labels itself as a
development preview; it is not native-App acceptance. Stop with Ctrl+C; its MCP
process and temporary role data are then closed/removed.

The original capability probe separately verified native panel rendering,
WebGL and chat-link navigation. A fresh installation of this MVP still needs
its own native-App acceptance; preview success does not establish it.

## Official interfaces and boundaries

- [Plugin packaging and local marketplaces](https://developers.openai.com/plugins/build/plugins)
- [Global and conversation UI entrypoints](https://developers.openai.com/plugins/build/extensions)
- [Native local-chat links](https://learn.chatgpt.com/docs/app/commands)
- [Official CLI plugin commands](https://learn.chatgpt.com/docs/developer-commands)

Live global chat-state subscription and a replacement for the native chat UI
are outside this version. Do not add private database reads or App-backend
changes as fallbacks.

The repository's MIT license and upstream attribution are preserved in the
bundle; dependency licenses are included with it.
