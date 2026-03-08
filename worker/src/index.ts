import { Hono } from "hono";
import { cors } from "hono/cors";
import { Env } from "./types";
import { authMiddleware } from "./auth";
import { fetchIbkrFlex, syncIbkrFlex, IbkrReportRow } from "./services/ibkr-flex";
import { fetchLongbridge, syncLongbridge, LongbridgePositionRow } from "./services/longbridge";
import { fetchQuotes } from "./services/quotes";
import { dailySnapshot } from "./services/snapshot";

const app = new Hono<{ Bindings: Env }>();

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

// --- IBKR Reports (real-time from IBKR Flex API + Twelve Data prices) ---
app.get("/api/reports/ibkr", async (c) => {
  try {
    const rows = await fetchIbkrFlex(c.env);
    const symbols = rows.map((r) => r.symbol);
    const prices = await fetchQuotes(c.env, symbols);

    const results = rows.map((r, i) => {
      const livePrice = prices[r.symbol];
      let marketValue = r.market_value;
      let unrealizedPnl = r.unrealized_pnl;
      if (livePrice && r.quantity) {
        marketValue = r.quantity * livePrice;
        unrealizedPnl = marketValue - r.quantity * r.avg_cost;
      }
      return {
        id: i + 1,
        broker_source: "IBKR_FLEX",
        symbol: r.symbol,
        quantity: r.quantity,
        avg_cost: r.avg_cost,
        last_price: livePrice || (r.quantity ? r.market_value / r.quantity : 0),
        market_value: marketValue,
        unrealized_pnl: unrealizedPnl,
        currency: r.currency,
        report_date: r.report_date,
      };
    });
    return c.json(results);
  } catch (e: any) {
    return c.json({ error: e.message }, 502);
  }
});

// --- Sync IBKR (fetch + write to D1) ---
app.post("/api/sync/ibkr-flex", async (c) => {
  try {
    const imported = await syncIbkrFlex(c.env);
    return c.json({ success: true, imported, message: "IBKR Flex sync completed" });
  } catch (e: any) {
    return c.json({ success: false, imported: 0, message: e.message }, 502);
  }
});

// --- Longbridge Positions (real-time from Longbridge API + Twelve Data prices) ---
app.get("/api/positions/longbridge", async (c) => {
  try {
    const rows = await fetchLongbridge(c.env);
    const symbols = rows.map((r) => r.symbol);
    const prices = await fetchQuotes(c.env, symbols);

    const results = rows.map((r, i) => {
      const livePrice = prices[r.symbol];
      let lastPrice = r.last_price;
      let currentValue = r.current_value;
      let unrealizedPnl = r.unrealized_pnl;
      let unrealizedPnlPct = r.unrealized_pnl_pct;
      if (livePrice) {
        lastPrice = livePrice;
        currentValue = r.quantity * livePrice;
        const costValue = r.quantity * r.avg_cost;
        unrealizedPnl = currentValue - costValue;
        unrealizedPnlPct = r.avg_cost ? (livePrice - r.avg_cost) / r.avg_cost : 0;
      }
      return {
        id: i + 1,
        broker_source: "LONGBRIDGE_OPENAPI",
        symbol: r.symbol,
        market: r.market,
        quantity: r.quantity,
        avg_cost: r.avg_cost,
        last_price: lastPrice,
        current_value: currentValue,
        cost_value: r.cost_value,
        unrealized_pnl: unrealizedPnl,
        unrealized_pnl_pct: unrealizedPnlPct,
        currency: r.currency,
        snapshot_time: r.snapshot_time,
      };
    });
    return c.json(results);
  } catch (e: any) {
    return c.json({ error: e.message }, 502);
  }
});

// --- Sync Longbridge (fetch + write to D1) ---
app.post("/api/sync/longbridge", async (c) => {
  try {
    const imported = await syncLongbridge(c.env);
    return c.json({ success: true, imported, message: "Longbridge sync completed" });
  } catch (e: any) {
    return c.json({ success: false, imported: 0, message: e.message }, 502);
  }
});

// --- Portfolio Summary (real-time: both APIs + Twelve Data prices) ---
app.get("/api/portfolio/summary", async (c) => {
  const brokers: Array<{ broker_source: string; total_market_value: number; total_unrealized_pnl: number }> = [];

  // Collect all symbols for a single Twelve Data batch
  let ibkrRows: IbkrReportRow[] = [];
  let lbRows: LongbridgePositionRow[] = [];
  const allSymbols: string[] = [];

  try {
    ibkrRows = await fetchIbkrFlex(c.env);
    allSymbols.push(...ibkrRows.map((r) => r.symbol));
  } catch (e) {
    console.error("Summary: IBKR fetch failed", e);
  }

  try {
    lbRows = await fetchLongbridge(c.env);
    allSymbols.push(...lbRows.map((r) => r.symbol));
  } catch (e) {
    console.error("Summary: Longbridge fetch failed", e);
  }

  // Single batch quote fetch for all symbols
  const prices = await fetchQuotes(c.env, allSymbols);

  // IBKR aggregation with live prices
  if (ibkrRows.length > 0) {
    let totalMv = 0;
    let totalPnl = 0;
    for (const r of ibkrRows) {
      const livePrice = prices[r.symbol];
      if (livePrice && r.quantity) {
        const mv = r.quantity * livePrice;
        totalMv += mv;
        totalPnl += mv - r.quantity * r.avg_cost;
      } else {
        totalMv += r.market_value;
        totalPnl += r.unrealized_pnl;
      }
    }
    brokers.push({ broker_source: "IBKR_FLEX", total_market_value: totalMv, total_unrealized_pnl: totalPnl });
  }

  // Longbridge aggregation with live prices
  if (lbRows.length > 0) {
    let totalMv = 0;
    let totalPnl = 0;
    for (const r of lbRows) {
      const livePrice = prices[r.symbol];
      if (livePrice) {
        const mv = r.quantity * livePrice;
        totalMv += mv;
        totalPnl += mv - r.quantity * r.avg_cost;
      } else {
        totalMv += r.current_value;
        totalPnl += r.unrealized_pnl;
      }
    }
    brokers.push({ broker_source: "LONGBRIDGE_OPENAPI", total_market_value: totalMv, total_unrealized_pnl: totalPnl });
  }

  const totalMarketValue = brokers.reduce((sum, b) => sum + b.total_market_value, 0);
  const totalUnrealizedPnl = brokers.reduce((sum, b) => sum + b.total_unrealized_pnl, 0);

  return c.json({
    brokers,
    total_market_value: totalMarketValue,
    total_unrealized_pnl: totalUnrealizedPnl,
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
