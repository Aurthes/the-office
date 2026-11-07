# Fill probability monitor

Open **Control room → Fill probability**, or `/fill-probability/`. Filter by
strategy, exchange, account, symbol and side. Each selected record shows the
base target, historical theoretical/actual EMA, applied arrival-rate multiplier
`C_A`, and the normalization/guard stages. Probability is dimensionless over a
one-second horizon: `.001` means `0.1% / 1s`. It is not the arrival intensity.

The gap is `p - target`, with relative gap `(p - target) / target`. Signs retain
direction. The color scale moves monotonically from green to red with absolute
relative distance; it describes target distance, not trading health or a guard.
Missing, disabled, expired and unverified evidence is gray. Current supported
cache schemas do not export observation time or sample readiness, so their EMA
numbers and gaps remain gray even when the cache was recently saved. This is a
partial observation panel, not full-chain live acceptance.

## Existing state, no new controller

The server reads exact current maker-symbol keys from existing FileKV state.
EMA is shared by strategy instance, symbol and side; account rows explicitly
reference that shared state. No second EMA, model fit, guard or normalization is
computed. The stateless snapshot conversion reproduces the existing controller:

```
actual EMA p = -expm1(-hit_ema / exposure_ema_seconds)
adjusted theoretical EMA p = -expm1(-model_hazard_ema / exposure_ema_seconds)
base-model probability = -expm1(-base_model_hazard_ema / exposure_ema_seconds)
C_A = exp(clamp(log_a_multiplier, a_multiplier_min, a_multiplier_max))
```

The first two are the controller's snapshot readouts; the base-model column is
labelled as a cache conversion. Historical model mass already contains each
interval's own `C_A`; it is never replaced by base mass times today's multiplier.
`C_A` and its log use native units and have no probability gap.

Weighted exposure is not wall time or sample count. Gate progress is a remainder,
not total samples. Save time is not the last observation time. Zero exposure
does not manufacture a zero probability; zero hits with positive exposure does
represent zero in the persisted snapshot. Only the schema-defined omitted
`log_a_multiplier` has a zero default; missing mass fields are unknown.

Normalization before/after, current instantaneous probability after `C_A`, price
guard actions and final guarded probability are not in these cache schemas.
They stay N/A. Existing pre-rounding diagnostics cannot stand in for final
post-only/P2 output. An unknown guard action is not “not triggered”. Quotes may
intentionally have different side targets after skew. This panel cannot attribute
an unexplained difference to a missing stage.

## Private sources and version binding

Prepare `<Office state directory>/claw3d/fill-probability.json` outside Git:

```json
{
  "version": 1,
  "sources": [{
    "id": "primary",
    "host": "production-a",
    "python": "/srv/read-only-monitor/venv/bin/python3",
    "strategies": [{
      "name": "maker",
      "setting": "/srv/maker/atom_setting.json",
      "sourceSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "feedbackVersion": 8
    }]
  }]
}
```

`sourceSha` must be the independently reviewed running strategy source, not a
branch tip. The probe verifies the existing process record, `/proc` executable,
working directory, source/strategy CLI and heartbeat PID/instance. It refuses
to decode state if the running source differs from the configured pin. After a
strategy version change, review its source/schema before updating this private
monitor configuration. No strategy deployment is performed by the panel.

Supported mappings:

| Envelope | Exact key | EMA clock / gate |
| --- | --- | --- |
| 8 | `cache:mm:target_fill_feedback:<strategy>:<instance>:symbol:<symbol>` | `half_life_exposure_seconds`, `adjustment_interval_exposure_seconds`, `exposure_since_adjustment_seconds` |
| 9 | `cache:mm:target_fill_feedback:v9:<strategy>:<instance>:symbol:<symbol>` | `half_life_trials`, `adjustment_interval_trials`, `trials_since_adjustment` |

No fallback to another schema or selection by newest timestamp is permitted.
Persisted state must match strategy/instance/symbol/version, have valid masses,
and have been saved after the current process started. Retained old namespaces
are not modified. Current FileKV layout is the existing instance's
`.deploy_runtime/mm_cpp/local-persistence/state`; no filesystem scan is used.

Hosts must be active online entries in Office's existing server registry. SSH
uses that transport and shared control master from a stable home directory.
The configured Python reuses the existing `redis` environment. Only MGET of
explicit heartbeat and dynamic-strategy keys supplies current identities and
maker symbols. FileKV reads validate its header, bounded size and checksum.
No Redis or exchange writes, keys or credential URLs reach the browser.

`GET /api/monitoring/fill-probability` uses existing Studio access controls and
`Cache-Control: no-store`. One shared ten-second cache coalesces concurrent
readers. The browser polls every ten seconds while visible, aborts on hide/close,
and ages evidence independently of stalled requests. Export/heartbeat ages over
30 seconds cannot remain green. Transport is bounded to twelve seconds and four
MiB; configuration accepts at most four sources with sixteen strategies each.

Validation covers stateless conversion, strict schema separation, missing and
zero fields, stale/read-failed states, signed gaps/color monotonicity, cache
coalescing, API privacy, UI filters and control-room embedding. Full-chain live
acceptance requires separately authorized producer observation fields and actual
data validation; fixtures never supply live rows.
