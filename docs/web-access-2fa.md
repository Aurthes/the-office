# Web access with Google Authenticator

The existing single-user form login can require a second factor without changing
the Codex account, model, sandbox or native execution owner. This is standard
TOTP, not Google account sign-in. Codes and enrollment QR images are generated
locally using the exact dependencies pinned in package-lock.json.

Set `CLAW3D_REQUIRE_TOTP=1` on the **web-access service** and restart that service.
Do not restart Studio, the tunnel, or the desktop App for this change. Keep the
same private credential directory, username, password and session-signing secret.
Until enrollment completes, the office and its HTTP/WebSocket APIs remain locked,
including for old password-only sessions.

1. Open `/login` and enter the existing username and password.
2. Add the account in Google Authenticator by scanning the QR code. On the same
   phone, expand manual setup and copy the setup key into a time-based account.
3. Enter a real six-digit code to confirm the binding. Only this step activates
   the second factor; showing a QR code alone does not activate it.
4. Save the eight recovery codes shown after confirmation. Each works once with
   the existing password. The full list is not stored for later redisplay.

Password verification creates only a ten-minute enrollment session. It cannot
read office data or connect its gateway. Enabling TOTP rotates the authenticated
session and invalidates earlier sessions through a new MFA version. Previously
open proxy sockets are closed. Subsequent logins require password plus a TOTP or
unused recovery code. The verified login then lasts seven days as before; page
refresh does not prompt for another code.

The server accepts a 30-second step with one step of clock tolerance in either
direction. Accepted time counters are persisted and cannot be replayed, including
after a service restart. Recovery codes are stored only as hashes and consumed
before granting access. Password and second-factor failures share the existing
ten-attempts-per-minute limiter. CSRF and same-origin checks cover binding and
login; gateway upgrades require both a valid session and a matching Origin.

`totp.json` contains the necessary TOTP secret and replay counter; it is private
to the local account (mode 600, inside the private credential directory). A
`totp-required` marker prevents password-only fallback if the activated state is
missing. Corrupt state fails closed. Keep these files, setup keys, QR images,
credentials, session databases and recovery codes out of Git and chat messages.

## Recovery and rollback

Use an unused recovery code first. There is no remote API for disabling or
replacing the second factor. If both the phone and recovery codes are lost, the
local machine owner can stop the web-access service, move `totp.json` and
`totp-required` into an owner-only backup directory, and restart the service with
`CLAW3D_REQUIRE_TOTP=1`. This requires fresh enrollment before access is granted.
Do not copy/delete Codex session databases or change the Codex account.

Before deploying, back up the old web-access service definition and pin the source
commit for rollback. Returning to the old password-only source removes the second
factor and should be a deliberate local-owner decision, not an automatic error
fallback. Enabling MFA is not a complete security audit: authenticated cookies can
still be stolen, and an authenticated remote executor retains its native powers.
