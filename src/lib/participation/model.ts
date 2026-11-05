export type OrderClass = "rpi" | "non-rpi";
export type Amounts = { notional: number; count: number };
export type MarketRow = Amounts & { exchange: string; symbol: string; type: OrderClass; ready: boolean; reason: string };
export type OwnRow = MarketRow & { account: string };
export type ParticipationHour = {
  version: 1; hour: number; updatedAt: number; startedAt: number;
  market: MarketRow[]; own: OwnRow[];
};
export type ParticipationRow = {
  exchange: string; account: string; symbol: string; type: OrderClass;
  own: Amounts; market: Amounts; symbols: number;
  notionalShare: number | null; countShare: number | null; ready: boolean; reasons: string[];
};
export type ParticipationFilter = { exchange?: string; account?: string; symbol?: string; type?: string };

const classes = new Set(["rpi", "non-rpi"]);
export function parseParticipationHour(value: unknown): ParticipationHour {
  const d = value as ParticipationHour;
  if (!d || d.version !== 1 || !Number.isSafeInteger(d.hour) || d.hour < 0 || d.hour % 3_600_000 || !Number.isFinite(d.updatedAt) || !Array.isArray(d.market) || !Array.isArray(d.own) || d.market.length > 10_000 || d.own.length > 20_000) throw new Error("Invalid participation data.");
  for (const row of [...d.market, ...d.own]) {
    if (!row || typeof row.exchange !== "string" || typeof row.symbol !== "string" || !classes.has(row.type) || typeof row.ready !== "boolean" || typeof row.reason !== "string" || !Number.isFinite(row.notional) || row.notional < 0 || !Number.isSafeInteger(row.count) || row.count < 0) throw new Error("Invalid participation row.");
  }
  if (d.own.some(row => typeof row.account !== "string" || !row.account)) throw new Error("Invalid participation account.");
  return d;
}

// A physical market is counted once even when several accounts trade it.
// Ratios are always ratios of sums; never averages of symbol percentages.
export function participationRows(hour: ParticipationHour, level: "symbol" | "account" | "exchange", filter: ParticipationFilter = {}): ParticipationRow[] {
  const market = new Map<string, MarketRow>();
  const keyOf = (row: MarketRow) => JSON.stringify([row.exchange, row.symbol, row.type]);
  for (const row of hour.market) {
    const key = keyOf(row), old = market.get(key);
    if (!old) market.set(key, row);
    else if (old.count !== row.count || old.notional !== row.notional || old.ready !== row.ready) market.set(key, { ...row, ready: false, reason: "市场数据重复且不一致" });
  }
  const groups = new Map<string, { row: ParticipationRow; markets: Set<string> }>();
  const seenOwn = new Set<string>();
  for (const own of hour.own) {
    if ((filter.exchange && filter.exchange !== own.exchange) || (filter.account && filter.account !== own.account) || (filter.type && filter.type !== own.type) || (filter.symbol && !own.symbol.toLowerCase().includes(filter.symbol.toLowerCase()))) continue;
    const identity = JSON.stringify([own.account, keyOf(own)]);
    if (seenOwn.has(identity)) throw new Error("Duplicate account participation row.");
    seenOwn.add(identity);
    const key = JSON.stringify([own.exchange, level === "exchange" ? "" : own.account, level === "symbol" ? own.symbol : "", own.type]);
    let group = groups.get(key);
    if (!group) {
      group = { row: { exchange: own.exchange, account: level === "exchange" ? "" : own.account, symbol: level === "symbol" ? own.symbol : "", type: own.type, own: { notional: 0, count: 0 }, market: { notional: 0, count: 0 }, symbols: 0, notionalShare: null, countShare: null, ready: true, reasons: [] }, markets: new Set() };
      groups.set(key, group);
    }
    const row = group.row;
    row.own.notional += own.notional; row.own.count += own.count;
    if (!own.ready) { row.ready = false; row.reasons.push(own.reason || "账户成交数据未完整"); }
    const marketKey = keyOf(own);
    if (!group.markets.has(marketKey)) {
      group.markets.add(marketKey); row.symbols++;
      const m = market.get(marketKey);
      if (!m || !m.ready) { row.ready = false; row.reasons.push(m?.reason || "市场数据尚未接入"); }
      if (m) { row.market.notional += m.notional; row.market.count += m.count; }
    }
  }
  return [...groups.values()].map(({ row }) => {
    row.reasons = [...new Set(row.reasons)];
    if (row.ready && row.market.notional > 0) row.notionalShare = row.own.notional / row.market.notional;
    if (row.ready && row.market.count > 0) row.countShare = row.own.count / row.market.count;
    return row;
  }).sort((a, b) => a.exchange.localeCompare(b.exchange) || a.account.localeCompare(b.account) || a.symbol.localeCompare(b.symbol) || a.type.localeCompare(b.type));
}
