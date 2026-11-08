# Fill probability monitor

Open **Control room → Fill probability**, or `/fill-probability/`. Filter by
strategy, exchange, account, symbol and side. Each selected record shows the
base target, historical theoretical/actual EMA, applied arrival-rate multiplier
`C_A`, and the normalization/guard stages. Probability is dimensionless over a
one-second horizon: `.001` means `0.1% / 1s`. It is not the arrival intensity.

The gap is `p - target`, with relative gap `(p - target) / target`. Signs retain
direction. The color scale moves monotonically from green to red with absolute
relative distance; it describes target distance, not trading health or a guard.
Missing, disabled, expired and unverified evidence is gray. Legacy producers without observation metadata retain gray historical EMA values.
With additive observation schema 1, the original controller ready flag and its
actual observation time govern EMA coloring. No confidence threshold is added.
A source rollout or a fixture is not full-chain live acceptance.

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

Legacy producers do not export normalization before/after, current instantaneous
probability after `C_A`, price guard actions or final guarded probability. Those
values stay N/A until the separately validated observation producer is deployed. Existing pre-rounding diagnostics cannot stand in for final
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
are not modified. The feedback FileKV layout is the existing instance's
`.deploy_runtime/mm_cpp/local-persistence/state`; no filesystem scan is used.

Hosts must be active online entries in Office's existing server registry. SSH
uses that transport and shared control master from a stable home directory.
The configured Python reuses the existing `redis` environment. MGET of explicit heartbeat, dynamic-strategy and the single configured
quote-observation key supplies current identities, maker symbols and quote facts. FileKV reads validate its header, bounded size and checksum.
No Redis or exchange writes, keys or credential URLs reach the browser.

`GET /api/monitoring/fill-probability` uses existing Studio access controls and
`Cache-Control: no-store`. One shared ten-second cache coalesces concurrent
readers. The browser polls every ten seconds while visible, aborts on hide/close,
and ages evidence independently of stalled requests. Export/heartbeat ages over
30 seconds cannot remain green. Subprocess transport is bounded to twelve seconds; legacy stdout is capped at four
MiB; configuration accepts at most four sources with sixteen strategies each.

The compatible record protocol uses the same endpoint with `view=record`. This opt-in view
returns the original `configured`, `serverTime`, `sampledAt` and `sourceErrors`,
an ordered `records` index (`id`, `strategy`, `exchange`, `account`, `symbol`,
`side`), and one complete original `row` or null. Optional `recordId` is the
opaque original ID (at most 1024 characters). Fixed strategy/exchange/account/
symbol/side filters select that row, with the original first-matching fallback.
All options remain in the index even when filtered out. Selectors never change
the source cache or remote read. Invalid/duplicate selectors in this mode return
400 before collecting; an overlong symbol substring remains a no-match, never
a truncated matching prefix. Selection URLs are bounded to 64 KiB.

Switching to a record whose details are not held waits for one read request.
The selection and filters update immediately; another record's old values are
never shown under the pending selection. Only the latest selection response is
accepted. The current UI request policy is described below; ten-second polling and original evidence
aging remain in effect. No numbers, precision, state or quote fields are removed
from the selected row. Without `view=record`, the endpoint keeps its full `rows`
response for older clients; the UI also accepts that response after rollback.

Freshness conservatively includes the whole request's elapsed time using the
browser's monotonic clock, then continues aging every second. This does not use
the phone's wall clock or alter any producer timestamps. The elapsed time also
includes collection before the server timestamp was generated, so it is an
age upper bound, not exact network delay. Slow responses can therefore make
uncertain EMA or quote observations gray early; each keeps its own original
observation/export times and the existing 30-second rule.

Validation covers stateless conversion, strict schema separation, missing and
zero fields, stale/read-failed states, signed gaps/color monotonicity, cache
coalescing, API privacy, UI filters and control-room embedding. Full-chain live
acceptance requires separately authorized producer observation fields and actual
data validation; fixtures never supply live rows.

## Additive observation schema 1

Learning schema 8/controller 2 and its restore semantics remain unchanged. Each
feedback side can additionally export `observation_schema:1` and `observation`
with `at_ms`, original `ready`, `enabled`, `skip_reason`, original actual/model
probability readouts and applied log C_A. The controller copies these under its
existing export lock; only an accepted observation updates the event timestamp.
Legacy restore and learning reset leave that diagnostic time unknown until an
actual new observation. Save time never refreshes it.

Near quote calculation captures the solve's requested/normalized targets, Pmax,
scale/underflow and pinned model inputs directly from existing locals. P1,
post-only and P2 capture their real before/after ticks and execution branch
reasons, without re-solving prices. The existing per-account risk telemetry
slot's guard protects a separate quote POD at at most 1 Hz; warm risk publication
cannot overwrite it. This adds no owner, guard, mutex, thread or history queue.

The existing `unit.target_levels_stats` five-second callback reads that POD
during its existing unit loop. It writes one overwrite key to **Cache Redis**:

```
cache:mm:fill_probability_observation:<canonical Redis strategy>:<instance>
```

This backend is distinct from feedback FileKV. The envelope is
`{observation_schema:1,strategy,instance_id,exported_at_ms,pid,rows}`. Each row
identifies account/symbol and has separate bid/ask scalar observations. Office
checks PID/source, schema, identity, export and quote time, then projects only the
allowlisted scalar fields. It never substitutes a different account's quote.

Cold export evaluates the existing model helper at captured stage prices using
the exact quote's reference price, relative distance, A, kappa and multipliers.
C_A before/after probabilities use the same explicitly displayed pre-arbitrage
solved price. The browser performs no model calculation. Final probability is a
model estimate at the final near **target** price, not an order/fill guarantee.
No quoted side means null final probability, not zero. P1 action compares its
continuous input to final tick price; post-only/P2 compare their actual adjacent
ticks. Success alone never means a changed price.

Quote and EMA retain separate scopes/times/readiness. Valid current quotes can
be colored even if feedback has no saved sample. Original-not-ready, disabled,
unknown and expired data is gray. Positive probability underflow is identified
per quoted side with the captured log target; an intentional zero side is not
labelled a positive underflow. Overflowing exp(log C_A) can be unavailable while
its finite native log and valid EMA values remain visible.

Observation source and consumer require separate validated rollout/deployment.
Do not change the private source pin to a candidate SHA while production still
runs the old binary. Offline candidate fixtures are labelled as such; existing
production without new metadata remains a real, explicitly partial source.


## Symbol table

The normal control-room view shows one row per producer / instance / strategy / exchange / market / account / symbol, with bid and ask labeled in the same metric cell. It never averages accounts. Five defaults are historical C_A-adjusted theoretical EMA, actual EMA, applied C_A, and before/after current C_A probabilities at the same captured reference price. Other original stages can be selected under Columns. Applied C_A/log come only from the quote capture: missing or expired quote never falls back to the controller-export C_A. EMA and quote retain their independent source clocks and gray states; native C_A/log have no probability gap.

Internal descending order is `abs(bid.currentCaProbability - bid.baseTarget) + abs(ask.currentCaProbability - ask.baseTarget)`. Both quotes must be current and both original probabilities/targets valid; otherwise the entire row sorts last. Real zero is valid. The score is not displayed or a selectable column. Side filtering only hides a side, and hiding after-C_A keeps its sorting dependencies. Ties use the complete identity tuple. The existing one-second aging tick can move expired rows to the end without refreshing source times.

`GET /api/monitoring/fill-probability?view=table&columns=model,actual,ca,base-reference,ca-probability` opts into a selected-field table projection of one existing shared snapshot. Omitted columns means the five defaults; empty columns means identity only. Unknown/duplicate columns or parameters fail before reading sources. Original full and record responses remain compatible. All table rows share the original ten-second pending/cache; selecting columns never reads a symbol separately. Filters are local. JSON/gzip/no-store and private-error behavior remain; the client request policy is described below.

Each accepted response retains its own pre-fetch `performance.now()` anchor. Freshness includes the total request elapsed time as a conservative upper bound; slow reads can turn gray sooner. Column changes, failed reads, filters, hiding/resuming and sorting do not reset old observation epochs. Only the latest column request can install a response. Complete old full responses can be projected locally during a server rollback; incomplete record-only responses cannot represent a table.

Choosing every optional metric naturally transfers more facts. Offline body-size measurements are documented with their historical input identity; they do not establish public-network speed or a storage-engine ranking. The mobile table scrolls inside its own container rather than widening the page.


### One-request timing (read only)
The normal route includes a server-generated `X-Fill-Request-Id` and bounded `Server-Timing` diagnostics; the business JSON and source/schema/observation clocks are unchanged. `fill_snapshot` includes configuration and shared-reader waiting; `fill_cache` is `new`, `pending`, or `hit`, and `fill_batch` identifies the shared snapshot generation. Cache hits expose age and batch, **not the previous generation's source durations**. Pending requests refer to the same in-flight batch, not an extra source read.

For an actual read, `srcN_prepareMs`, `execMs`, and `decodeMs` cover script/registered transport preparation, whole subprocess/SSH stdout completion, and JSON/row validation. `stdoutBytes` retains its original decoded JSON byte meaning. `decodedBytes` names that meaning explicitly; `wireBytes` is the actual subprocess stdout size, compressed for table reads. No database instrumentation is added. These are Mac monotonic durations. SSH execution includes interpreter startup, AWS collection/serialization, transport and local scheduling; it is **not pure network RTT or disk-read time**. No credentials, configuration paths, remote exceptions or business values enter diagnostics.

`fill_project`, `fill_json`, `fill_gzip`, decoded/encoded byte counts and `fill_ready` describe the same route. `fill_ready` stops before returning `Response`; it is **not a socket-finish event**. A same-request passive local framing receipt, when available, provides the separate completion boundary; otherwise that boundary stays unmeasured.

The component uses fixed-size local `fill:*` performance marks for real fetch start, response availability, read-JSON completion, validation, submit, DOM commit (`useLayoutEffect`) and a two-rAF display opportunity. Detail contains only a local sequence and validated response request ID. Only the latest mark per stage is retained; an in-memory task observer may capture a bounded sample. JSON-read includes decoding/parse/scheduling; commit/display opportunity does not claim GPU pixels finished. No global fetch/JSON hook, new request, cache bypass or user-visible metric is introduced.

## Selected-column source transport and read attempts

For table reads, the existing model field-dependency map also determines the remote
exit projection. The probe first performs its original state/quote decoding and
identity checks, then returns only requested facts plus all identity, independent
freshness and both-side sorting dependencies. Hidden after-C_A or a side filter
cannot remove the internal sort inputs. No original probability, epoch, precision,
NULL or real zero is changed. All 17 columns and an empty selection are supported.
Missing requested fields fail validation; deliberately unrequested fields are
restored as unknown internal values before the original validators and table
projection. A partial reply can never satisfy a full/record request.

Table stdout uses standard binary gzip, without base64. Node collects a Buffer,
checks a 2 MiB compressed cap, and validates gzip/CRC with a 4 MiB decoded cap.
The server constructs a bounded allowlist from fixed column dependencies; the
Python exit rejects arbitrary fields before I/O. Full/record/legacy reads keep
their existing source and JSON shapes. The browser table JSON/gzip is unchanged.

Full and table readers retain separate bounded in-memory snapshots. The table
reader keeps one current canonical field profile, with ten-second successful
cache/pending coalescing. Equivalent profiles can share a read; different profiles
cannot reuse partial data. A failed collection does not advance the last successful
sampledAt and is eligible for a real next read, while old values/epochs remain
unverified. There is no per-row request, prefetch, backend retry or producer write.

Each visible UI round has at most three attempts including the first, each bounded
by 30 seconds, with two seconds between recoverable failures. Network/body failures,
408, 429, 5xx and source-unavailable responses may retry. Authentication/permanent
4xx, malformed JSON or invalid schema stop without blind retries. Invalid source
data returns a sanitized non-retryable 502; temporary source errors are not accepted
as successful samples. Waiting/retry messages show n/3 in the existing languages.

Only one UI request can be in flight. Healthy ten-second polling cannot interrupt
a retry round. Exhaustion stops automatic reads until manual Refresh; an explicit
column change starts a new generation. Hiding, unmounting and superseding a query
cancel intentionally and cannot install old results or consume a retry opportunity.
Returning to visibility does not revive an exhausted round. Old values continue
aging with their original epochs; each successful attempt uses its own pre-fetch
monotonic anchor. A 30-second request budget does not extend the independent
30-second evidence freshness threshold.
