# Self-hosted operations

Configuration and integrations for your own Office. For a no-account preview,
use the [interactive demo](https://aurthes.github.io/the-office/) or return to the
[quick start](../README.md#quick-start).

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

AI Center uses a provider-neutral usage format and UI. Only the OpenAI reader
(`server/ai-center-openai.js`) is implemented today; future readers supply provider
names, account labels, links, and any number of quota windows in the same format.

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

Local dashboards can use a same-origin shortcut such as `/account-history/`,
so the link follows the Office host on every device. To connect a separately
running read-only account-history viewer, set
`CLAW3D_ACCOUNT_MONITOR_URL=http://127.0.0.1:8766` and restart Studio. Add
`/account-history/` as a monitor URL in the console. Studio forwards only the
viewer's page, script, latest snapshot and curve reads, behind the existing
Office access controls. It sends no login cookies or authorization headers to
the viewer. Collection, local JSONL retention and public-query scheduling remain
the responsibility of the collector; opening or refreshing the page only reads
its files. No database or charting service is needed.

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

On macOS, the fleet also includes **Local Mac** in its own local-machine group,
even without a remote registry. It reads host CPU counters and bounded native
`vm_stat`, `netstat`, and local-only `df` output directly, with the same shared
30-second refresh. No SSH service or extra pool registration is needed locally.
Memory usage excludes free, inactive, and speculative pages. Network rates use
physical `en*` link-layer counters, excluding duplicate IP, loopback, bridge, and
VPN rows. Missing measurements stay unknown. The local entry does not change
the machine's eligibility for remote build or deployment scheduling.

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

