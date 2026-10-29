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

The access gateway binds only `127.0.0.1:3035`. `CLAW3D_ACCESS_PORT` can change
that port. Route the HTTPS tunnel to this port, rather than directly to the
office. The HTTPS proxy must set `X-Forwarded-Proto: https`; only loopback proxy
hops are trusted. Production cookies are always Secure, HttpOnly, SameSite=Lax
and host-bound. There is no HTTP Basic Authentication prompt.

The gateway creates a private signing key and SQLite session store in the same
private directory. Authenticated sessions last seven days and survive gateway
restarts. Login rotates the session ID; CSRF tokens protect login/logout. Logout
deletes the server-side session and closes its WebSocket connections. Access
credentials and session cookies are consumed by the gateway and not forwarded
to the office.

An office page can load `/auth/ui.js` and provide a button with `data-logout` to
offer logout. The same script provides the login page's show-password control.

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
