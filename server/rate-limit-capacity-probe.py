#!/usr/bin/env python3
"""Read only configured strategy heartbeat/cache keys. Never print settings or credentials."""
import json
import math
import sys
from pathlib import Path

FIELDS = ("exchange", "account", "market", "state", "low_capacity", "limit", "normal_limit",
          "normal_window_ms", "reset_wait_ms", "evidence_at_ms", "observed_at_ms")


def decode(blob):
    if not blob or len(blob) > 4 * 1024 * 1024:
        return {}
    value = json.loads(blob)
    return value if isinstance(value, dict) else {}


def sanitize(value):
    def scalar(v):
        return v if (v is None or isinstance(v, bool) or
                     isinstance(v, (int, float)) and math.isfinite(v) or
                     isinstance(v, str) and len(v) <= 256) else None
    hb = {k: scalar(value.get(k)) for k in ("ts", "type", "success", "strategy", "rate_limit_capacity_schema", "strategy_idx", "pid", "reporter_started_at_ms")}
    if value.get("rate_limit_capacity_error"):
        hb["rate_limit_capacity_error"] = True
    rows = value.get("rate_limit_capacity", [])
    hb["rate_limit_capacity"] = [
        {k: r[k] for k in FIELDS if k in r and
         (r[k] is None or isinstance(r[k], bool) or
          isinstance(r[k], (int, float)) and math.isfinite(r[k]) or
          isinstance(r[k], str) and len(r[k]) <= 256)}
        for r in rows[:1024] if isinstance(r, dict)
    ] if isinstance(rows, list) else []
    return hb


def expected(dynamic):
    result = set()
    for account, units in dynamic.get("portfolio_params", {}).get("unit_params", {}).items():
        if not isinstance(account, str) or not isinstance(units, dict):
            continue
        for symbol in units:
            parts = symbol.split(".", 2)
            if len(parts) == 3 and parts[0] in ("gate", "gateio") and parts[1] in ("spot", "perp"):
                result.add(("gateio", account, parts[1]))
    return [dict(exchange=e, account=a, market=m) for e, a, m in sorted(result)]


def collect(config, client_factory=None):
    if client_factory is None:
        import redis
        client_factory = redis.Redis.from_url
    replies, groups = {}, {}
    for strategy in config["strategies"]:
        name = strategy["name"]
        replies[name] = dict(id=config["id"] + ":" + name, strategy=name, expected=[], heartbeat=None, error=None)
        try:
            setting = Path(strategy["setting"])
            if setting.stat().st_size > 4 * 1024 * 1024:
                raise ValueError()
            url = json.loads(setting.read_text())["system"]["cache_redis"]
            groups.setdefault(url, []).append(name)
        except Exception:
            replies[name]["error"] = "read-failed"
    for url, names in groups.items():
        client = None
        try:
            client = client_factory(url, socket_connect_timeout=2, socket_timeout=2)
            keys = [key for name in names for key in ("heartbeat:strategy:" + name, "cache:strategy:" + name)]
            values = client.mget(keys)
            for i, name in enumerate(names):
                try:
                    replies[name]["expected"] = expected(decode(values[2*i+1]))
                    replies[name]["heartbeat"] = sanitize(decode(values[2*i]))
                except Exception:
                    replies[name]["error"] = "read-failed"
        except Exception:
            for name in names:
                replies[name]["error"] = "read-failed"
        finally:
            if client is not None:
                try:
                    client.close()
                except Exception:
                    pass
    return dict(version=1, producers=list(replies.values()))


if __name__ == "__main__":
    try:
        print(json.dumps(collect(json.loads(sys.argv[1])), allow_nan=False, separators=(",", ":")))
    except Exception:
        # Redis exceptions can contain credential-bearing URLs. Do not print them.
        print('{"error":"read-failed"}')
        sys.exit(1)
