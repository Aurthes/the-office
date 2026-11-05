#!/usr/bin/env python3
"""Independent hourly participation collector; never submits exchange commands."""
import argparse
import asyncio
from collections import OrderedDict
import json
import signal
import time
from pathlib import Path

from exchanges import Reader, timestamp
from store import Store, HOUR, floor_hour


def now_ms():
    return int(time.time() * 1000)


def report(event, **fields):
    # Never log exception messages, request headers, Redis URLs or credentials.
    print(json.dumps(dict(event=event, at=now_ms(), **fields)), flush=True)


class TradeJoin:
    def __init__(self, store, ttl_ms=90_000, limit=500_000):
        self.store, self.ttl, self.limit = store, ttl_ms, limit
        self.seen = OrderedDict()

    def expire(self, now):
        while self.seen:
            key, r = next(iter(self.seen.items()))
            if r[0] > now:
                break
            self.seen.pop(key)
            if r[2] and not r[1]:
                self.store.invalidate(key[0], floor_hour(r[3][0]), "过滤流有成交但总流缺失")

    def add(self, instrument, identity, ts, amount, kind, now):
        symbol, exchange = instrument["symbol"], instrument["exchange"]
        if not identity or amount <= 0 or ts > now + 5000:
            raise ValueError("invalid public execution")
        if now >= floor_hour(ts) + HOUR + self.store.settle_ms:
            self.store.invalidate(symbol, floor_hour(ts), "行情迟到超过结算窗口")
        self.expire(now)
        key = (symbol, str(identity))
        r = self.seen.get(key)
        if exchange == "bybit":
            if r:
                if r[3] != (ts, amount, kind):
                    self.store.invalidate(symbol, floor_hour(ts), "同一成交ID记录不一致")
                return
            self.seen[key] = [now + self.ttl, True, True, (ts, amount, kind)]
            self.store.market_add(symbol, exchange, ts, kind, amount)
        else:
            payload = (ts, amount)
            if r is None:
                r = [now + self.ttl, False, False, payload]
                self.seen[key] = r
            if r[3] != payload:
                self.store.invalidate(symbol, floor_hour(ts), "总流与过滤流成交记录不一致")
                return
            filtered = kind == "non-rpi"
            if r[2 if filtered else 1]:
                return
            if filtered:
                r[2] = True
                if r[1]:
                    self.store.market_add(symbol, exchange, ts, "rpi", -amount, -1)
                    self.store.market_add(symbol, exchange, ts, "non-rpi", amount)
            else:
                r[1] = True
                self.store.market_add(symbol, exchange, ts, "non-rpi" if r[2] else "rpi", amount)
        while len(self.seen) > self.limit:
            old_key, old = self.seen.popitem(last=False)
            self.store.invalidate(old_key[0], floor_hour(old[3][0]), "行情去重缓存容量不足")


class Collector:
    def __init__(self, config):
        self.config = config
        self.store = Store(config["state_dir"])
        self.reader = Reader(config.get("aws_region", "ap-northeast-1"))
        self.join = TradeJoin(self.store)
        self.instruments = {}
        self.routes = []
        self.stop = asyncio.Event()
        self.private_slots = asyncio.Semaphore(3)

    async def refresh_scope(self):
        def read():
            import redis
            routes = set()
            for strategy in self.config["strategies"]:
                cfg = json.loads(Path(strategy["setting"]).read_text())
                client = redis.Redis.from_url(cfg["system"]["cache_redis"], socket_connect_timeout=3, socket_timeout=3)
                try:
                    blob = client.get("cache:strategy:" + strategy["name"])
                finally:
                    client.close()
                dynamic = json.loads(blob)
                for account, units in dynamic["portfolio_params"]["unit_params"].items():
                    for symbol in units:
                        venue, product, pair = symbol.split(".", 2)
                        if venue not in ("bybit", "gateio") or product not in ("perp", "spot") or pair.rsplit("_", 1)[-1] not in ("usdt", "usdc"):
                            raise ValueError("unsupported selected symbol")
                        exchange = "bybit" if venue == "bybit" else "gate"
                        category = "linear" if exchange == "bybit" and product == "perp" else product
                        routes.add((account, symbol, exchange, category))
            return routes
        routes = await asyncio.to_thread(read)
        for exchange, category in sorted({(e, c) for _, _, e, c in routes}):
            instruments = await self.reader.instruments(exchange, category)
            for _, symbol, e, c in routes:
                if (e, c) == (exchange, category):
                    if symbol not in instruments:
                        raise ValueError("selected instrument not found")
                    self.instruments[symbol] = instruments[symbol]
        self.routes = [dict(account=a, symbol=s, exchange=e, category=c) for a, s, e, c in sorted(routes)]
        self.store.set_routes(self.routes, now_ms())
        report("scope", accounts=len({r["account"] for r in self.routes}), symbols=len(self.instruments), units=len(self.routes))

    async def public(self, exchange, category):
        from websockets.asyncio.client import connect
        if exchange == "bybit":
            url = "wss://stream.bybit.com/v5/public/" + category
        else:
            url = "wss://fx-ws.gateio.ws/v4/ws/usdt" if category == "perp" else "wss://api.gateio.ws/ws/v4/"
        prefix = "futures" if category == "perp" else "spot"
        while not self.stop.is_set():
            subscribed, acknowledged, pending = set(), {}, {}
            try:
                headers = {"X-Gate-Size-Decimal": "1"} if exchange == "gate" else None
                async with connect(url, additional_headers=headers, open_timeout=10, ping_interval=20, ping_timeout=15, max_size=8 * 1024 * 1024, max_queue=64) as ws:
                    last_ping, counter = 0, 0
                    while not self.stop.is_set():
                        wanted = {i["native"]: i for i in self.instruments.values() if (i["exchange"], i["category"]) == (exchange, category)}
                        additions = sorted(set(wanted) - subscribed)
                        for offset in range(0, len(additions), 10):
                            batch = additions[offset:offset + 10]
                            if exchange == "bybit":
                                counter += 1
                                identity = str(counter)
                                pending[identity] = (now_ms(), batch)
                                await ws.send(json.dumps({"op": "subscribe", "req_id": identity, "args": ["publicTrade." + n for n in batch]}))
                            else:
                                for channel in (prefix + ".trades", prefix + ".f_trades"):
                                    await ws.send(json.dumps({"time": int(time.time()), "channel": channel, "event": "subscribe", "payload": batch}))
                                for n in batch:
                                    pending[n] = (now_ms(), [n])
                            subscribed.update(batch)
                            await asyncio.sleep(.05)
                        if any(now_ms() - t > 20_000 for t, _ in pending.values()):
                            raise TimeoutError("subscription acknowledgement missing")
                        if time.monotonic() - last_ping > 20:
                            await ws.send(json.dumps({"op": "ping"} if exchange == "bybit" else {"time": int(time.time()), "channel": prefix + ".ping"}))
                            last_ping = time.monotonic()
                        try:
                            message = json.loads(await asyncio.wait_for(ws.recv(), 1))
                        except asyncio.TimeoutError:
                            continue
                        if message.get("error") or message.get("success") is False:
                            raise ValueError("public subscription rejected")
                        if exchange == "bybit" and message.get("op") == "subscribe":
                            _, names = pending.pop(str(message["req_id"]))
                            for n in names:
                                self.store.connect(wanted[n]["symbol"], now_ms())
                        elif exchange != "bybit" and message.get("event") == "subscribe":
                            if message.get("result", {}).get("status") != "success":
                                raise ValueError("public subscription rejected")
                            for n in message.get("payload", []):
                                acknowledged.setdefault(n, set()).add(message["channel"])
                                if len(acknowledged[n]) == 2:
                                    pending.pop(n, None)
                                    self.store.connect(wanted[n]["symbol"], now_ms())
                        elif exchange == "bybit" and message.get("topic", "").startswith("publicTrade."):
                            for r in message["data"]:
                                instrument = wanted[r["s"]]
                                if type(r.get("RPI")) is not bool:
                                    self.store.invalidate(instrument["symbol"], floor_hour(int(r["T"])), "公开成交未提供RPI分类")
                                    continue
                                self.join.add(instrument, r["i"], int(r["T"]), float(r["p"]) * float(r["v"]), "rpi" if r["RPI"] else "non-rpi", now_ms())
                        elif exchange != "bybit" and message.get("event") == "update" and message.get("channel") in (prefix + ".trades", prefix + ".f_trades"):
                            records = message["result"]
                            for r in records if isinstance(records, list) else [records]:
                                native = r.get("contract") if category == "perp" else r.get("currency_pair")
                                instrument = wanted[native]
                                amount = float(r["price"]) * abs(float(r["size"] if category == "perp" else r["amount"])) * instrument["multiplier"]
                                kind = "non-rpi" if message["channel"].endswith(".f_trades") else "rpi"
                                self.join.add(instrument, r["id"], timestamp(r), amount, kind, now_ms())
            except asyncio.CancelledError:
                raise
            except Exception as error:
                report("public_retry", exchange=exchange, category=category, error=type(error).__name__)
            finally:
                self.store.disconnect([i["symbol"] for i in self.instruments.values() if (i["exchange"], i["category"]) == (exchange, category)], now_ms())
            await asyncio.sleep(3)

    async def private_once(self, account, exchange, category):
        async with self.private_slots:
            end = now_ms() - 5000
            cursor = self.store.cursor(account, category)
            start = max(floor_hour(end) - HOUR, cursor - 120_000) if cursor else floor_hour(end)
            instruments = {i["native"]: i for i in self.instruments.values() if (i["exchange"], i["category"]) == (exchange, category)}
            scoped = {r["symbol"] for r in self.routes if r["account"] == account}
            # Keep earlier hourly scope during dynamic removal and pending fills.
            scoped.update(s for (s,) in self.store.db.execute("SELECT DISTINCT symbol FROM scope WHERE account=? AND hour>=?", (account, floor_hour(end) - HOUR)))
            rows = await self.reader.executions(account, exchange, category, start, end)
            for r in rows:
                native = r["symbol"] if exchange == "bybit" else r["contract"] if category == "perp" else r["currency_pair"]
                i = instruments.get(native)
                if not i or i["symbol"] not in scoped:
                    continue
                ts = int(r["execTime"]) if exchange == "bybit" else timestamp(r)
                identity = r["execId"] if exchange == "bybit" else r.get("trade_id", r.get("id"))
                order = r["orderId"] if exchange == "bybit" else r["order_id"]
                amount = abs(float(r.get("execValue") or float(r["execPrice"]) * float(r["execQty"]))) if exchange == "bybit" else float(r["price"]) * abs(float(r["size"] if category == "perp" else r["amount"])) * i["multiplier"]
                self.store.own_add(account, category, identity, order, i["symbol"], ts, amount, self.store.order_class(account, category, order))
            self.store.private_covered(account, category, start, end)
            pending = list(self.store.db.execute("SELECT DISTINCT order_id,symbol FROM seen WHERE account=? AND category=? AND kind IS NULL ORDER BY hour DESC LIMIT 200", (account, category)))
            for order, symbol in pending:
                try:
                    kind = await self.reader.order_type(account, exchange, category, order, self.instruments[symbol]["native"])
                    self.store.remember_order(account, category, order, kind, now_ms())
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    report("order_type_pending", account=account, error=type(error).__name__)

    async def private_loop(self):
        while not self.stop.is_set():
            keys = sorted({(r["account"], r["exchange"], r["category"]) for r in self.routes})
            results = await asyncio.gather(*(self.private_once(*key) for key in keys), return_exceptions=True)
            for key, result in zip(keys, results):
                if isinstance(result, BaseException):
                    report("private_retry", account=key[0], category=key[2], error=type(result).__name__)
            await asyncio.sleep(self.config.get("poll_seconds", 30))

    async def run(self):
        await self.refresh_scope()
        tasks = [asyncio.create_task(self.public(e, c)) for e, c in (("bybit", "linear"), ("bybit", "spot"), ("gate", "perp"), ("gate", "spot"))]
        tasks.append(asyncio.create_task(self.private_loop()))
        next_scope = time.monotonic() + 60
        try:
            while not self.stop.is_set():
                self.join.expire(now_ms())
                self.store.publish(now_ms())
                if time.monotonic() >= next_scope:
                    try:
                        await self.refresh_scope()
                    except Exception as error:
                        report("scope_retry", error=type(error).__name__)
                        for symbol in self.instruments:
                            self.store.invalidate(symbol, floor_hour(now_ms()), "选币范围同步失败")
                    next_scope = time.monotonic() + 60
                try:
                    await asyncio.wait_for(self.stop.wait(), 15)
                except asyncio.TimeoutError:
                    pass
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            self.store.publish(now_ms())
            self.store.close()


async def main(config):
    collector = Collector(config)
    for sig in (signal.SIGTERM, signal.SIGINT):
        asyncio.get_running_loop().add_signal_handler(sig, collector.stop.set)
    await collector.run()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    try:
        asyncio.run(main(json.loads(Path(args.config).read_text())))
    except Exception as error:
        report("fatal", error=type(error).__name__)
        raise SystemExit(1)
