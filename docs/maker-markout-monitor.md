# Actual maker markout distributions

Open **Maker markout** in the control room, or `/maker-markout/`. The plot shows
P50 over UTC export time with P25–P75 and P5–P95 empirical distribution bands.
These are sample distributions, not confidence intervals or a receipt-matched
cohort study. Each valid opening-maker fill segment has equal weight in signed
bps; a partial fill is not a unique order. Original pricing, fees, trading,
sampling and collector admission rules are unchanged.

Choose one of the twelve horizons through 60m, history (1/6/24h), strategy,
exchange, symbol and TIF class. Only known GTX/GTC belong to non-RPI; unknown
TIF stays separate. Samples are pooled before type-7 quantiles are computed
(position `(n−1)p`), never by averaging subgroup quantiles. Closed UTC buckets
are 5/15/60 minutes respectively. Pending belongs to later immature fills and
does not enter a settled export-time bucket. Recent fills need the selected
horizon plus observation/export time. There is no fixed 20-second browser abort.

The existing private `claw3d/rate-limit-capacity.json` strategy inventory is
reused, with an optional `claw3d/maker-markout.json` override under the Office
state directory. Both use version 1 and `sources` with `id`, optional `host` and
`python`, and `strategies: [{name, setting}]`. Each absolute setting path stays
server-side. The probe reads the original `system.influx` connection and runs
read-only queries; credentials and raw samples never go to the browser.
Do not put real paths or credentials in this repository.

The strategy must emit `MMActualMarkout` numeric fields `sample_schema=1`,
`sample_count`, `sample_overflow`, `sample_invalid` and only actual
`sample_00..sample_63`. Each original interval row obeys
`count = sample_count + sample_overflow + sample_invalid`. Legacy averages
cannot recover distributions. Any sample overflow, invalid/missing slot,
missing-price counter increase or known transport inconsistency yields N/A;
no empty or young sample is filled with zero. Exact duplicate interval identities
are deduplicated and conflicting duplicates are incomplete.

Original per-run settled counters reconcile the selected raw rows with a prior
watermark and the current guard bucket. This can detect a missing export once a
later watermark arrives; it cannot prove that a never-observed run, a final
silent loss, a crash's pending cohort, or collector admission drops did not
exist. This view is conditional on the original admitted, valid settled
population. It does not establish complete receipt-cohort, restart or capacity
coverage. Consult the original collector health and run evidence before making
those claims. Multiple runs are counted and displayed, not reconstructed.

Bounds: at most 4 sources, 16 strategies/source, 64KiB inventory, 24h history,
20,000 raw and 20,000 quality rows total per source, 12MiB/query response,
16MiB process output. Exceeding a bound fails the source rather than selecting
a prefix. Reads share a 30-second cache across client dimensions, at most two
active read keys and four retained keys. Browser responses contain aggregates
only. Remote process/read limits are 55/60 seconds; an old snapshot expires
visually after 90 seconds. Local query failure never exposes private errors.

The API uses the existing Studio authentication boundary. Verify through a
normal login session. Injecting the private proxy-hop header into a browser is
not a public authentication test. Synthetic probe/browser fixtures prove the
candidate path only; real public deployment and live mature 60m data require
separate manager acceptance.
