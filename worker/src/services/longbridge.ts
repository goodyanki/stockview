import { Env, isTruthy } from "../types";
import { ensureAccount, addRawImport, replaceLongbridgePositions } from "../db";

// Longbridge OpenAPI base URL
const LB_API_BASE = "https://openapi.longportapp.com/v1";

export async function syncLongbridge(env: Env): Promise<number> {
  const accountId = await ensureAccount(
    env.DB,
    "LONGBRIDGE_OPENAPI",
    env.LONGBRIDGE_ACCOUNT_NO || "LONG-001",
    env.LONGBRIDGE_ACCOUNT_NAME || "Longbridge Main"
  );

  const { positions, quotes, rows } = await buildRows(env);
  await addRawImport(env.DB, "LONGBRIDGE_OPENAPI", "POSITION", JSON.stringify(positions));
  await addRawImport(env.DB, "LONGBRIDGE_OPENAPI", "QUOTE", JSON.stringify(quotes));
  return replaceLongbridgePositions(env.DB, accountId, rows);
}

interface RawPosition {
  symbol: string;
  market: string;
  quantity: number;
  avg_cost: number;
  currency: string;
}

interface RawQuote {
  symbol: string;
  last_price: number;
}

interface PositionRow {
  symbol: string;
  market: string;
  quantity: number;
  avg_cost: number;
  last_price: number;
  current_value: number;
  cost_value: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  currency: string;
  snapshot_time: string;
}

async function buildRows(env: Env): Promise<{ positions: RawPosition[]; quotes: Record<string, RawQuote>; rows: PositionRow[] }> {
  let positions: RawPosition[];
  let quotes: Record<string, RawQuote>;

  if (isTruthy(env.LONGBRIDGE_USE_MOCK)) {
    positions = mockPositions();
    quotes = mockQuotes();
  } else {
    positions = await fetchPositionsApi(env);
    const symbols = positions.map((p) => p.symbol);
    quotes = symbols.length > 0 ? await fetchQuotesApi(env, symbols) : {};
  }

  const snapshotTime = new Date().toISOString();
  const rows: PositionRow[] = positions.map((item) => {
    const quote = quotes[item.symbol.toUpperCase()] || { last_price: 0 };
    const lastPrice = quote.last_price;
    const currentValue = item.quantity * lastPrice;
    const costValue = item.quantity * item.avg_cost;
    const unrealizedPnl = currentValue - costValue;
    const unrealizedPnlPct = item.avg_cost ? (lastPrice - item.avg_cost) / item.avg_cost : 0;

    return {
      symbol: item.symbol.toUpperCase(),
      market: item.market,
      quantity: item.quantity,
      avg_cost: item.avg_cost,
      last_price: lastPrice,
      current_value: currentValue,
      cost_value: costValue,
      unrealized_pnl: unrealizedPnl,
      unrealized_pnl_pct: unrealizedPnlPct,
      currency: item.currency,
      snapshot_time: snapshotTime,
    };
  });

  return { positions, quotes, rows };
}

// --- Longbridge REST API ---

async function getAuthHeaders(env: Env): Promise<Record<string, string>> {
  // Longbridge OpenAPI uses Bearer token auth
  const token = env.LONGPORT_TOKEN;
  if (!token) throw new Error("LONGPORT_TOKEN not configured");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function fetchPositionsApi(env: Env): Promise<RawPosition[]> {
  const headers = await getAuthHeaders(env);
  const resp = await fetch(`${LB_API_BASE}/trade/position`, { headers });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Longbridge positions API failed: ${resp.status} ${text}`);
  }
  const data = (await resp.json()) as any;

  const positions: RawPosition[] = [];
  const channels = data?.data?.list || [];
  for (const channel of channels) {
    const items = channel.positions || [];
    for (const pos of items) {
      positions.push({
        symbol: pos.symbol || "",
        market: marketStr(pos.market),
        quantity: parseFloat(pos.quantity) || 0,
        avg_cost: parseFloat(pos.cost_price) || 0,
        currency: pos.currency || "USD",
      });
    }
  }
  return positions;
}

async function fetchQuotesApi(env: Env, symbols: string[]): Promise<Record<string, RawQuote>> {
  const headers = await getAuthHeaders(env);
  const resp = await fetch(`${LB_API_BASE}/quote/basic?symbol=${symbols.join(",")}`, { headers });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Longbridge quote API failed: ${resp.status} ${text}`);
  }
  const data = (await resp.json()) as any;

  const quoteMap: Record<string, RawQuote> = {};
  const list = data?.data || [];
  for (const q of list) {
    const symbol = (q.symbol || "").toUpperCase();
    quoteMap[symbol] = {
      symbol,
      last_price: parseFloat(q.last_done) || 0,
    };
  }
  return quoteMap;
}

function marketStr(market: string | undefined): string {
  if (!market) return "";
  return market.toUpperCase();
}

// --- Mock data ---

function mockPositions(): RawPosition[] {
  return [
    { symbol: "00700.HK", market: "HK", quantity: 100, avg_cost: 301.2, currency: "HKD" },
    { symbol: "TSLA.US", market: "US", quantity: 6, avg_cost: 182.5, currency: "USD" },
  ];
}

function mockQuotes(): Record<string, RawQuote> {
  return {
    "00700.HK": { symbol: "00700.HK", last_price: 328.4 },
    "TSLA.US": { symbol: "TSLA.US", last_price: 195.2 },
  };
}
