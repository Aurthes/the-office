# Hourly market participation

The control-room monitor and `/market-participation/` show two equally weighted
measures: our executed notional / market executed notional, and our execution
count / market trade count. Both use the same symbol, order class and whole hour.
Classes are RPI and non-RPI; GTC, post-only, IOC and FOK belong to non-RPI.
Counts refer to individual executions, including partial fills, not filled orders.
Hours are displayed in Asia/Shanghai. USDT and USDC notionals use 1:1 dollar value.

Account and exchange summaries sum original numerators and denominators before
dividing. A physical symbol/class market denominator is counted once across
accounts. Exchange summaries cover the monitored symbol universe, not every
symbol listed by the exchange. Multiple account executions against a single
market trade can produce a share above 100%; values are not clamped.

## Sources and coverage

`server/participation/collector.py` is an independent read-only Python process.
It reads selected account/symbol units from existing strategy cache Redis and
uses public WebSockets once per physical market. Private REST executions use
fixed windows, full pagination, overlap and persistent execution-ID deduplication.
The associated order's actual time-in-force provides its class. A maker flag is
not a substitute for RPI. All exchange requests are GET; this service cannot
submit, amend or cancel orders. There are no changes to strategy processes.

Bybit public trades provide `RPI`. Gate public RPI is an **estimate** from the ID
difference between `trades` and `f_trades`, for futures and spot. `f_trades` is an
exchange-supported live channel outside the published channel reference; changes
or loss of either feed invalidate coverage. Matching checks timestamps and
notional, handles either arrival order, and rejects unmatched filtered records.
This estimate depends on the filtered feed retaining its observed semantics.
The monitor does not treat `is_internal` as RPI.
Gate REST and WebSocket connections request `X-Gate-Size-Decimal: 1`.
Without this header, fractional contract quantities can truncate to zero, which
corrupts both notional and execution counts. Preserve it on every reconnect.

Only hours observed from start to end, with complete account synchronization and
known order classes, show participation after a 120-second settlement window.
Startup hours, reconnects, late data beyond settlement, unknown types and cache
overflow produce incomplete status and null shares. Raw totals remain visible.
A known zero numerator with complete positive denominator shows 0%; no market
trades produces an undefined share. Stream-level transport health cannot prove
that an exchange never omitted a trade before sending it.

## Collector deployment

Create an isolated Python environment, install the pinned `requirements.txt`,
and run:

```sh
python collector.py --config /absolute/private/participation.json
```

The private configuration contains no new API secrets:

```json
{
  "state_dir": "/absolute/private/participation-state",
  "aws_region": "ap-northeast-1",
  "poll_seconds": 30,
  "strategies": [
    { "name": "strategy-name", "setting": "/absolute/instance/atom_setting.json" }
  ]
}
```

The process uses the host's existing AWS IAM access to Secrets Manager (`exApi/`
plus account name with dots replaced by slashes) and KMS, keeping decoded
credentials in memory. Account access should be restricted to read operations
where supported. Keep configuration and state private. Run one collector owner
per state directory, with service restart and bounded CPU/memory resources.

State includes durable SQLite hourly facts, short-lived private deduplication
records, atomic `index.json`, and `hours/<epoch-ms>.json`. The UI lists the latest
336 hours; hourly facts are retained. Public trade IDs are bounded transient
memory, not a second bulk trade archive. Restart preserves own execution dedup
but marks the interrupted public hour incomplete. The initial hour cannot be
retroactively made complete by reconnecting.

## Studio integration

Create `claw3d/participation.json` below Studio's resolved state directory:

```json
{ "host": "registered-online-ssh-alias", "directory": "/absolute/private/participation-state" }
```

Only an active registered online SSH host is accepted. Omitting `host` reads local
snapshots. The read-only `/api/monitoring/participation?hour=<epoch-ms>` endpoint
uses existing SSH transport reuse and a 15-second cache. Its global `updatedAt`
is the collector heartbeat; a historical hour's publication time is not used as
the freshness signal. Add `/market-participation/` as a chart monitor link through
the existing monitor configuration, preserving other links. It opens inside the
control room. Only Studio needs redeployment; Gateway and strategies stay running.

Validate aggregation and persistence with:

```sh
python -B -m unittest discover -s server/participation -p 'test_*.py'
npm test -- --run tests/unit/participation-model.test.ts tests/unit/participation-dashboard.test.ts tests/unit/monitorDashboard.test.ts
```

Also verify the actual public Studio entry point, source heartbeat, private
execution/order classification, both public feed acknowledgements, and a settled
fully observed hour. Partial hours are not evidence of complete-hour accuracy.

API references: [Bybit executions](https://bybit-exchange.github.io/docs/v5/order/execution),
[Bybit order history](https://bybit-exchange.github.io/docs/v5/order/order-list),
[Bybit public trades](https://bybit-exchange.github.io/docs/v5/websocket/public/trade),
[Gate futures](https://www.gate.com/docs/developers/apiv4/en/futures/),
[Gate spot](https://www.gate.com/docs/developers/apiv4/en/spot/).
