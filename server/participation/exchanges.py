"""Read-only exchange adapters. Credentials stay in memory; every request is GET."""
import asyncio
import base64
import hashlib
import hmac
import json
import time
import urllib.parse
import urllib.request
from decimal import Decimal


def timestamp(row):
    if row.get("create_time_ms") is not None:
        return int(Decimal(str(row["create_time_ms"])))
    return int(Decimal(str(row["create_time"])) * 1000)


def credentials(account, region):
    import boto3
    session = boto3.Session(region_name=region)
    encrypted = session.client("secretsmanager").get_secret_value(SecretId="exApi/" + account.replace(".", "/"))["SecretString"]
    plain = session.client("kms").decrypt(CiphertextBlob=base64.b64decode(encrypted))["Plaintext"]
    return json.loads(plain)


class Reader:
    def __init__(self, region):
        self.region = region
        self.creds = {}
        self.lock = asyncio.Lock()
        self.next_request = 0
        self.metadata = {}

    async def get(self, exchange, path, params=None, account=None):
        if account and account not in self.creds:
            self.creds[account] = await asyncio.to_thread(credentials, account, self.region)
        # Small, bounded read load shared across all account requests.
        async with self.lock:
            await asyncio.sleep(max(0, self.next_request - time.monotonic()))
            self.next_request = time.monotonic() + .15
        query = urllib.parse.urlencode(params or {})
        headers = {"Accept": "application/json", "User-Agent": "hourly-participation/1"}
        if exchange == "bybit":
            host = "https://api.bybit.com"
            if account:
                c = self.creds[account]
                ts = str(int(time.time() * 1000))
                sign = hmac.new(c["api_secret"].encode(), (ts + c["api_key"] + "5000" + query).encode(), hashlib.sha256).hexdigest()
                headers.update({"X-BAPI-API-KEY": c["api_key"], "X-BAPI-TIMESTAMP": ts, "X-BAPI-RECV-WINDOW": "5000", "X-BAPI-SIGN": sign})
        else:
            host = "https://api.gateio.ws"
            path = "/api/v4" + path
            headers["X-Gate-Size-Decimal"] = "1"
            if account:
                c = self.creds[account]
                ts = str(int(time.time()))
                raw = "\n".join(["GET", path, query, hashlib.sha512(b"").hexdigest(), ts])
                headers.update({"KEY": c["api_key"], "Timestamp": ts, "SIGN": hmac.new(c["api_secret"].encode(), raw.encode(), hashlib.sha512).hexdigest()})
        request = urllib.request.Request(host + path + ("?" + query if query else ""), headers=headers, method="GET")

        def fetch():
            with urllib.request.urlopen(request, timeout=12) as response:
                body = response.read(16 * 1024 * 1024 + 1)
                if len(body) > 16 * 1024 * 1024:
                    raise ValueError("response too large")
                return json.loads(body)
        value = await asyncio.to_thread(fetch)
        if exchange == "bybit":
            if value.get("retCode") != 0:
                raise RuntimeError("Bybit API code " + str(value.get("retCode")))
            return value["result"]
        if isinstance(value, dict) and value.get("label"):
            raise RuntimeError("Gate API rejected request")
        return value

    async def instruments(self, exchange, category):
        key = (exchange, category)
        if key in self.metadata:
            return self.metadata[key]
        result = {}
        if exchange == "bybit":
            cursor = ""
            while True:
                params = {"category": category, "limit": 1000}
                if cursor:
                    params["cursor"] = cursor
                data = await self.get(exchange, "/v5/market/instruments-info", params)
                for r in data["list"]:
                    if category == "linear" and "Perpetual" not in r.get("contractType", ""):
                        continue
                    symbol = f"bybit.{'perp' if category == 'linear' else 'spot'}.{r['baseCoin'].lower()}_{r['quoteCoin'].lower()}"
                    result[symbol] = {"symbol": symbol, "exchange": exchange, "category": category, "native": r["symbol"], "multiplier": 1.0}
                cursor = data.get("nextPageCursor", "")
                if not cursor:
                    break
        else:
            rows = await self.get(exchange, "/futures/usdt/contracts" if category == "perp" else "/spot/currency_pairs")
            for r in rows:
                native = r["name"] if category == "perp" else r["id"]
                symbol = f"gateio.{category}.{native.lower()}"
                result[symbol] = {"symbol": symbol, "exchange": exchange, "category": category, "native": native, "multiplier": float(r["quanto_multiplier"]) if category == "perp" else 1.0}
        self.metadata[key] = result
        return result

    async def executions(self, account, exchange, category, start, end):
        """Return a fully paginated fixed window, or raise without advancing coverage."""
        rows = []
        if exchange == "bybit":
            cursor = ""
            cursors = set()
            for _ in range(1000):
                params = {"category": category, "startTime": start, "endTime": end - 1, "limit": 100}
                if cursor:
                    params["cursor"] = cursor
                data = await self.get(exchange, "/v5/execution/list", params, account)
                rows.extend(r for r in data["list"] if r.get("execType") in ("Trade", "BlockTrade"))
                cursor = data.get("nextPageCursor", "")
                if not cursor:
                    return rows
                if cursor in cursors:
                    raise ValueError("repeated execution cursor")
                cursors.add(cursor)
        else:
            for page in range(1, 102):
                params = {"from": start // 1000, "to": (end - 1) // 1000, "limit": 1000}
                if category == "perp":
                    params["offset"] = (page - 1) * 1000
                    path = "/futures/usdt/my_trades_timerange"
                else:
                    params["page"] = page
                    path = "/spot/my_trades"
                data = await self.get(exchange, path, params, account)
                if not isinstance(data, list):
                    raise ValueError("invalid execution response")
                rows.extend(r for r in data if start <= timestamp(r) < end)
                if len(data) < 1000:
                    return rows
        raise ValueError("execution pagination exceeded bound")

    async def order_type(self, account, exchange, category, order_id, native):
        if exchange == "bybit":
            result = await self.get(exchange, "/v5/order/history", {"category": category, "orderId": str(order_id), "limit": 1}, account)
            rows = [r for r in result["list"] if str(r["orderId"]) == str(order_id)]
            tif = rows[0].get("timeInForce") if rows else None
            valid = {"RPI", "GTC", "IOC", "FOK", "PostOnly"}
        else:
            path = f"/futures/usdt/orders/{urllib.parse.quote(str(order_id), safe='')}" if category == "perp" else f"/spot/orders/{urllib.parse.quote(str(order_id), safe='')}"
            result = await self.get(exchange, path, {"currency_pair": native} if category == "spot" else {}, account)
            tif = result.get("time_in_force" if category == "spot" else "tif")
            valid = {"rpi", "gtc", "ioc", "fok", "poc"}
        return "rpi" if tif in ("RPI", "rpi") else "non-rpi" if tif in valid else None
