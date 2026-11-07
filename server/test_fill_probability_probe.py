import copy
import importlib.util
import json
import math
import struct
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location("fill_probe", Path(__file__).with_name("fill-probability-probe.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


def state(version=8):
    clock = "exposure_seconds" if version == 8 else "trials"
    gate = "exposure_since_adjustment_seconds" if version == 8 else "trials_since_adjustment"
    ema = dict(hit_ema=1.0, exposure_ema_seconds=100.0, base_model_hazard_ema=2.0, model_hazard_ema=0.5, **{gate: 5})
    return dict(version=version, strategy="maker", instance_id="5", symbol="venue.perp.coin_usdt", saved_at_ms=2000,
                enabled=True, target_probability_1s=0.001, max_abs_log_error=.5, a_multiplier_min=-10, a_multiplier_max=10,
                **{"half_life_"+clock: 100, "adjustment_interval_"+clock: 100 if version == 8 else 200},
                side_states=dict(bid=dict(ema=copy.deepcopy(ema)), ask=dict(ema=copy.deepcopy(ema))))


def decode(value, version=8):
    return probe.decode_state(value, "maker", "5", "venue.perp.coin_usdt", version, 2100, 1000)


class FillProbeTests(unittest.TestCase):
    def test_original_snapshot_conversion_and_schema_default_only(self):
        result = decode(state())["bid"]
        self.assertAlmostEqual(result["actualEma"], -math.expm1(-.01))
        self.assertAlmostEqual(result["theoreticalEma"], -math.expm1(-.005))
        self.assertAlmostEqual(result["baseTheoreticalEma"], -math.expm1(-.02))
        self.assertEqual(result["ca"], 1)
        self.assertNotIn("observedAt", result)
        for field in ("hit_ema", "exposure_ema_seconds", "base_model_hazard_ema", "model_hazard_ema"):
            value = state(); del value["side_states"]["bid"]["ema"][field]
            with self.assertRaises(ValueError): decode(value)

    def test_exposure_and_trials_are_not_interchangeable(self):
        self.assertEqual(decode(state(9), 9)["bid"]["clock"], "trials")
        with self.assertRaises(ValueError): decode(state(9), 8)
        value = state(9); value["side_states"]["bid"]["ema"]["trials_since_adjustment"] = 1.5
        with self.assertRaises(ValueError): decode(value, 9)

    def test_invalid_identity_time_and_mass_fail_closed(self):
        for key, bad in (("symbol", "other"), ("instance_id", "6"), ("saved_at_ms", 999), ("saved_at_ms", 99999), ("enabled", None)):
            value = state(); value[key] = bad
            with self.assertRaises(ValueError): decode(value)
        for field, bad in (("hit_ema", -1), ("model_hazard_ema", float("nan")), ("exposure_since_adjustment_seconds", 100)):
            value = state(); value["side_states"]["bid"]["ema"][field] = bad
            with self.assertRaises(ValueError): decode(value)

    def test_zero_hits_are_real_but_zero_exposure_is_not_ready(self):
        value = state(); value["side_states"]["bid"]["ema"]["hit_ema"] = 0
        self.assertEqual(decode(value)["bid"]["actualEma"], 0)
        for field in value["side_states"]["bid"]["ema"]: value["side_states"]["bid"]["ema"][field] = 0
        result = decode(value)["bid"]
        self.assertIsNone(result["actualEma"])
        self.assertEqual(result["reason"], "no-exposure")

    def test_current_ca_is_not_applied_to_historical_base_ema(self):
        value = state(); value["side_states"]["bid"]["ema"]["log_a_multiplier"] = 100
        result = decode(value)["bid"]
        self.assertEqual(result["logCa"], 10)
        self.assertAlmostEqual(result["ca"], math.exp(10))
        self.assertAlmostEqual(result["theoreticalEma"], -math.expm1(-.005))

    def test_exact_filekv_key_checksum_size_and_expiry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); key = "cache:mm:target_fill_feedback:maker:5:symbol:venue.perp.coin_usdt"
            encoded = key.encode().hex(); folder = root
            while len(encoded) > 120: folder /= "p"+encoded[:120]; encoded = encoded[120:]
            file = folder/("k"+encoded)/"current"; file.parent.mkdir(parents=True)
            raw = json.dumps(state()).encode(); checksum = 14695981039346656037
            for byte in raw: checksum = (checksum ^ byte)*1099511628211 & ((1<<64)-1)
            file.write_bytes(b"FKV00001S"+struct.pack("<QQQ", 0, len(raw), checksum)+raw)
            self.assertEqual(probe.filekv(root, key, 2100)["version"], 8)
            file.write_bytes(b"FKV00001S"+struct.pack("<QQQ", 2000, len(raw), checksum)+raw)
            with self.assertRaises(ValueError): probe.filekv(root, key, 2100)
            file.write_bytes(b"FKV00001S"+struct.pack("<QQQ", 0, len(raw), checksum+1)+raw)
            with self.assertRaises(ValueError): probe.filekv(root, key, 2100)

    def test_only_current_maker_units_define_exact_keys(self):
        dynamic = {"portfolio_params": {"unit_params": {"acct": {"venue.perp.coin_usdt": {"mode": "maker"}, "venue.perp.other_usdt": {"mode": "close_only"}}}}}
        self.assertEqual(probe.expected(dynamic), [dict(account="acct",exchange="venue",market="perp",symbol="venue.perp.coin_usdt")])

    def test_current_missing_key_never_falls_back_to_retained_trial_state(self):
        with tempfile.TemporaryDirectory() as directory:
            setting = Path(directory)/"atom_setting.json"
            setting.write_text(json.dumps(dict(system=dict(cache_redis="redis://private"), strategy=dict(params=dict(instance_id="5")))))
            class Client:
                def mget(self, keys):
                    self.keys = keys
                    return [json.dumps(dict(ts=2100, strategy="maker", strategy_idx="5", pid=123, type="hb", success=True, reporter_started_at_ms=1500)),
                            json.dumps(dict(portfolio_params=dict(unit_params={"acct": {"venue.perp.coin_usdt": dict(mode="maker")}})))]
                def close(self): pass
            client = Client(); config = dict(id="primary", strategies=[dict(name="maker", setting=str(setting), sourceSha="a"*40, feedbackVersion=8)])
            with patch.object(probe, "identity", return_value=(123,"a"*40,1000)), patch.object(probe, "filekv", side_effect=FileNotFoundError) as read:
                result = probe.collect(config, lambda *args, **kwargs: client)
            self.assertEqual(client.keys,["heartbeat:strategy:maker","cache:strategy:maker"])
            self.assertEqual(read.call_count,1)
            self.assertEqual(read.call_args.args[1],"cache:mm:target_fill_feedback:maker:5:symbol:venue.perp.coin_usdt")
            self.assertTrue(all(row["reason"]=="cache-not-exported" and row["actualEma"] is None for row in result["rows"]))


if __name__ == "__main__": unittest.main()
