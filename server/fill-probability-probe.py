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
    if (value.get("observation_schema") not in (1, 2) or value.get("strategy") != name or value.get("instance_id") != instance or
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


def decode_bindings(value, name, instance, pid, now, started):
    exported = number(value.get("exported_at_ms"))
    if (value.get("observation_schema") != 2 or value.get("pricing_scope") != "per_symbol_tif" or
            value.get("strategy") != name or value.get("instance_id") != instance or value.get("pid") != pid or
            exported is None or not started <= exported <= now+5000 or
            not isinstance(value.get("bindings"), list) or len(value["bindings"]) > 2048):
        raise ValueError("scope identity")
    result = {}
    for binding in value["bindings"]:
        fields = ("account", "symbol", "base_token", "tif")
        if (not isinstance(binding, dict) or binding.get("mode") != "per_symbol_tif" or
                any(not isinstance(binding.get(k), str) or not binding[k] or len(binding[k]) > 256 for k in fields) or
                binding["tif"] not in ("RPI", "GTX", "GTC", "IOC", "FOK")):
            raise ValueError("scope identity")
        key = (binding["account"], binding["symbol"])
        if key in result:
            raise ValueError("duplicate scope identity")
        result[key] = binding
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


def decode_state(value, name, instance, symbol, version, now, started, binding=None):
    if version == 10 and (not binding or value.get("mode") != "per_symbol_tif" or
            value.get("base_token") != binding["base_token"] or value.get("tif") != binding["tif"] or
            value.get("clock") != "exposure_seconds"):
        raise ValueError("scope identity")
    clock = "exposure_seconds" if version in (8, 10) else "trials"
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
    progress_key = "exposure_since_adjustment_seconds" if version in (8, 10) else "trials_since_adjustment"
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
                bindings = {}
                if not process_error:
                    try:
                        quotes = decode_quotes(quote_payload, name, instance, pid, now, started)
                        if spec["feedbackVersion"] == 10:
                            bindings = decode_bindings(quote_payload, name, instance, pid, now, started)
                    except (ValueError, TypeError, AttributeError):
                        pass  # Unknown quote metadata cannot invalidate older EMA evidence.
                for unit in units:
                    symbol = unit["symbol"]
                    binding = bindings.get((unit["account"], symbol))
                    scope = (symbol, binding["base_token"], binding["tif"]) if binding else (symbol, None, None)
                    if scope in states:
                        continue
                    try:
                        if process_error:
                            raise ValueError("identity")
                        version = spec["feedbackVersion"]
                        if version == 10:
                            if binding is None:
                                raise ValueError("scope binding unavailable")
                            key = ("cache:mm:target_fill_feedback:v10:" + name + ":" + instance +
                                   ":base_token:" + binding["base_token"] + ":symbol:" + symbol + ":tif:" + binding["tif"])
                        else:
                            prefix = "cache:mm:target_fill_feedback:" + ("v9:" if version == 9 else "")
                            key = prefix + name + ":" + instance + ":symbol:" + symbol
                        value = filekv(root / ".deploy_runtime/mm_cpp/local-persistence/state", key, now)
                        states[scope] = decode_state(value, name, instance, symbol, version, now, started, binding)
                    except FileNotFoundError:
                        states[scope] = "cache-not-exported"
                    except Exception:
                        states[scope] = process_error or "invalid-cache"
                for unit in units:
                    for side in ("bid", "ask"):
                        row = blank(config["id"], name, instance, unit, side)
                        row.update(metadata)
                        binding = bindings.get((unit["account"], unit["symbol"]))
                        scope = (unit["symbol"], binding["base_token"], binding["tif"]) if binding else (unit["symbol"], None, None)
                        state = states[scope]
                        if binding is not None:
                            row.update(pricingMode="per_symbol_tif", baseToken=binding["base_token"], tif=binding["tif"])
                        if spec["feedbackVersion"] == 10 and binding is None:
                            row["quote"] = None
                        if isinstance(state, dict):
                            row.update(state[side])
                        else:
                            row.update(reason=state)
                        row["quote"] = (quotes.get((unit["account"], unit["symbol"]), {}).get(side)
                            if spec["feedbackVersion"] != 10 or binding is not None else None)
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
