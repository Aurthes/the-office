# Account order-capacity monitor

Open **Control room → Order capacity**, or `/rate-limit-capacity/`. This is a
read-only Studio feature. It does not change the gateway, strategies, limits,
orders, or notification delivery. The built-in shortcut does not edit saved
monitor links. No exchange credentials or Redis URLs reach the browser.

Accounts have independent Spot/Perp cells with a state, capacity-evidence update
time, and heartbeat update time. Missing markets are unmonitored, not healthy.
Details show the observed cap, documented normal baseline, and remaining reset
wait. A remaining wait is not labelled as the complete quota window.

Both heartbeat and conclusive capacity evidence must be younger than 30 seconds
to display normal. Missing/unknown schema, contradictory fields, missing evidence,
and unexpected future timestamps cannot display green. Read failures retain
context but mark it unverified. A different process's normal record cannot hide
a current or unresolved low record for the same account/market.

The browser refreshes every five seconds while the panel is visible. It also
re-evaluates age every second using elapsed monotonic browser time relative to
the API's server clock. A stalled request cannot freeze a normal status, and
closing the panel aborts the read and stops polling. Historical low/normal labels
on expired records are explicitly last-confirmed information, not current state.

## Private source configuration

Prepare `<Office state directory>/claw3d/rate-limit-capacity.json` outside this
repository. This is the same state-directory mechanism as monitor links and
hourly participation. Do not commit actual hosts, settings, or credentials.

```json
{
  "version": 1,
  "sources": [{
    "id": "primary",
    "host": "production-a",
    "python": "/srv/read-only-monitor/venv/bin/python3",
    "strategies": [{"name": "maker", "setting": "/srv/maker/atom_setting.json"}]
  }]
}
```

Remote hosts must be active production entries in Office's existing server
registry. SSH uses the existing transport options and a stable home directory;
shared control masters are not closed. Omitting `host` reads local settings.
The selected Python interpreter needs `redis` (already used by the independent
participation collector); its existing venv can be reused. This feature does
not install packages or start a new service on production machines.

One bounded Python probe per source reads the setting's `system.cache_redis`
privately on that machine. It issues only `MGET` for explicitly configured
`heartbeat:strategy:<name>` and `cache:strategy:<name>` keys. The latter supplies
the expected Gate accounts/markets, so a missing heartbeat or a strategy without
the new capacity fields produces unknown cells instead of dropping accounts.
No scans, writes, exchange requests, or trade commands are used. Only allowlisted
heartbeat facts return to Office; exceptions never return credential URLs.

The probe consumes heartbeat capacity schema 1 (`rate_limit_capacity`), including
separate `ts`, `evidence_at_ms`, and `observed_at_ms`. Strategy producer identity
is retained with its instance, PID, and reporter-start timestamp. API output is
`GET /api/monitoring/rate-limit-capacity`, with `Cache-Control: no-store` under the
existing Studio access controls. A five-second shared cache coalesces readers;
cached facts keep their original timestamps. At most four sources, each with
sixteen strategies, are accepted. Transport has an eight-second timeout and a
four-MiB output bound.

The collector/strategy reporting and this Office UI require separate authorized
deployments. With no source configuration the screen says unconfigured; with an
older producer it says unknown. It never manufactures normal data to fill gaps.

Validation: targeted model/source/route/UI Vitest tests, Python probe tests,
TypeScript checking, and an isolated production build/preview. No live cutover
is required for these checks.
