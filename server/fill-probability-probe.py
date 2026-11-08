#!/usr/bin/env python3
"""Bounded read of configured live identities and exact feedback FileKV keys.

No EMA updates, model solves, Redis writes, scans or exchange requests.
Probability conversion is the controller's stateless snapshot readout.
"""
import gzip
import datetime
import json
import math
import struct
import sys
import time
from pathlib import Path


def number(value):
    return value if type(value) in (int, float) and math.isfinite(value) else None


QUOTE_NUMBERS = ("at", "exportedAt", "baseTarget", "beforeNormalize", "afterNormalize", "pmax", "normalizationScale",
                 "logAfterNormalize", "ca", "logCa", "referencePrice", "currentCaProbability", "baseAtReferenceProbability",
                 "p1BeforePrice", "p1AfterPrice", "postOnlyAfterPrice", "p2AfterPrice", "finalPrice",
                 "p1BeforeProbability", "p1AfterProbability", "postOnlyAfterProbability", "p2AfterProbability", "finalProbability", "disabledMask")
QUOTE_BOOLS = ("normalizationEnabled", "underflow", "quoted")
QUOTE_STATES = ("p1State", "postOnlyState", "p2State")


def decode_quotes(value, name, instance, pid, now, started):
    if not value:
        return {}
    exported = number(value.get("exported_at_ms"))
    if (value.get("observation_schema") != 1 or value.get("strategy") != name or value.get("instance_id") != instance or
            value.get("pid") != pid or exported is None or not started <= exported <= now+5000 or
            not isinstance(value.get("rows"), list) or len(value["rows"]) > 2048):
        raise ValueError("quote identity")
    result = {}
    for unit in value["rows"]:
        account, symbol = unit.get("account"), unit.get("symbol")
        if not isinstance(account, str) or len(account) > 256 or not isinstance(symbol, str) or len(symbol) > 256 or (account, symbol) in result:
            raise ValueError("quote identity")
        sides = {}
        for side in ("bid", "ask"):
            row = unit.get(side)
            if (not isinstance(row, dict) or type(row.get("available")) is not bool or
                    any(key not in row or row[key] is not None and number(row[key]) is None for key in QUOTE_NUMBERS) or
                    any(key not in row or row[key] is not None and type(row[key]) is not bool for key in QUOTE_BOOLS) or
                    any(row.get(key) not in ("changed", "unchanged", "not-run", "rejected", "unknown") for key in QUOTE_STATES) or
                    row.get("exportedAt") != exported or
                    row.get("guardReason") is not None and (not isinstance(row["guardReason"], str) or len(row["guardReason"]) > 128)):
                raise ValueError("quote shape")
            if row["available"] and (row["at"] is None or not started <= row["at"] <= exported+5000):
                raise ValueError("quote time")
            for key in ("baseTarget", "beforeNormalize", "afterNormalize", "pmax", "currentCaProbability", "baseAtReferenceProbability",
                        "p1BeforeProbability", "p1AfterProbability", "postOnlyAfterProbability", "p2AfterProbability", "finalProbability"):
                if row[key] is not None and not 0 <= row[key] <= 1:
                    raise ValueError("quote probability")
            if row["quoted"] is False and row["finalProbability"] is not None:
                raise ValueError("no quote probability")
            sides[side] = {key: row[key] for key in (*QUOTE_NUMBERS, *QUOTE_BOOLS, *QUOTE_STATES, "available", "guardReason")}
        result[(account, symbol)] = sides
    return result


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
        try:
            ca = math.exp(applied_log)
            if not math.isfinite(ca):
                ca = None
        except OverflowError:
            ca = None  # The finite native log remains valid beyond exp range.
        result[side] = dict(savedAt=saved, schema=version, clock=clock, halfLife=half,
                            adjustmentInterval=interval, adjustmentProgress=progress,
                            enabled=value["enabled"], weightedHits=hit, weightedExposureSeconds=exposure,
                            baseTheoreticalEma=-math.expm1(-base/exposure) if exposure > 0 else None,
                            theoreticalEma=-math.expm1(-model/exposure) if exposure > 0 else None,
                            actualEma=-math.expm1(-hit/exposure) if exposure > 0 else None,
                            ca=ca, logCa=applied_log, target=target,
                            reason="no-exposure" if exposure == 0 else None)
        # Additive observation metadata is copied by the original controller
        # under its existing export lock. A save time never stands in for it.
        observation = sides.get(side, {}).get("observation", {})
        if sides.get(side, {}).get("observation_schema") == 1 and isinstance(observation, dict):
            at = number(observation.get("at_ms"))
            actual = number(observation.get("actual_probability_1s"))
            model = number(observation.get("theoretical_probability_1s"))
            if (type(observation.get("ready")) is bool and observation.get("enabled") is value["enabled"] and
                    observation.get("skip_reason") in ("disabled", "insufficient_exposure", "invalid_config", "invalid_episode", "") and
                    at is not None and (at == 0 or started <= at <= saved+5000) and
                    actual is not None and 0 <= actual <= 1 and model is not None and 0 <= model <= 1):
                result[side].update(observedAt=at if at > 0 else None, ready=observation["ready"], skipReason=observation["skip_reason"])
                if observation["ready"]:
                    result[side].update(actualEma=actual, theoreticalEma=model)
    return result


def blank(source_id, name, instance, unit, side):
    row = {key: None for key in ("sourceSha", "pid", "heartbeatAt", "savedAt", "observedAt", "schema",
                               "halfLife", "adjustmentInterval", "adjustmentProgress", "enabled", "weightedHits",
                               "weightedExposureSeconds", "baseTheoreticalEma", "theoreticalEma", "actualEma", "ca", "logCa", "target", "reason", "ready", "skipReason", "quote")}
    return dict(row, **unit, id=json.dumps([source_id, name, instance, unit["account"], unit["symbol"], side], separators=(",", ":")),
                producer=source_id + ":" + name, strategy=name, instance=instance, side=side, clock="unknown", error=False)


# Source output projection only; all original identity/controller/quote validation runs first.
def validate_projection(value):
    if value is None:
        return None
    required_row = {"id", "producer", "strategy", "instance", "account", "exchange", "market", "symbol", "side", "sourceSha", "pid", "heartbeatAt", "savedAt", "observedAt", "schema", "clock", "enabled", "weightedExposureSeconds", "ready", "error", "reason", "skipReason", "target"}
    allowed_row = required_row | {"halfLife", "adjustmentInterval", "adjustmentProgress", "weightedHits", "baseTheoreticalEma", "theoreticalEma", "actualEma", "ca", "logCa"}
    required_quote = {"available", "at", "exportedAt", "baseTarget", "currentCaProbability"}
    allowed_quote = set(QUOTE_NUMBERS + QUOTE_BOOLS + QUOTE_STATES + ("available", "guardReason"))
    if not isinstance(value, dict) or set(value) != {"row", "quote"}:
        raise ValueError("projection")
    for key, required, allowed in (("row", required_row, allowed_row), ("quote", required_quote, allowed_quote)):
        fields = value[key]
        if (not isinstance(fields, list) or len(fields) > 64 or any(not isinstance(f, str) for f in fields) or
                len(set(fields)) != len(fields) or not required <= set(fields) <= allowed):
            raise ValueError("projection")
    return {key: sorted(value[key]) for key in ("row", "quote")}


def project_rows(rows, projection):
    if projection is None:
        return rows
    result = []
    for row in rows:
        q = row["quote"]
        result.append({**{key: row[key] for key in projection["row"]},
                       "quote": None if q is None else {key: q[key] for key in projection["quote"]}})
    return result


def encode_reply(reply, compressed=False):
    raw = json.dumps(reply, allow_nan=False, separators=(",", ":")).encode()
    if len(raw) > 4*1024*1024:
        raise ValueError("reply size")
    if not compressed:
        return raw + b"\n"
    wire = gzip.compress(raw, mtime=0)
    if len(wire) > 2*1024*1024:
        raise ValueError("wire size")
    return wire


def collect(config, client_factory=None):
    projection = validate_projection(config.get("projection"))
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
            blobs = client.mget([key for name in names for key in (
                "heartbeat:strategy:" + name, "cache:strategy:" + name,
                "cache:mm:fill_probability_observation:" + name + ":" + strategies[name][2])])
            for index, name in enumerate(names):
                spec, root, instance = strategies[name]
                chunk = blobs[3*index:3*index+3]
                if any(blob and len(blob) > 4*1024*1024 for blob in chunk):
                    raise ValueError("Redis size")
                hb, dynamic, quote_payload = [json.loads(blob) if blob else {} for blob in chunk]
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
                quotes = {}
                if not process_error:
                    try:
                        quotes = decode_quotes(quote_payload, name, instance, pid, now, started)
                    except (ValueError, TypeError, AttributeError):
                        pass  # Unknown quote metadata cannot invalidate older EMA evidence.
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
                        row["quote"] = quotes.get((unit["account"], unit["symbol"]), {}).get(side)
                        output.append(row)
        finally:
            if client is not None:
                client.close()
    return dict(version=1, rows=project_rows(output, projection), **({"projection": projection} if projection is not None else {}))


if __name__ == "__main__":
    try:
        config = json.loads(sys.argv[1])
        if config.get("wire_gzip") is not None and type(config["wire_gzip"]) is not bool:
            raise ValueError("wire format")
        sys.stdout.buffer.write(encode_reply(collect(config), config.get("wire_gzip") is True))
    except Exception:
        # Exceptions may contain credential URLs or private paths.
        print('{"error":"read-failed"}')
        sys.exit(1)
