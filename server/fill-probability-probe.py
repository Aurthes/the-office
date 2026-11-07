#!/usr/bin/env python3
"""Bounded read of configured live identities and exact feedback FileKV keys.

No EMA updates, model solves, Redis writes, scans or exchange requests.
Probability conversion is the controller's stateless snapshot readout.
"""
import datetime
import json
import math
import struct
import sys
import time
from pathlib import Path


def number(value):
    return value if type(value) in (int, float) and math.isfinite(value) else None


def read_json(path):
    with path.open("rb") as stream:
        raw = stream.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError("size")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("object")
    return value


def filekv(root, key, now):
    encoded = key.encode().hex()
    while len(encoded) > 120:
        root = root / ("p" + encoded[:120])
        encoded = encoded[120:]
    with (root / ("k" + encoded) / "current").open("rb") as stream:
        header = stream.read(33)
        if len(header) != 33 or header[:9] != b"FKV00001S":
            raise ValueError("header")
        expiry, size, checksum = struct.unpack("<QQQ", header[9:])
        if size > 256 * 1024 or expiry and expiry <= now:
            raise ValueError("size or expiry")
        raw = stream.read(size)
        if len(raw) != size or stream.read(1):
            raise ValueError("size")
    actual = 14695981039346656037
    for byte in raw:
        actual = (actual ^ byte) * 1099511628211 & ((1 << 64) - 1)
    if actual != checksum:
        raise ValueError("checksum")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("object")
    return value


def identity(root, name):
    record = read_json(root / ".deploy_runtime/mm_cpp/latest-process.json")
    pid, sha = record.get("pid"), record.get("git_sha")
    if type(pid) is not int or pid <= 0 or record.get("state") != "running":
        raise ValueError("process")
    proc = Path("/proc") / str(pid)
    argv = (proc / "cmdline").read_bytes().split(b"\0")
    stat = (proc / "stat").read_text().split(") ", 1)[1].split()
    if stat[0] == "Z" or (proc / "cwd").resolve() != root.resolve() or (proc / "exe").resolve() != Path(record["executable"]).resolve():
        raise ValueError("process")
    for flag, expected in ((b"--strategy-name", name), (b"--git-commit", sha)):
        if flag not in argv or argv[argv.index(flag) + 1].decode() != expected:
            raise ValueError("process")
    started = datetime.datetime.fromisoformat(record["started_at"]).timestamp() * 1000
    return pid, sha, started


def expected(dynamic):
    rows = []
    units = dynamic.get("portfolio_params", {}).get("unit_params", {})
    if not isinstance(units, dict):
        raise ValueError("units")
    for account, symbols in units.items():
        if not isinstance(account, str) or len(account) > 256 or not isinstance(symbols, dict):
            raise ValueError("units")
        for symbol, unit in symbols.items():
            if not isinstance(unit, dict) or unit.get("mode") != "maker":
                continue
            parts = symbol.split(".", 2)
            if len(parts) != 3 or len(symbol) > 256:
                raise ValueError("symbol")
            rows.append(dict(account=account, exchange=parts[0], market=parts[1], symbol=symbol))
            if len(rows) > 2048:
                raise ValueError("units")
    return sorted(rows, key=lambda row: (row["account"], row["symbol"]))


def decode_state(value, name, instance, symbol, version, now, started):
    clock = "exposure_seconds" if version == 8 else "trials"
    half_key = "half_life_" + clock
    interval_key = "adjustment_interval_" + clock
    half, interval = number(value.get(half_key)), number(value.get(interval_key))
    saved, target = number(value.get("saved_at_ms")), number(value.get("target_probability_1s"))
    low, high = number(value.get("a_multiplier_min")), number(value.get("a_multiplier_max"))
    max_error = number(value.get("max_abs_log_error"))
    if (value.get("version") != version or value.get("strategy") != name or
            value.get("instance_id") != instance or value.get("symbol") != symbol or
            saved is None or saved <= 0 or saved > now + 5000 or saved < started or
            type(value.get("enabled")) is not bool or target is None or not 0 < target < 1 or
            half is None or half <= 0 or interval is None or interval <= 0 or
            max_error is None or max_error <= 0 or low is None or high is None or not low <= 0 <= high):
        raise ValueError("invalid-cache")
    result = {}
    sides = value.get("side_states", {})
    progress_key = "exposure_since_adjustment_seconds" if version == 8 else "trials_since_adjustment"
    for side in ("bid", "ask"):
        ema = sides.get(side, {}).get("ema", {})
        masses = [number(ema.get(key)) for key in ("hit_ema", "exposure_ema_seconds", "base_model_hazard_ema", "model_hazard_ema")]
        progress, log_ca = number(ema.get(progress_key)), number(ema.get("log_a_multiplier", 0))
        if (any(v is None or v < 0 for v in masses) or progress is None or not 0 <= progress < interval or
                version == 9 and (int(progress) != progress or int(half) != half or int(interval) != interval) or log_ca is None):
            raise ValueError("invalid-cache")
        hit, exposure, base, model = masses
        if exposure == 0 and (hit != 0 or base != 0 or model != 0 or progress != 0):
            raise ValueError("invalid-cache")
        applied_log = min(high, max(low, log_ca))
        ca = math.exp(applied_log)
        if not math.isfinite(ca):
            raise ValueError("invalid-cache")
        result[side] = dict(savedAt=saved, schema=version, clock=clock, halfLife=half,
                            adjustmentInterval=interval, adjustmentProgress=progress,
                            enabled=value["enabled"], weightedHits=hit, weightedExposureSeconds=exposure,
                            baseTheoreticalEma=-math.expm1(-base/exposure) if exposure > 0 else None,
                            theoreticalEma=-math.expm1(-model/exposure) if exposure > 0 else None,
                            actualEma=-math.expm1(-hit/exposure) if exposure > 0 else None,
                            ca=ca, logCa=applied_log, target=target,
                            reason="no-exposure" if exposure == 0 else None)
    return result


def blank(source_id, name, instance, unit, side):
    row = {key: None for key in ("sourceSha", "pid", "heartbeatAt", "savedAt", "observedAt", "schema",
                               "halfLife", "adjustmentInterval", "adjustmentProgress", "enabled", "weightedHits",
                               "weightedExposureSeconds", "baseTheoreticalEma", "theoreticalEma", "actualEma", "ca", "logCa", "target", "reason")}
    return dict(row, **unit, id=json.dumps([source_id, name, instance, unit["account"], unit["symbol"], side], separators=(",", ":")),
                producer=source_id + ":" + name, strategy=name, instance=instance, side=side, clock="unknown", error=False)


def collect(config, client_factory=None):
    if client_factory is None:
        import redis
        client_factory = redis.Redis.from_url
    output, groups, strategies = [], {}, {}
    now = int(time.time() * 1000)
    for spec in config["strategies"]:
        name = spec["name"]
        setting = Path(spec["setting"])
        data = read_json(setting)
        instance = str(data["strategy"]["params"]["instance_id"])
        if not instance or len(instance) > 128:
            raise ValueError("instance")
        strategies[name] = (spec, setting.parent, instance)
        groups.setdefault(data["system"]["cache_redis"], []).append(name)
    for url, names in groups.items():
        client = None
        try:
            client = client_factory(url, socket_connect_timeout=2, socket_timeout=2)
            blobs = client.mget([key for name in names for key in ("heartbeat:strategy:" + name, "cache:strategy:" + name)])
            for index, name in enumerate(names):
                spec, root, instance = strategies[name]
                hb, dynamic = [json.loads(blob) if blob else {} for blob in blobs[2*index:2*index+2]]
                units = expected(dynamic)
                metadata, process_error = {}, None
                try:
                    pid, sha, started = identity(root, name)
                    metadata = dict(pid=pid, sourceSha=sha, heartbeatAt=number(hb.get("ts")))
                    if (sha != spec["sourceSha"] or hb.get("strategy") != name or str(hb.get("strategy_idx")) != instance or
                            hb.get("pid") != pid or hb.get("type") != "hb" or hb.get("success") is not True or
                            number(hb.get("reporter_started_at_ms")) is None or hb["reporter_started_at_ms"] < started):
                        raise ValueError("heartbeat-identity-mismatch")
                except Exception:
                    process_error = "live-identity-unverified"
                states = {}
                for symbol in sorted({unit["symbol"] for unit in units}):
                    try:
                        if process_error:
                            raise ValueError("identity")
                        version = spec["feedbackVersion"]
                        prefix = "cache:mm:target_fill_feedback:" + ("v9:" if version == 9 else "")
                        key = prefix + name + ":" + instance + ":symbol:" + symbol
                        value = filekv(root / ".deploy_runtime/mm_cpp/local-persistence/state", key, now)
                        states[symbol] = decode_state(value, name, instance, symbol, version, now, started)
                    except FileNotFoundError:
                        states[symbol] = "cache-not-exported"
                    except Exception:
                        states[symbol] = process_error or "invalid-cache"
                for unit in units:
                    for side in ("bid", "ask"):
                        row = blank(config["id"], name, instance, unit, side)
                        row.update(metadata)
                        state = states[unit["symbol"]]
                        if isinstance(state, dict):
                            row.update(state[side])
                        else:
                            row.update(reason=state)
                        output.append(row)
        finally:
            if client is not None:
                client.close()
    return dict(version=1, rows=output)


if __name__ == "__main__":
    try:
        print(json.dumps(collect(json.loads(sys.argv[1])), allow_nan=False, separators=(",", ":")))
    except Exception:
        # Exceptions may contain credential URLs or private paths.
        print('{"error":"read-failed"}')
        sys.exit(1)
