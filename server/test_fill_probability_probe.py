import copy
import gzip
import base64
import os
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

    def test_valid_log_space_state_survives_multiplier_overflow(self):
        value=state();value["a_multiplier_min"]=-1000;value["a_multiplier_max"]=1000
        value["side_states"]["bid"]["ema"].update(log_a_multiplier=740,hit_ema=1,exposure_ema_seconds=1,base_model_hazard_ema=1e-323)
        result=decode(value)["bid"]
        self.assertIsNone(result["ca"]);self.assertEqual(result["logCa"],740)
        self.assertAlmostEqual(result["actualEma"],-math.expm1(-1))

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
                            json.dumps(dict(portfolio_params=dict(unit_params={"acct": {"venue.perp.coin_usdt": dict(mode="maker")}}))), None]
                def close(self): pass
            client = Client(); config = dict(id="primary", strategies=[dict(name="maker", setting=str(setting), sourceSha="a"*40, feedbackVersion=8)])
            with patch.object(probe, "identity", return_value=(123,"a"*40,1000)), patch.object(probe, "filekv", side_effect=FileNotFoundError) as read:
                result = probe.collect(config, lambda *args, **kwargs: client)
            self.assertEqual(client.keys,["heartbeat:strategy:maker","cache:strategy:maker","cache:mm:fill_probability_observation:maker:5"])
            self.assertEqual(read.call_count,1)
            self.assertEqual(read.call_args.args[1],"cache:mm:target_fill_feedback:maker:5:symbol:venue.perp.coin_usdt")
            self.assertTrue(all(row["reason"]=="cache-not-exported" and row["actualEma"] is None for row in result["rows"]))

    def test_original_readiness_and_observation_time_are_not_save_time(self):
        value=state()
        for side in ("bid","ask"):
            value["side_states"][side].update(observation_schema=1,observation=dict(
                at_ms=1500,ready=True,enabled=True,skip_reason="",
                actual_probability_1s=-math.expm1(-.01),theoretical_probability_1s=-math.expm1(-.005),applied_log_ca=0))
        row=decode(value)["bid"]
        self.assertEqual(row["observedAt"],1500);self.assertEqual(row["savedAt"],2000);self.assertTrue(row["ready"])
        value["side_states"]["bid"]["observation"]["at_ms"]=0
        self.assertIsNone(decode(value)["bid"]["observedAt"])
        value["side_states"]["bid"]["observation"]["at_ms"]=99999
        self.assertNotIn("ready",decode(value)["bid"])

    def test_quote_envelope_is_exact_account_pid_and_export_scoped(self):
        q={key:None for key in (*probe.QUOTE_NUMBERS,*probe.QUOTE_BOOLS)}
        q.update({key:"unchanged" for key in probe.QUOTE_STATES})
        q.update(available=True,at=2000,exportedAt=2100,baseTarget=.001,quoted=True,finalProbability=.001,guardReason=None)
        envelope=dict(observation_schema=1,strategy="maker",instance_id="5",exported_at_ms=2100,pid=123,
                      rows=[dict(account="acct",symbol="venue.perp.coin_usdt",bid=q,ask=q)])
        result=probe.decode_quotes(envelope,"maker","5",123,2200,1000)
        self.assertEqual(result[("acct","venue.perp.coin_usdt")]["bid"]["finalProbability"],.001)
        self.assertNotIn(("other","venue.perp.coin_usdt"),result)
        for field,bad in (("pid",999),("strategy","other"),("observation_schema",9)):
            changed=copy.deepcopy(envelope);changed[field]=bad
            with self.assertRaises(ValueError):probe.decode_quotes(changed,"maker","5",123,2200,1000)
        changed=copy.deepcopy(envelope);changed["rows"][0]["bid"]["quoted"]=False
        with self.assertRaises(ValueError):probe.decode_quotes(changed,"maker","5",123,2200,1000)

    def test_projection_whitelist_before_any_source_read_and_missing_not_null(self):
        required = {"id", "producer", "strategy", "instance", "account", "exchange", "market", "symbol", "side", "sourceSha", "pid", "heartbeatAt", "savedAt", "observedAt", "schema", "clock", "enabled", "weightedExposureSeconds", "ready", "error", "reason", "skipReason", "target"}
        quote = {"available", "at", "exportedAt", "baseTarget", "currentCaProbability"}
        p=dict(row=sorted(required|{"actualEma"}),quote=sorted(quote|{"ca"}))
        self.assertEqual(probe.validate_projection(p),p)
        row={k:None for k in p["row"]};row.update(actualEma=0,quote={k:None for k in p["quote"]})
        self.assertEqual(probe.project_rows([row],p)[0]["actualEma"],0)
        missing=copy.deepcopy(row);del missing["observedAt"]
        with self.assertRaises(KeyError):probe.project_rows([missing],p)
        for bad in [dict(row=["actualEma"],quote=p["quote"]),dict(row=p["row"]+["password"],quote=p["quote"]),dict(row=p["row"],quote=["ca"]),dict(row=p["row"]*2,quote=p["quote"])]:
            with self.assertRaises(ValueError):probe.collect(dict(projection=bad),lambda *a,**k:self.fail("must reject before Redis"))

    def test_gzip_wire_roundtrip_crc_and_both_size_caps(self):
        reply=dict(version=1,rows=[dict(actualEma=0,quote=None)])
        wire=probe.encode_reply(reply,True)
        self.assertEqual(json.loads(gzip.decompress(wire)),reply)
        self.assertEqual(probe.encode_reply(reply),json.dumps(reply,allow_nan=False,separators=(",",":")).encode()+b"\n")
        with self.assertRaises(ValueError):probe.encode_reply(dict(data="x"*(4*1024*1024)))
        with self.assertRaises(ValueError):probe.encode_reply(dict(data=base64.b64encode(os.urandom(2*1024*1024+8192)).decode()),True)


if __name__ == "__main__": unittest.main()
