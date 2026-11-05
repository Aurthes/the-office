"""Hourly facts. Market totals have one owner; account executions are deduplicated."""
import json
import math
import sqlite3
import time
from pathlib import Path

HOUR = 3_600_000
CLASSES = ("rpi", "non-rpi")


def floor_hour(ts):
    return int(ts) // HOUR * HOUR


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w") as output:
        json.dump(value, output, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    temporary.replace(path)


class Store:
    def __init__(self, directory, now_ms=None, settle_ms=120_000):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.directory / "facts.sqlite")
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value INTEGER);
        CREATE TABLE IF NOT EXISTS scope(hour INTEGER,account TEXT,symbol TEXT,exchange TEXT,
          PRIMARY KEY(hour,account,symbol));
        CREATE TABLE IF NOT EXISTS market(hour INTEGER,symbol TEXT,exchange TEXT,kind TEXT,
          amount REAL NOT NULL DEFAULT 0,n INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(hour,symbol,kind));
        CREATE TABLE IF NOT EXISTS coverage(hour INTEGER,symbol TEXT,from_ms INTEGER,to_ms INTEGER,
          reason TEXT NOT NULL DEFAULT '',PRIMARY KEY(hour,symbol));
        CREATE TABLE IF NOT EXISTS private_coverage(hour INTEGER,account TEXT,category TEXT,
          from_ms INTEGER,to_ms INTEGER,PRIMARY KEY(hour,account,category));
        CREATE TABLE IF NOT EXISTS own(hour INTEGER,account TEXT,symbol TEXT,kind TEXT,
          amount REAL NOT NULL DEFAULT 0,n INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(hour,account,symbol,kind));
        CREATE TABLE IF NOT EXISTS seen(account TEXT,category TEXT,id TEXT,hour INTEGER,
          symbol TEXT,amount REAL,kind TEXT,order_id TEXT,
          PRIMARY KEY(account,category,id));
        CREATE TABLE IF NOT EXISTS orders(account TEXT,category TEXT,id TEXT,kind TEXT,updated INTEGER,
          PRIMARY KEY(account,category,id));
        CREATE TABLE IF NOT EXISTS cursors(account TEXT,category TEXT,until_ms INTEGER,
          PRIMARY KEY(account,category));
        """)
        now = int(now_ms if now_ms is not None else time.time() * 1000)
        self.started = self.db.execute("SELECT value FROM meta WHERE key='started'").fetchone()
        self.started = self.started[0] if self.started else now
        self.db.execute("INSERT OR IGNORE INTO meta VALUES('started',?)", (now,))
        last = self.db.execute("SELECT value FROM meta WHERE key='published'").fetchone()
        if last:
            self.db.execute("UPDATE coverage SET reason='监控重连，该小时行情不完整' WHERE hour>=?", (floor_hour(last[0]),))
        self.market = {}
        for h, symbol, ex, kind, amount, n in self.db.execute("SELECT * FROM market WHERE hour>=?", (floor_hour(now) - HOUR,)):
            self.market[(h, symbol, kind)] = [ex, amount, n]
        self.connected = {}
        self.routes = set()
        self.settle_ms = settle_ms
        self.dirty = set()
        self.db.commit()

    def set_routes(self, routes, now):
        self.routes = {(r["account"], r["symbol"], r["exchange"]) for r in routes}
        self.ensure_hour(floor_hour(now))

    def ensure_hour(self, h):
        for account, symbol, exchange in self.routes:
            self.db.execute("INSERT OR IGNORE INTO scope VALUES(?,?,?,?)", (h, account, symbol, exchange))
        self.dirty.add(h)

    def connect(self, symbol, now):
        self.connected.setdefault(symbol, now)

    def disconnect(self, symbols, now, reason="行情订阅中断"):
        for symbol in symbols:
            self.connected.pop(symbol, None)
            self.invalidate(symbol, floor_hour(now), reason)
            # The last heartbeat can precede a boundary. Conservatively invalidate
            # the last minute of the preceding hour too.
            if now % HOUR < 60_000:
                self.invalidate(symbol, floor_hour(now) - HOUR, reason)

    def invalidate(self, symbol, h, reason):
        self.db.execute("INSERT INTO coverage VALUES(?,?,NULL,NULL,?) ON CONFLICT(hour,symbol) DO UPDATE SET reason=excluded.reason", (h, symbol, reason))
        self.dirty.add(h)

    def market_add(self, symbol, exchange, ts, kind, amount, count=1):
        if kind not in CLASSES or not math.isfinite(amount):
            raise ValueError("invalid market fact")
        h = floor_hour(ts)
        row = self.market.setdefault((h, symbol, kind), [exchange, 0.0, 0])
        row[1] += amount
        row[2] += count
        self.dirty.add(h)

    def order_class(self, account, category, order_id):
        row = self.db.execute("SELECT kind FROM orders WHERE account=? AND category=? AND id=?", (account, category, str(order_id))).fetchone()
        return row[0] if row else None

    def remember_order(self, account, category, order_id, kind, now):
        if kind not in CLASSES:
            return
        self.db.execute("INSERT OR REPLACE INTO orders VALUES(?,?,?,?,?)", (account, category, str(order_id), kind, now))
        pending = list(self.db.execute("SELECT id,hour,symbol,amount FROM seen WHERE account=? AND category=? AND order_id=? AND kind IS NULL", (account, category, str(order_id))))
        for identity, h, symbol, amount in pending:
            self._own_add(h, account, symbol, kind, amount)
            self.db.execute("UPDATE seen SET kind=? WHERE account=? AND category=? AND id=?", (kind, account, category, identity))

    def _own_add(self, h, account, symbol, kind, amount):
        self.db.execute("INSERT INTO own VALUES(?,?,?,?,?,1) ON CONFLICT(hour,account,symbol,kind) DO UPDATE SET amount=amount+excluded.amount,n=n+1", (h, account, symbol, kind, amount))
        self.dirty.add(h)

    def own_add(self, account, category, identity, order_id, symbol, ts, amount, kind):
        if not identity or not math.isfinite(amount) or amount <= 0 or (kind is not None and kind not in CLASSES):
            raise ValueError("invalid own execution")
        h = floor_hour(ts)
        inserted = self.db.execute("INSERT OR IGNORE INTO seen VALUES(?,?,?,?,?,?,?,?)", (account, category, str(identity), h, symbol, amount, kind, str(order_id))).rowcount
        if inserted and kind in CLASSES:
            self._own_add(h, account, symbol, kind, amount)
        self.dirty.add(h)
        return bool(inserted)

    def private_covered(self, account, category, start, end):
        for h in range(floor_hour(start), floor_hour(end - 1) + HOUR, HOUR):
            self.db.execute("""INSERT INTO private_coverage VALUES(?,?,?,?,?)
              ON CONFLICT(hour,account,category) DO UPDATE SET
              from_ms=CASE WHEN excluded.from_ms>to_ms THEN excluded.from_ms ELSE MIN(from_ms,excluded.from_ms) END,
              to_ms=MAX(to_ms,excluded.to_ms)""",
                            (h, account, category, max(h, start), min(h + HOUR, end)))
            self.dirty.add(h)
        self.db.execute("INSERT OR REPLACE INTO cursors VALUES(?,?,?)", (account, category, end))

    def cursor(self, account, category):
        row = self.db.execute("SELECT until_ms FROM cursors WHERE account=? AND category=?", (account, category)).fetchone()
        return row[0] if row else None

    def snapshot(self, h, now):
        scope = list(self.db.execute("SELECT account,symbol,exchange FROM scope WHERE hour=? ORDER BY exchange,account,symbol", (h,)))
        own = []
        market = []
        for symbol, exchange in sorted({(s, e) for _, s, e in scope}):
            coverage = self.db.execute("SELECT from_ms,to_ms,reason FROM coverage WHERE hour=? AND symbol=?", (h, symbol)).fetchone()
            covered = bool(coverage and coverage[0] is not None and coverage[0] <= h and coverage[1] >= h + HOUR and not coverage[2])
            ready = covered and now >= h + HOUR + self.settle_ms
            reason = "" if ready else coverage[2] if coverage and coverage[2] else "本小时仍在采集或行情覆盖未完整"
            for kind in CLASSES:
                r = self.market.get((h, symbol, kind))
                if r is None:
                    saved = self.db.execute("SELECT amount,n FROM market WHERE hour=? AND symbol=? AND kind=?", (h, symbol, kind)).fetchone()
                    amount, count = saved if saved else (0.0, 0)
                else:
                    amount, count = r[1:]
                if amount < -1e-7 or count < 0:
                    ready = False
                    reason = "市场分类记录不一致"
                market.append(dict(exchange=exchange, symbol=symbol, type=kind, notional=max(0.0, amount), count=max(0, count), ready=ready, reason=reason))
        for account, symbol, exchange in scope:
            category = "linear" if exchange == "bybit" and ".perp." in symbol else "perp" if ".perp." in symbol else "spot"
            coverage = self.db.execute("SELECT from_ms,to_ms FROM private_coverage WHERE hour=? AND account=? AND category=?", (h, account, category)).fetchone()
            pending = self.db.execute("SELECT COUNT(*) FROM seen WHERE hour=? AND account=? AND symbol=? AND kind IS NULL", (h, account, symbol)).fetchone()[0]
            ready = bool(coverage and coverage[0] <= h and coverage[1] >= h + HOUR and pending == 0 and now >= h + HOUR + self.settle_ms)
            reason = "" if ready else "成交订单类型待确认" if pending else "账户成交同步未完整"
            for kind in CLASSES:
                row = self.db.execute("SELECT amount,n FROM own WHERE hour=? AND account=? AND symbol=? AND kind=?", (h, account, symbol, kind)).fetchone()
                amount, count = row if row else (0.0, 0)
                own.append(dict(exchange=exchange, account=account, symbol=symbol, type=kind, notional=amount, count=count, ready=ready, reason=reason))
        return dict(version=1, hour=h, updatedAt=now, startedAt=self.started, market=market, own=own)

    def publish(self, now):
        current = floor_hour(now)
        self.ensure_hour(current)
        for symbol, since in self.connected.items():
            for h in [current - HOUR, current]:
                if since < h + HOUR:
                    self.db.execute("""INSERT INTO coverage VALUES(?,?,?,?, '')
                      ON CONFLICT(hour,symbol) DO UPDATE SET
                      from_ms=MIN(COALESCE(from_ms,excluded.from_ms),excluded.from_ms),
                      to_ms=MAX(COALESCE(to_ms,excluded.to_ms),excluded.to_ms)""",
                                    (h, symbol, max(h, since), min(now, h + HOUR)))
                    self.dirty.add(h)
        for (h, symbol, kind), (ex, amount, n) in self.market.items():
            self.db.execute("INSERT OR REPLACE INTO market VALUES(?,?,?,?,?,?)", (h, symbol, ex, kind, amount, n))
        self.db.execute("INSERT OR REPLACE INTO meta VALUES('published',?)", (now,))
        self.db.commit()
        available = {h for (h,) in self.db.execute("SELECT DISTINCT hour FROM scope")}
        for h in sorted(self.dirty & available):
            write_json(self.directory / "hours" / f"{h}.json", self.snapshot(h, now))
        write_json(self.directory / "index.json", dict(version=1, updatedAt=now, startedAt=self.started, hours=sorted(available, reverse=True)[:336]))
        self.dirty.clear()
        self.market = {k: v for k, v in self.market.items() if k[0] >= current - HOUR}
        # These are deduplication/cache records, not the retained hourly facts.
        self.db.execute("DELETE FROM seen WHERE hour<? AND kind IS NOT NULL", (current - 48 * HOUR,))
        self.db.execute("DELETE FROM orders WHERE updated<?", (now - 48 * HOUR,))
        self.db.commit()

    def close(self):
        self.db.close()
