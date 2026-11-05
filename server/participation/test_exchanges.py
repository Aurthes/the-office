import unittest
from unittest.mock import AsyncMock
from exchanges import Reader


class OrderClassFields(unittest.IsolatedAsyncioTestCase):
    async def test_gate_spot_uses_actual_spot_field(self):
        reader = Reader("test-region")
        reader.get = AsyncMock(return_value={"time_in_force": "poc", "tif": "rpi"})
        self.assertEqual(await reader.order_type("account", "gate", "spot", "123", "XRP_USDT"), "non-rpi")
        reader.get.assert_awaited_once_with("gate", "/spot/orders/123", {"currency_pair": "XRP_USDT"}, "account")

    async def test_gate_perpetual_keeps_its_own_field(self):
        reader = Reader("test-region")
        reader.get = AsyncMock(return_value={"tif": "rpi", "time_in_force": "ioc"})
        self.assertEqual(await reader.order_type("account", "gate", "perp", "123", "BTC_USDT"), "rpi")

    async def test_missing_or_unknown_spot_class_is_not_guessed(self):
        reader = Reader("test-region")
        for response in [{"tif": "rpi"}, {"time_in_force": "new-type"}]:
            reader.get = AsyncMock(return_value=response)
            self.assertIsNone(await reader.order_type("account", "gate", "spot", "123", "XRP_USDT"))

    async def test_bybit_matches_the_requested_order(self):
        reader = Reader("test-region")
        reader.get = AsyncMock(return_value={"list": [{"orderId": "other", "timeInForce": "GTC"}, {"orderId": "123", "timeInForce": "RPI"}]})
        self.assertEqual(await reader.order_type("account", "bybit", "linear", "123", "BTCUSDT"), "rpi")


if __name__ == "__main__":
    unittest.main()
