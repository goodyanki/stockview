import { Env, isTruthy } from "../types";
import { ensureAccount, addRawImport, replaceLongbridgePositions } from "../db";

const LB_API_BASE = "https://openapi.longportapp.com";

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

export interface LongbridgePositionRow {
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

/** Fetch Longbridge positions from API and return rows (no DB write) */
export async function fetchLongbridge(env: Env): Promise<LongbridgePositionRow[]> {
  const { rows } = await buildRows(env);
  return rows;
}

/** Fetch Longbridge data, save to D1, return count */
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

async function buildRows(env: Env): Promise<{ positions: RawPosition[]; quotes: Record<string, RawQuote>; rows: LongbridgePositionRow[] }> {
  let positions: RawPosition[];
  let quotes: Record<string, RawQuote>;

  if (isTruthy(env.LONGBRIDGE_USE_MOCK)) {
    positions = mockPositions();
    quotes = mockQuotes();
  } else {
    positions = await fetchPositionsApi(env);
    // Longbridge quote API is WebSocket/Protobuf only, no REST endpoint.
    // Use cost_price as fallback for last_price.
    quotes = {};
    for (const p of positions) {
      quotes[p.symbol.toUpperCase()] = { symbol: p.symbol, last_price: p.avg_cost };
    }
  }

  const snapshotTime = new Date().toISOString();
  const rows: LongbridgePositionRow[] = positions.map((item) => {
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

// --- Longbridge OpenAPI HMAC-SHA256 Auth ---

async function signRequest(
  env: Env,
  method: string,
  uri: string,
  queryString: string,
  body: string
): Promise<Record<string, string>> {
  const token = env.LONGPORT_TOKEN;
  const appKey = env.LONGPORT_APP_KEY;
  const appSecret = env.LONGPORT_APP_SECRET;
  if (!token || !appKey || !appSecret) {
    throw new Error("Longbridge credentials not configured (LONGPORT_APP_KEY, LONGPORT_APP_SECRET, LONGPORT_TOKEN)");
  }

  const timestamp = (Date.now() / 1000).toFixed(3);

  let canonical =
    `${method.toUpperCase()}|${uri}|${queryString}|` +
    `authorization:${token}\n` +
    `x-api-key:${appKey}\n` +
    `x-timestamp:${timestamp}\n` +
    `|authorization;x-api-key;x-timestamp|`;

  if (body) {
    const bodyHash = await sha1Hex(body);
    canonical += bodyHash;
  }

  const canonicalHash = await sha1Hex(canonical);
  const signString = `HMAC-SHA256|${canonicalHash}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(signString));
  const signature = bufToHex(signatureBuffer);

  return {
    Authorization: token,
    "X-Api-Key": appKey,
    "X-Timestamp": timestamp,
    "X-Api-Signature": `HMAC-SHA256 SignedHeaders=authorization;x-api-key;x-timestamp, Signature=${signature}`,
    "Content-Type": "application/json; charset=utf-8",
  };
}

async function sha1Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-1", encoder.encode(data));
  return bufToHex(hash);
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --- API calls ---

async function fetchPositionsApi(env: Env): Promise<RawPosition[]> {
  const uri = "/v1/asset/stock";
  const headers = await signRequest(env, "GET", uri, "", "");
  const resp = await fetch(`${LB_API_BASE}${uri}`, { headers });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Longbridge positions API failed: ${resp.status} ${text}`);
  }
  const data = (await resp.json()) as any;

  const positions: RawPosition[] = [];
  const channels = data?.data?.list || [];
  for (const channel of channels) {
    const items = channel.stock_info || channel.positions || [];
    for (const pos of items) {
      positions.push({
        symbol: pos.symbol || "",
        market: (pos.market || "").toUpperCase(),
        quantity: parseFloat(pos.quantity) || 0,
        avg_cost: parseFloat(pos.cost_price) || 0,
        currency: pos.currency || "USD",
      });
    }
  }
  return positions;
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
