# Minimal Codex gateway

`server/codex-gateway-adapter.js` implements the small OpenClaw protocol v3
surface needed for Claw3D people, sessions, text chat, tool activity, and Stop.
It launches the official `codex app-server` over stdio. Codex owns execution,
conversation history, resume, tools, and context compaction. OpenClaw is not a
runtime dependency. Each person has a workspace and native Codex thread.

Tested with Codex `0.165.0-alpha.1.2` and Node `24.22.1`. Use the matching CLI's
exported app-server schema when changing the adapter. The OpenClaw protocol
reference is `f0401d55f085c921883a982512605ec8add8833b`, specifically
`packages/gateway-protocol/src/schema/{frames,logs-chat}.ts` (MIT).

## Configuration

- `CLAW3D_CODEX_BIN`: Codex executable; defaults to `codex` on PATH. Its existing
  account login is used. No API key is required for a ChatGPT account login.
- `CLAW3D_DATA_DIR`: adapter state, default `~/.local/share/claw3d`.
- `CODEX_ADAPTER_PORT`: loopback gateway port, default `18790`.
- `CLAW3D_GATEWAY_TOKEN`: required random shared secret, kept on the Studio host.
- `CLAW3D_CODEX_GATEWAY=1`: Studio uses its configured upstream token even when
  a secure browser sends an OpenClaw device signature. This adapter uses the
  host token; it does not implement OpenClaw device pairing.

After `npm ci` and `npm run build`, run the adapter with these settings. Run
Studio separately with `HOST=127.0.0.1`, a chosen `PORT`,
`UPSTREAM_ALLOWLIST=127.0.0.1,localhost`, and `CLAW3D_CODEX_GATEWAY=1`.
Set `OPENCLAW_STATE_DIR` to a dedicated Studio state directory. Its
`claw3d/settings.json` must contain the following gateway configuration with
the same generated secret as the adapter:

```json
{"gateway":{"url":"ws://127.0.0.1:18790","token":"REPLACE_WITH_GENERATED_SECRET","adapterType":"openclaw"}}
```

Start the adapter with `node server/codex-gateway-adapter.js`, and Studio with
`node server/index.js`. The browser can use the OpenClaw connection profile;
this names the wire protocol, while the executing harness is Codex.

Expose Studio through an authenticated HTTPS entry. Keep both local ports on
loopback. Studio rejects browser requests whose Origin differs from Host.

## Scope and checks

Native Codex workspace-write and approvalPolicy=never are explicit. Text tasks,
new people, model selection, history, reset, and cancellation are supported.
AGENTS.md is the supported workspace instruction file. OpenClaw configuration
editing, device pairing, skills marketplace, voice, attachments, and automation
are outside this adapter. Unsupported calls return an explicit error.

The adapter stores only people, thread mappings, settings, and the latest 100
request IDs. A repeated request ID is rejected instead of running a task again.
It does not retry interrupted or uncertain native execution.

`CLAW3D_LIVE_TEST=1 npx vitest run tests/unit/codexGatewayLive.test.ts` exercises
the actual secure browser client and office hydration against Studio on 3033
and the local adapter on 18790, without sending the browser a gateway token.
Native execution, Stop, and resume should also be checked with a disposable
workspace before exposing a changed adapter.
