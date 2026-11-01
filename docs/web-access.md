# Web login for a local office

`server/web-access/index.js` is an optional loopback gateway with a normal login
page. It protects the office, API and WebSocket with the same session. It can
sit behind an HTTPS tunnel and works with the demo or the full Studio server.

Requires Node 24 with `node:sqlite`. Start the office on `127.0.0.1:3033` and
create a private directory outside the source repository. Put `credentials.json`
there with a `username` and a unique `password` of at least 12 characters. Keep
the directory mode 700 and the credentials file mode 600.

```sh
CLAW3D_ACCESS_DIR=/absolute/private/directory node server/web-access/index.js
```

Before starting, set `CLAW3D_PROXY_TOKEN` to the same random secret of at least
32 characters on **both Studio and the web-access service**. Set
`CLAW3D_PUBLIC_ORIGINS` on both to the exact comma-separated HTTPS origins used
by your public URLs, for example `https://office.example.com`. Keep these values
in private service configuration outside Git. The gateway refuses to start with
these settings missing. Studio requires them when
`NEXT_PUBLIC_CLAW3D_WEB_ACCESS=1`, and also enables backend authentication whenever
the proxy token is configured. Keep that flag set at runtime as well as build time.

The proxy consumes browser credentials and replaces any client-supplied
`X-Office-Proxy-Token` header with its own secret, after session authentication.
Studio checks that credential for every HTTP request and WebSocket upgrade,
including local health checks. Untrusted Host/Origin combinations are rejected
even if their two values match each other. Only exact configured public origins
and correctly addressed loopback requests are accepted. Local maintenance and
readiness checks must supply the private proxy header; the redeploy controller
reads it from the selected service plist without logging it.

The access gateway binds only `127.0.0.1:3035`. `CLAW3D_ACCESS_PORT` can change
that port. Route the HTTPS tunnel to this port, rather than directly to the
office. The HTTPS proxy must set `X-Forwarded-Proto: https`; only loopback proxy
hops are trusted. Production cookies are always Secure, HttpOnly, SameSite=Lax
and host-bound. There is no HTTP Basic Authentication prompt.

HTTP GET/HEAD requests redirect to HTTPS before creating sessions. Insecure
POSTs and WebSocket upgrades are rejected. HTTPS responses send one year of
HSTS. Both tunnel hostnames must be included if you use primary and backup URLs;
update the private allowlist when a temporary tunnel address changes. Forwarded
client IP/protocol headers must be set or sanitized by the trusted HTTPS proxy.

The gateway creates a private signing key and SQLite session store in the same
private directory. Authenticated sessions last seven days and survive gateway
restarts. Login rotates the session ID; CSRF tokens protect login/logout. Logout
deletes the server-side session and closes its WebSocket connections. Access
credentials and session cookies are consumed by the gateway and not forwarded
to the office.

Failed password and second-factor attempts share a ten-attempt, one-minute
limit **per client IP**, rather than one global failure count. One abusive
client cannot spend another client's attempts. The in-memory table is bounded
to 1024 clients and password verification has at most four concurrent checks.
This limits basic abuse; a public deployment still needs appropriate edge
traffic controls for distributed denial-of-service attacks.

An office page can load `/auth/ui.js` and provide a button with `data-logout` to
offer logout. The same script provides the login page's show-password control.
For the full Studio UI, set `NEXT_PUBLIC_CLAW3D_WEB_ACCESS=1` when building and
running Studio to include the logout controls and shared client script.

Run the focused acceptance tests with:

```sh
npx vitest run tests/unit/webAccess.test.ts
```

These cover login, repeat requests, restart persistence, logout and stale-cookie
rejection, WebSocket access, CSRF, password attempt limits and HTTPS cookie flags.
Also verify the actual public URL in a browser after deployment: form submit,
refresh, logout, and a rejected logged-out WebSocket. Production cannot use
insecure cookies; the factory's `secureCookies: false` option exists only for
loopback test fixtures.
