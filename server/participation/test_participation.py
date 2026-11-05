import tempfile
import unittest

from collector import TradeJoin
from exchanges import timestamp
from store import Store, HOUR

SYMBOL = "bybit.perp.btc_usdt"
ROUTES = [dict(account="one", symbol=SYMBOL, exchange="bybit"), dict(account="two", symbol=SYMBOL, exchange="bybit")]


class HourlyFacts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(self.temp.name, now_ms=0)
        self.store.set_routes(ROUTES, 0)

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def complete(self):
        self.store.connect(SYMBOL, 0)
        for a in ("one", "two"):
            self.store.private_covered(a, "linear", 0, HOUR)
        self.store.publish(HOUR + 120_001)
        return self.store.snapshot(0, HOUR + 120_001)

    def test_pending_classification_and_exact_execution_dedup(self):
        args = ("one", "linear", "fill1", "order1", SYMBOL, 1000, 50, None)
        self.assertTrue(self.store.own_add(*args))
        self.assertFalse(self.store.own_add(*args))
        self.assertFalse(self.complete()["own"][0]["ready"])
        self.store.remember_order("one", "linear", "order1", "rpi", HOUR)
        self.store.remember_order("one", "linear", "order1", "rpi", HOUR)
        row = self.complete()["own"][0]
        self.assertEqual((row["notional"], row["count"], row["ready"]), (50, 1, True))

    def test_market_is_not_multiplied_by_account_count_and_zero_is_valid(self):
        self.store.market_add(SYMBOL, "bybit", 1000, "rpi", 100)
        snap = self.complete()
        self.assertEqual(len(snap["market"]), 2)
        self.assertEqual(snap["market"][0]["notional"], 100)
        self.assertTrue(all(r["ready"] and r["count"] == 0 for r in snap["own"]))

    def test_partial_start_and_reconnect_do_not_claim_full_coverage(self):
        self.store.connect(SYMBOL, 1)
        self.store.publish(HOUR + 120_001)
        self.assertFalse(self.store.snapshot(0, HOUR + 120_001)["market"][0]["ready"])
        self.store.disconnect([SYMBOL], HOUR + 10_000)
        self.store.connect(SYMBOL, HOUR + 20_000)
        self.store.publish(2 * HOUR + 120_001)
        self.assertFalse(self.store.snapshot(HOUR, 2 * HOUR + 120_001)["market"][0]["ready"])

    def test_restart_retains_facts_and_dedup_but_invalidates_interrupted_hour(self):
        self.store.own_add("one", "linear", "fill", "order", SYMBOL, 1000, 10, "rpi")
        self.store.market_add(SYMBOL, "bybit", 1000, "rpi", 100)
        self.store.connect(SYMBOL, 0)
        self.store.publish(5000)
        self.store.close()
        self.store = Store(self.temp.name, now_ms=6000)
        self.store.set_routes(ROUTES, 6000)
        self.store.connect(SYMBOL, 6000)
        self.assertFalse(self.store.own_add("one", "linear", "fill", "order", SYMBOL, 1000, 10, "rpi"))
        self.store.publish(HOUR + 120_001)
        snap = self.store.snapshot(0, HOUR + 120_001)
        self.assertEqual(snap["own"][0]["count"], 1)
        self.assertEqual(snap["market"][0]["notional"], 100)
        self.assertFalse(snap["market"][0]["ready"])

    def test_private_gap_cannot_be_hidden_by_min_max(self):
        self.store.private_covered("one", "linear", 0, 1000)
        self.store.private_covered("one", "linear", 2000, HOUR)
        self.assertFalse(self.store.snapshot(0, HOUR + 120_001)["own"][0]["ready"])
        self.store.private_covered("one", "linear", 0, HOUR)
        self.assertTrue(self.store.snapshot(0, HOUR + 120_001)["own"][0]["ready"])

    def test_no_ratio_before_settlement(self):
        self.store.connect(SYMBOL, 0)
        self.store.publish(HOUR)
        self.assertFalse(self.store.snapshot(0, HOUR + 119_999)["market"][0]["ready"])
        self.assertTrue(self.store.snapshot(0, HOUR + 120_000)["market"][0]["ready"])

    def test_gate_difference_is_order_independent_and_deduplicated(self):
        i = dict(symbol="gateio.perp.btc_usdt", exchange="gate")
        join = TradeJoin(self.store)
        for identity, kinds in [("a", ["rpi", "non-rpi"]), ("b", ["non-rpi", "rpi"]), ("c", ["rpi"])]:
            for kind in kinds * 2:
                join.add(i, identity, 1000, 100, kind, 2000)
        self.assertEqual(self.store.market[(0, i["symbol"], "rpi")][1:], [100, 1])
        self.assertEqual(self.store.market[(0, i["symbol"], "non-rpi")][1:], [200, 2])

    def test_gate_orphan_and_overflow_mark_unknown(self):
        i = dict(symbol="gateio.perp.btc_usdt", exchange="gate")
        join = TradeJoin(self.store, ttl_ms=100, limit=1)
        join.add(i, "orphan", 1000, 100, "non-rpi", 2000)
        join.expire(2101)
        self.assertIn("总流缺失", self.store.db.execute("SELECT reason FROM coverage WHERE symbol=?", (i["symbol"],)).fetchone()[0])
        join.add(i, "1", 1000, 100, "rpi", 2200)
        join.add(i, "2", 1000, 100, "rpi", 2200)
        self.assertIn("容量", self.store.db.execute("SELECT reason FROM coverage WHERE symbol=?", (i["symbol"],)).fetchone()[0])

    def test_gate_fractional_timestamps_preserve_hour_boundary(self):
        self.assertEqual(timestamp({"create_time_ms": "3599999.999"}), HOUR - 1)
        self.assertEqual(timestamp({"create_time": "3600.001"}), HOUR + 1)


if __name__ == "__main__":
    unittest.main()
