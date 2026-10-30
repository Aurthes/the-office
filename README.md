# The Office

A self-hosted 3D office for organizing and working with your existing Codex chats.
Give each project its own work area, keep projectless chats in a shared workspace,
and click a person to return to the conversation behind them.

**Built on [Claw3D](https://github.com/iamlukethedev/Claw3D), originally created by
[Luke The Dev](https://github.com/iamlukethedev), and independently maintained by
[Aurthes](https://github.com/Aurthes).** The Office extends that codebase; it is not
an official Claw3D or OpenAI product. The original copyright and MIT license are
preserved in [LICENSE](LICENSE).

## What this version adds

- **Existing Codex chats as people.** The original thread IDs, project membership
  and working directories stay attached to their conversations.
- **Project work areas and shared space.** Projectless chats live in Open Workspace;
  idle characters can roam the shared office.
- **Conversation-first chat.** Paginated history, live replies, Markdown, distinct
  message roles and collapsed work/tool activity keep long chats readable.
- **Shared execution.** Opt-in access to the same native Codex execution owner for
  continuation, steering, stopping and supported approvals.
- **Attachments and previews.** Upload files, paste images and view supported
  images, Markdown and sandboxed HTML reports in the conversation.
- **Dictation and voice.** Browser dictation and the version-pinned native Codex
  realtime voice transport, subject to browser and account support.
- **Authenticated web access.** A separate login gateway supports password setup,
  TOTP authenticators, recovery codes and persistent login sessions.
- **Shared scene collisions.** Rendered solids and people use common collision
  geometry for navigation, movement and interaction positions.

Claw3D's OpenClaw, Hermes, custom-runtime and demo integrations remain available.
The Codex adapters do not require installing the OpenClaw runtime.

## Try the local demo

Use Node.js 24 (tested with 24.22.1) and npm. Clone this repository:

```sh
git clone https://github.com/Aurthes/the-office.git
cd the-office
npm ci
cp .env.example .env
```

Start the demo gateway in one terminal:

```sh
npm run demo-gateway
```

Start Studio in another terminal:

```sh
npm run dev
```

Open `http://localhost:3000`, select the **Demo** backend and connect to
`ws://localhost:18789`. Demo people are simulated; they do not run Codex tasks.

## Connect Codex

There are two distinct modes:

| Mode | Purpose | Setup |
| --- | --- | --- |
| Existing App sessions | Organize existing local conversations; optionally share their native execution owner | [Existing session view](docs/codex-session-view.md) |
| Standalone Codex gateway | Create people backed by new native Codex threads | [Minimal Codex gateway](docs/codex-gateway.md) |

For existing chats, build Studio with `NEXT_PUBLIC_CLAW3D_SESSION_VIEW=1` and use
`server/codex-session-gateway.js`. The session view starts read-only. Shared writes
require the documented shared-owner setup and preflight; this is not a one-command
installer. It must not start a second executor against an existing conversation.

The integration is currently pinned to Codex `0.165.0-alpha.1.2`. Local App index
formats and the shared/realtime transports are version-dependent. Check
compatibility before upgrading. Normal cloud ChatGPT chats and remote-host chats
are outside the local session index. Some structured requests still need the App;
this project does not claim complete native UI parity.

### Use the office

1. Select the whole company or a project from the work-area selector.
2. Click a person to open their original conversation.
3. Scroll upward to load older history a page at a time.
4. With shared execution enabled, send messages and attachments, dictate a draft,
   or start a supported voice conversation from the composer.

Character movement is a visualization, not an additional agent or evidence that a
model is running a task.

## Remote access

Keep Studio and the Codex gateway on loopback. Put the authenticated web-access
service in front of them and point your HTTPS tunnel at that service.

- [Web login and proxy setup](docs/web-access.md)
- [Password setup, TOTP enrollment and recovery](docs/web-access-2fa.md)
- [Security policy and deployment boundaries](SECURITY.md)

`NEXT_PUBLIC_CLAW3D_WEB_ACCESS=1` adds the shared login/logout UI when building
Studio. Secrets, authentication databases, uploads and chat state belong outside
the source checkout. Publishing this repository does not publish a running office
or its conversations.

## Development

```sh
npm run typecheck
npm test -- --run tests/unit/collision.test.ts tests/unit/workstations.test.ts
npm run build
```

Other focused acceptance commands live beside their setup documentation. The
inherited codebase has existing lint findings; a full `npm run lint` is not
currently a clean gate. Dependencies are pinned in `package-lock.json`.

Docker publication is manual through the GitHub Actions workflow and targets
`ghcr.io/<your-account>/the-office`. The inherited image remains a generic Studio
image; the local App/shared-owner integration requires a compatible host setup.

## Repository and upstream

- **Our stable branch:** `Aurthes/the-office:main`.
- **Original project:** `iamlukethedev/Claw3D`, treated as read-only upstream.
- **Initial upstream base:** `0565b7892909eca7bbc8f2d9b0fad171dd75ad7c`.

To inspect upstream changes from a fresh clone:

```sh
git remote add upstream https://github.com/iamlukethedev/Claw3D.git
git remote set-url --push upstream no_push://read-only-upstream
git fetch upstream
```

Our `main` and upstream's `main` are separate refs in separate repositories.
Develop changes on a topic branch and merge validated changes into our `main`.

## License and credits

The Office code is distributed under the **MIT license**, retaining Claw3D's
original notice and adding attribution for our modifications. See [LICENSE](LICENSE).

Bundled third-party code and assets retain their own terms. Furniture assets use
Kenney's CC0 license; the bundled environment map is Greg Zaal's *Potsdamer Platz*
from Poly Haven, also CC0. The adapted OpenClaw browser client retains its MIT
notice. Full provenance and included notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Claw3D, OpenClaw, Codex and other product names identify their respective projects;
they do not imply endorsement of The Office.
