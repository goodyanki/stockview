import { Hono } from "hono";
import { cors } from "hono/cors";
import { Env } from "./types";
import { authMiddleware } from "./auth";
import { fetchIbkrFlex, syncIbkrFlex, IbkrReportRow } from "./services/ibkr-flex";
import { fetchLongbridge, syncLongbridge, LongbridgePositionRow } from "./services/longbridge";
import { fetchFxToUsd, fetchQuotes } from "./services/quotes";
import { dailySnapshot } from "./services/snapshot";

const app = new Hono<{ Bindings: Env }>();

type BrokerSource = "IBKR_FLEX" | "LONGBRIDGE_OPENAPI";

interface HoldingInput {
  broker_source: BrokerSource;
  symbol: string;
  quantity: number;
  avg_cost: number;
  currency: string;
}

interface BrokerAggregate {
  broker_source: BrokerSource;
  total_market_value_usd: number;
  total_unrealized_pnl_usd: number;
  total_positions: number;
  priced_positions: number;
}

// --- CORS ---
app.use("*", async (c, next) => {
  const allowedOrigins = c.env.CORS_ORIGINS
    ? c.env.CORS_ORIGINS.split(",").map((s) => s.trim())
    : [];
  const middleware = cors({
    origin: (origin) => {
      if (allowedOrigins.length === 0) return origin;
      return allowedOrigins.includes(origin) ? origin : "";
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    credentials: true,
  });
  return middleware(c, next);
});

// --- Health check (public) ---
app.get("/healthz", (c) => c.json({ status: "ok" }));

// --- Auth middleware for /api/* ---
app.use("/api/*", authMiddleware);

// --- Auth check (lightweight, no external calls) ---
app.get("/api/auth/check", (c) => c.json({ ok: true }));

function normalizeCurrency(currency: string | undefined): string {
  const value = (currency || "").trim().toUpperCase();
  return value || "USD";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// --- IBKR Reports (real-time from IBKR Flex API + Twelve Data prices) ---
app.get("/api/reports/ibkr", async (c) => {
  try {
    const rows = await fetchIbkrFlex(c.env);
    const symbols = rows.map((row) => row.symbol);
    const currencies = rows.map((row) => normalizeCurrency(row.currency));

    const [prices, fxRates] = await Promise.all([
      fetchQuotes(c.env, symbols),
      fetchFxToUsd(c.env, currencies),
    ]);

    const results = rows.map((row, index) => {
      const currency = normalizeCurrency(row.currency);
      const costValue = row.quantity * row.avg_cost;
      const livePrice = prices[row.symbol];
      const fxRate = fxRates[currency];

      const hasLivePrice = livePrice !== undefined;
      const hasFxRate = fxRate !== undefined;

      let marketValue: number | null = null;
      let unrealizedPnl: number | null = null;
      if (hasLivePrice) {
        marketValue = row.quantity * livePrice;
        unrealizedPnl = marketValue - costValue;
      }

      const marketValueUsd = hasLivePrice && hasFxRate && marketValue !== null ? marketValue * fxRate : null;
      const costValueUsd = hasFxRate ? costValue * fxRate : null;
      const unrealizedPnlUsd =
        hasLivePrice && hasFxRate && unrealizedPnl !== null ? unrealizedPnl * fxRate : null;

      return {
        id: index + 1,
        broker_source: "IBKR_FLEX",
        symbol: row.symbol,
        quantity: row.quantity,
        avg_cost: row.avg_cost,
        cost_value: costValue,
        last_price: hasLivePrice ? livePrice : null,
        market_value: marketValue,
        unrealized_pnl: unrealizedPnl,
        market_value_usd: marketValueUsd,
        cost_value_usd: costValueUsd,
        unrealized_pnl_usd: unrealizedPnlUsd,
        has_live_price: hasLivePrice,
        live_price_missing_reason: hasLivePrice ? null : "TWELVEDATA_QUOTE_MISSING",
        has_fx_rate: hasFxRate,
        fx_rate_to_usd: hasFxRate ? fxRate : null,
        fx_rate_missing_reason: hasFxRate ? null : "FX_RATE_MISSING",
        currency,
        report_date: row.report_date,
      };
    });

    return c.json(results);
  } catch (error: unknown) {
    return c.json({ error: getErrorMessage(error) }, 502);
  }
});

// --- Sync IBKR (fetch + write to D1) ---
app.post("/api/sync/ibkr-flex", async (c) => {
  try {
    const imported = await syncIbkrFlex(c.env);
    return c.json({ success: true, imported, message: "IBKR Flex sync completed" });
  } catch (error: unknown) {
    return c.json({ success: false, imported: 0, message: getErrorMessage(error) }, 502);
  }
});

// --- Longbridge Positions (real-time from Longbridge API + Twelve Data prices) ---
app.get("/api/positions/longbridge", async (c) => {
  try {
    const rows = await fetchLongbridge(c.env);
    const symbols = rows.map((row) => row.symbol);
    const currencies = rows.map((row) => normalizeCurrency(row.currency));

    const [prices, fxRates] = await Promise.all([
      fetchQuotes(c.env, symbols),
      fetchFxToUsd(c.env, currencies),
    ]);

    const results = rows.map((row, index) => {
      const currency = normalizeCurrency(row.currency);
      const costValue = row.quantity * row.avg_cost;
      const livePrice = prices[row.symbol];
      const fxRate = fxRates[currency];

      const hasLivePrice = livePrice !== undefined;
      const hasFxRate = fxRate !== undefined;

      let currentValue: number | null = null;
      let unrealizedPnl: number | null = null;
      let unrealizedPnlPct: number | null = null;
      if (hasLivePrice) {
        currentValue = row.quantity * livePrice;
        unrealizedPnl = currentValue - costValue;
        unrealizedPnlPct = row.avg_cost ? (livePrice - row.avg_cost) / row.avg_cost : 0;
      }

      const marketValueUsd = hasLivePrice && hasFxRate && currentValue !== null ? currentValue * fxRate : null;
      const costValueUsd = hasFxRate ? costValue * fxRate : null;
      const unrealizedPnlUsd =
        hasLivePrice && hasFxRate && unrealizedPnl !== null ? unrealizedPnl * fxRate : null;

      return {
        id: index + 1,
        broker_source: "LONGBRIDGE_OPENAPI",
        symbol: row.symbol,
        market: row.market,
        quantity: row.quantity,
        avg_cost: row.avg_cost,
        cost_value: costValue,
        last_price: hasLivePrice ? livePrice : null,
        current_value: currentValue,
        market_value: currentValue,
        unrealized_pnl: unrealizedPnl,
        unrealized_pnl_pct: unrealizedPnlPct,
        market_value_usd: marketValueUsd,
        cost_value_usd: costValueUsd,
        unrealized_pnl_usd: unrealizedPnlUsd,
        has_live_price: hasLivePrice,
        live_price_missing_reason: hasLivePrice ? null : "TWELVEDATA_QUOTE_MISSING",
        has_fx_rate: hasFxRate,
        fx_rate_to_usd: hasFxRate ? fxRate : null,
        fx_rate_missing_reason: hasFxRate ? null : "FX_RATE_MISSING",
        currency,
        snapshot_time: row.snapshot_time,
      };
    });

    return c.json(results);
  } catch (error: unknown) {
    return c.json({ error: getErrorMessage(error) }, 502);
  }
});

// --- Sync Longbridge (fetch + write to D1) ---
app.post("/api/sync/longbridge", async (c) => {
  try {
    const imported = await syncLongbridge(c.env);
    return c.json({ success: true, imported, message: "Longbridge sync completed" });
  } catch (error: unknown) {
    return c.json({ success: false, imported: 0, message: getErrorMessage(error) }, 502);
  }
});

// --- Portfolio Summary (real-time: both APIs + Twelve Data prices) ---
app.get("/api/portfolio/summary", async (c) => {
  let ibkrRows: IbkrReportRow[] = [];
  let lbRows: LongbridgePositionRow[] = [];

  const missingLivePriceSymbols = new Set<string>();
  const missingFxCurrencies = new Set<string>();

  try {
    ibkrRows = await fetchIbkrFlex(c.env);
  } catch (error) {
    console.error("Summary: IBKR fetch failed", error);
  }

  try {
    lbRows = await fetchLongbridge(c.env);
  } catch (error) {
    console.error("Summary: Longbridge fetch failed", error);
  }

  const holdings: HoldingInput[] = [
    ...ibkrRows.map((row) => ({
      broker_source: "IBKR_FLEX" as const,
      symbol: row.symbol,
      quantity: row.quantity,
      avg_cost: row.avg_cost,
      currency: normalizeCurrency(row.currency),
    })),
    ...lbRows.map((row) => ({
      broker_source: "LONGBRIDGE_OPENAPI" as const,
      symbol: row.symbol,
      quantity: row.quantity,
      avg_cost: row.avg_cost,
      currency: normalizeCurrency(row.currency),
    })),
  ];

  const [prices, fxRates] = await Promise.all([
    fetchQuotes(c.env, holdings.map((holding) => holding.symbol)),
    fetchFxToUsd(c.env, holdings.map((holding) => holding.currency)),
  ]);

  const brokerTotals = new Map<BrokerSource, BrokerAggregate>();
  for (const source of ["IBKR_FLEX", "LONGBRIDGE_OPENAPI"] as const) {
    if (holdings.some((holding) => holding.broker_source === source)) {
      brokerTotals.set(source, {
        broker_source: source,
        total_market_value_usd: 0,
        total_unrealized_pnl_usd: 0,
        total_positions: 0,
        priced_positions: 0,
      });
    }
  }

  let totalPositions = 0;
  let pricedPositions = 0;

  for (const holding of holdings) {
    totalPositions += 1;
    const aggregate = brokerTotals.get(holding.broker_source);
    if (!aggregate) continue;

    aggregate.total_positions += 1;

    const livePrice = prices[holding.symbol];
    if (livePrice === undefined) {
      missingLivePriceSymbols.add(holding.symbol);
      continue;
    }

    const fxRate = fxRates[holding.currency];
    if (fxRate === undefined) {
      missingFxCurrencies.add(holding.currency);
      continue;
    }

    const marketValue = holding.quantity * livePrice;
    const costValue = holding.quantity * holding.avg_cost;
    const unrealizedPnl = marketValue - costValue;

    aggregate.total_market_value_usd += marketValue * fxRate;
    aggregate.total_unrealized_pnl_usd += unrealizedPnl * fxRate;
    aggregate.priced_positions += 1;

    pricedPositions += 1;
  }

  const brokers = Array.from(brokerTotals.values()).map((broker) => ({
    broker_source: broker.broker_source,
    total_market_value_usd: broker.total_market_value_usd,
    total_unrealized_pnl_usd: broker.total_unrealized_pnl_usd,
    // Backward-compatible aliases
    total_market_value: broker.total_market_value_usd,
    total_unrealized_pnl: broker.total_unrealized_pnl_usd,
    total_positions: broker.total_positions,
    priced_positions: broker.priced_positions,
  }));

  const totalMarketValueUsd = brokers.reduce((sum, broker) => sum + broker.total_market_value_usd, 0);
  const totalUnrealizedPnlUsd = brokers.reduce((sum, broker) => sum + broker.total_unrealized_pnl_usd, 0);

  return c.json({
    brokers,
    total_market_value_usd: totalMarketValueUsd,
    total_unrealized_pnl_usd: totalUnrealizedPnlUsd,
    // Backward-compatible aliases
    total_market_value: totalMarketValueUsd,
    total_unrealized_pnl: totalUnrealizedPnlUsd,
    data_quality: {
      total_positions: totalPositions,
      priced_positions: pricedPositions,
      missing_live_price_symbols: Array.from(missingLivePriceSymbols).sort(),
      missing_fx_currencies: Array.from(missingFxCurrencies).sort(),
    },
  });
});

// --- Daily Snapshots (from D1, for chart only) ---
app.get("/api/portfolio/snapshots", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT date, total_value_usd FROM daily_snapshots ORDER BY date ASC"
  ).all();
  return c.json(rows.results);
});

// --- Export for Workers runtime ---
export default {
  fetch: app.fetch,

  // Cron trigger: sync both brokers + save daily snapshot to D1
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(dailySnapshot(env));
  },
};
