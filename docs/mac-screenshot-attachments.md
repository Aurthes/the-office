# Mac screenshots in a chat draft

The screenshot shortcut adds an image to an ordinary Office attachment draft.
It preserves the exact text, inline references and previous attachments. It never
sends a chat message. The user can add text and use the normal Send button later.

On the intended Mac Office page, open the chat and click **Use this page for Mac
screenshots**. A host has one receiving page. Replacing another page requires an
explicit second **Replace screenshot recipient** action. Normal activity in a
phone or another tab does not replace this binding. The selected conversation
must have been explicitly opened; binding can explicitly adopt the displayed
conversation. Closing chat, viewing archived message history, an offline page,
text-only edit mode or a full attachment draft prevents a new capture.

The native driver freezes the foreground application and asks the bound page to
reserve a slot before invoking the existing approved screenshot wrapper. The
reservation freezes the actual authenticated socket, page, selected conversation
and stream subscription. Switching from A to B after reservation completes the
original A placeholder, including when A is hidden. It never retargets to B.
The normal eight-attachment and 20 MiB limits apply. Cancellation or failure only
changes that screenshot's placeholder. Uploaded references use the normal
attachment store and are scoped to their original thread.

A small in-memory handoff map expires after five minutes and holds at most 64
requests. Exact request IDs and image digests prevent duplicate files/append on
retries. Per-page receipts survive ordinary socket reconnect, including removing
an image or manually sending before an acknowledgement is lost. Resume requires
an in-memory proof held only by that page. A full page reload loses the existing
in-memory drafts and binding proof; this feature does not claim reload persistence
or introduce a general draft database. A gateway restart rotates the capture key
and boot epoch; in-flight native requests fail without re-beginning or guessing a
different target. Original native captures remain user data on failures.

## Local integration and security

The existing Office Gateway port exposes only capture begin/image/status/cancel
operations. The native caller reads a separate capture-only credential from
`<Office data directory>/capture-client.json` (0700 directory, 0600 file). It
contains version, a literal loopback URL and this scoped key. It grants no chat,
MCP, account or arbitrary local-file access. Never put this key in shortcut
artifacts, URLs or logs, and never substitute a browser cookie or Gateway token.

Ingress requires a loopback peer, exact literal loopback Host and scoped key;
browser Origin and preflight requests are rejected, with no CORS permission.
The public proxy, login/MFA, CSRF and normal WebSocket authentication are unchanged.
Bytes are streamed through the original upload mechanism. No endpoint accepts a
local path or arbitrary RPC method. Pending browser acknowledgements are targeted
to the actual bound socket; product client names are not page identities.

The approved private Mac driver and Appshots wrapper remain outside the public
repository. The generic client is `scripts/office-capture-client.mjs`; the host
launcher supplies its private config/wrapper paths and approved hash. The driver
reads foreground bundle ID/PID first, verifies it again before capture, rejects
Shortcuts/setup-editor focus, and invokes the existing signed helper through its
accepted one-shot route. It does not read clipboard content, change Node's OS
permissions, simulate input, activate an application or start a daemon/new port.
Normal code editors remain valid targets. App/window selection is not an atomic
screenshot of the instant the key was pressed.

## Native shortcut setup

A one-action Automator workflow and one-line command can be prepared privately.
Validate a marker-only workflow using Apple's Automator runner first; never run
the capture artifact as a packaging test against an unrequested application.
The action contains only fixed quoted Node and private driver paths, not secrets,
chat IDs or captured data. Use the normal Open With → Shortcuts conversion/import
UI. If conversion is rejected, create a new shortcut normally, add **Run Shell
Script**, choose `/bin/sh`, no supplied input, and paste the prepared command.
Allow Running Scripts if the system requires it. Assign a free ordinary key in
**Details → Add Keyboard Shortcut**; do not edit Shortcuts/keyboard databases.

Import, security prompts and actual global-key binding are separate final OS
steps. Do not report them installed or tested merely because a workflow runs in
the runner. Settle setup prompts first, return to the owned target application,
then test the key. Final acceptance uses a synthetic app and isolated chat draft,
checks unchanged text/references/old attachment and one new image, and verifies
zero automatic sends. No real employee or user draft is used for agent tests.
