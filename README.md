# The Office

A self-hosted 3D workspace for Codex-backed work. The selected architecture gives
Office its own projects and sessions, using the documented Codex agent engine
while preserving normal operation of the native Codex/ChatGPT App.

The Codex backend uses independent Office state. The old native App-session
adapters and standalone gateway prototype have been removed. See
[ownership and chat-feature scope](docs/office-owned-state.md).

**Built on [Claw3D](https://github.com/iamlukethedev/Claw3D), originally created by
[Luke The Dev](https://github.com/iamlukethedev), and independently maintained by
[Aurthes](https://github.com/Aurthes).** The Office extends that codebase; it is not
an official Claw3D or OpenAI product. The original copyright and MIT license are
preserved in [LICENSE](LICENSE).

## What this version adds

- **Conversations as people.** Each person represents a conversation. The target
  architecture uses Office-owned records, without native App session discovery or synchronization.
- **Project work areas and shared space.** Projectless chats live in Open Workspace;
  idle characters can roam the shared office.
- **Conversation-first chat.** Paginated history, direct push-streamed replies, Markdown, distinct
  message roles and collapsed work/tool activity keep long chats readable.
- **Codex execution.** Office runs its own Codex process and data directory,
  with its own projects, sessions, login, model choices and access controls.
- **Attachments and previews.** Upload files, paste images and view supported
  images, Markdown and sandboxed HTML reports in the conversation.
- **Optional dictation and suggestions.** Public OpenAI API adapters are wired;
  they require a server API key and separate account/quality validation. Live
  voice is unavailable in the independent runtime.
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

Use the independent backend for new Office work:

`npm ci` includes Office's own pinned official Codex CLI. On startup, Office
automatically discovers your public Codex rules, standalone skills and selected
ordinary defaults. Existing Office-specific settings take priority. First-time
account authorization is still separate; App credentials, conversations,
databases and App-specific integrations are not imported. See
[automatic configuration discovery](docs/office-owned-state.md#automatic-configuration-discovery)
for the supported scope and platform requirements.

Start the Office-owned runtime with `npm run codex-gateway`. It has a separate
process, login, projects and sessions. See [setup and tested features](docs/office-owned-state.md).
The [interoperability audit](docs/codex-interop-audit.md) records the earlier research.

Office does not import native App projects, sessions or credentials. The
[feature map](docs/office-owned-state.md#chat-feature-map) distinguishes tested
engine behavior from optional services and features that remain unavailable.

### Use the office

1. Select the whole company or a project from the work-area selector.
2. Click a person to open their conversation.
3. Scroll upward to load older history a page at a time.
4. Use the composer features supported by the selected backend. The demo uses
   simulated people; optional services stay disabled until configured.

Character movement is a visualization, not an additional agent or evidence that a
model is running a task.

The main deck's AI Center replaces the former inner-ring server room. Click its
floating computation core, select the area, or use the brain icon in the toolbar
to see the signed-in Office Codex account's plan, quota windows, reset times,
additional credits, and token activity. Data comes from the [documented Codex interfaces](https://learn.chatgpt.com/docs/app-server)
`account/read`, `account/rateLimits/read`, and `account/usage/read` interfaces;
unsupported or unavailable values stay unknown. Subscription percentages are
not converted to token budgets. The panel refreshes every minute while visible.

Optional OpenAI API quotas use a separate organization administrator credential.
Set `OPENAI_ADMIN_KEY` and `OPENAI_PROJECT_ID` **on the Codex gateway service** to
read that project's model rate limits. The key stays in the gateway and is not
passed to the browser or Codex child process. Without these settings the panel
offers links to OpenAI's limits and billing pages. It does not infer prepaid
balances, spending limits, or ChatGPT web-message quotas from token counts.

The spaceship uses one available reserve cabin as a monitor room. Its main screen
opens a console of illustrated dashboard shortcuts. Configure their names, URLs,
and illustrations in the console; settings are saved with the local Studio state
and shared across devices. `CLAW3D_GRAFANA_URL` supplies the initial Grafana link
at runtime; the existing build-time `NEXT_PUBLIC_CLAW3D_GRAFANA_URL` also works.
Each shortcut opens its own reusable browser tab with the dashboard's normal
login. Repeat clicks preserve its page for five minutes after the last click;
after a longer gap, the next click reloads its configured URL. Studio never closes
those tabs, copies Grafana charts, or requires Grafana embedding changes.

The built-in fleet dashboard is opt-in: set `CLAW3D_SERVER_POOL_FILE` to a local
registry containing `alias|class|params|notes` rows. Classes `online` (production)
and `offline` (research/compute) describe purpose, separately from reachability.
`active=no` entries remain visible without being probed. Aliases must already
exist in SSH config with trusted host keys and noninteractive authentication.
Studio takes read-only, one-second Linux samples over reused SSH transports,
with at most four simultaneous probes and a shared 30-second cache. It installs
nothing remotely. Probes run on demand while a visible fleet dashboard is open;
failures retain clearly marked stale samples. Disks show local mounted filesystems
only, led by the fullest partition. Credentials, registry notes, IP addresses,
and SSH configuration are never returned by the monitoring APIs.

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

## Interface language

English is the default. Open **Settings → Language** to switch between English
and Simplified Chinese. The choice takes effect immediately and is saved in the
current browser. It changes interface labels and hints only; project names,
agent/session names, questions, and conversation content stay as written.

For UI changes, keep English labels in code and render them through
`src/lib/i18n/ui-language.ts`; keep user content outside the translator.

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
`ghcr.io/<your-account>/the-office`. The image starts Studio; deploy the Office
gateway as a separate service. Dependencies include the pinned CLI, but the
complete independent-backend Docker deployment has not been validated.

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
The Dockerfile also copies these notices and license files into the runtime image.

Claw3D, OpenClaw, Codex and other product names identify their respective projects;
they do not imply endorsement of The Office.
