import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location("capacity_probe",Path(__file__).with_name("rate-limit-capacity-probe.py"))
probe=importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class CapacityProbeTests(unittest.TestCase):
    def test_only_mget_known_keys_and_sanitize_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            setting=Path(directory)/"setting.json"
            setting.write_text(json.dumps({"system":{"cache_redis":"redis://private:secret@localhost"}}))
            config={"id":"primary","strategies":[{"name":"maker","setting":str(setting)}]}
            calls=[]
            class Client:
                def mget(self,keys):
                    calls.append(keys)
                    hb={"ts":123,"strategy":"maker","type":"hb","success":True,"private":"secret",
                        "rate_limit_capacity_schema":1,"rate_limit_capacity":[{"exchange":"gateio","account":"one","market":"spot","state":"low","low_capacity":True,"limit":10,"secret":"secret"}]}
                    dynamic={"portfolio_params":{"unit_params":{"one":{"gateio.spot.btc_usdt":{},"gateio.perp.btc_usdt":{},"bybit.perp.btc_usdt":{}}}}}
                    return [json.dumps(hb).encode(),json.dumps(dynamic).encode()]
                def close(self):
                    pass
            result=probe.collect(config,lambda *_args,**_kwargs:Client())
            self.assertEqual(calls,[["heartbeat:strategy:maker","cache:strategy:maker"]])
            self.assertNotIn("secret",json.dumps(result))
            self.assertEqual({s["market"] for s in result["producers"][0]["expected"]},{"spot","perp"})

    def test_connection_failure_never_outputs_private_exception(self):
        with tempfile.TemporaryDirectory() as directory:
            setting=Path(directory)/"setting.json"
            setting.write_text(json.dumps({"system":{"cache_redis":"redis://private:secret@localhost"}}))
            def fail(*_args,**_kwargs):
                raise RuntimeError("redis://private:secret@localhost")
            result=probe.collect({"id":"primary","strategies":[{"name":"maker","setting":str(setting)}]},fail)
            self.assertEqual(result["producers"][0]["error"],"read-failed")
            self.assertNotIn("secret",json.dumps(result))

    def test_scalar_projection_drops_nested_unexpected_values(self):
        self.assertIsNone(probe.sanitize({"strategy":{"secret":"hidden"}})["strategy"])


if __name__=="__main__":
    unittest.main()
