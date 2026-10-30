# Connection recovery

Claw3D keeps one browser WebSocket and uses events for live changes. Native
Codex offices refresh their project/session metadata through one `office.snapshot`
request, independent of the number of sessions. Appearance settings retain the
existing HTTP cache; an appearance-settings failure does not block the roster.
The existing server-side 30-second reconciliation remains the fallback for missed
roster events. Chat messages and approvals are never retried automatically.

## Recovery rules

- The native gateway sends a tick every 30 seconds. A visible browser considers
  90 seconds without any incoming frame a lost connection and reconnects. This
  adds no browser heartbeat requests. Background tabs defer the watchdog; returning
  to the tab allows one tick interval plus five seconds before deciding it is lost.
- Native gateway requests have a 20-second deadline. A timed-out request fails
  once and retires the connection. A write may already have succeeded: inspect
  the original session before repeating it.
- Studio appearance/connection settings HTTP reads and writes also time out after
  20 seconds, so a stalled save cannot block the next connection indefinitely.
- Browser offline/online events disconnect and reconnect immediately. Unexpected
  disconnects use the existing retry delay, capped at 30 seconds, without an
  attempt limit. Manual disconnect and permanent authentication/configuration
  failures still stop retries. Temporary upstream failures are retried.
- Late events from a replaced socket cannot change the current connection.
- The local gateway checks its shared native-owner connection with a WebSocket
  ping every 30 seconds. A missing pong by the next check closes that client.
  The gateway supervisor restarts the adapter; it never restarts the native owner.
- Legacy session snapshots are emitted only to clients that request that legacy
  subscription. Idle, unsubscribed office clients receive no repeated session data.
  Native offices do not poll per-agent OpenClaw skill triggers they cannot use.

## Reproduce browser fault tests

Run a local Studio instance against a native Codex gateway with existing sessions.
Build it with the deployment's public flags: `NEXT_PUBLIC_CLAW3D_SESSION_VIEW=1`
and, for authenticated web access, `NEXT_PUBLIC_CLAW3D_WEB_ACCESS=1`. These flags
are compiled into the browser bundle; setting them only when starting the server
does not change an existing build. Then run:

```sh
node scripts/check-network-stability.mjs \
  --url http://127.0.0.1:3000/office --channel chrome \
  --soak-seconds 1800 --report-dir /tmp/claw3d-network-report
```

The script binds a temporary loopback-only TCP proxy. It checks a metadata refresh,
five reads with 500 ms delay in each direction and a 64 KiB/s limit, browser
offline/online, replacement of the test connection, a silent traffic blackhole,
and a continuous connection. It saves a JSON report and screenshot, then closes
its browser and proxy. It does not change the machine's Wi-Fi or create sessions,
send messages, or invoke inference. Physical network changes and the public tunnel
need a separate authenticated browser test; local simulation does not prove those.

## Zero-cost public access

Keep the existing Cloudflare Quick Tunnel while there is no domain. Quick Tunnels
are free, but their hostname is temporary and they have no uptime guarantee.
A named Cloudflare tunnel with a public hostname requires a domain added to
Cloudflare; an existing free account alone does not supply that domain.
See [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
and [Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/).

Possible free alternatives require a separate choice before migration:

| Option | Main constraint |
| --- | --- |
| ngrok Free | Assigned stable development domain; 1 GB outgoing data and 20,000 HTTP requests per month; visitor interstitial. Large 3D assets consume this allowance. |
| Tailscale Funnel | A `ts.net` address; beta and bandwidth limits. The free Personal plan has noncommercial eligibility restrictions. Requires installing/configuring Tailscale. |

Verify the current [ngrok free limits](https://ngrok.com/docs/pricing-limits/free-plan-limits),
[Funnel requirements](https://tailscale.com/docs/features/tailscale-funnel), and
[Tailscale plan eligibility](https://tailscale.com/docs/account/manage-plans/free-plans-discounts)
before switching. Do not start a paid trial or enable paid resources as part of
the zero-cost setup. If a domain becomes available later, create a named tunnel
to the existing authenticated local origin, verify login and WebSocket recovery,
then switch the bookmarked URL. Keep the old tunnel until that check succeeds.
