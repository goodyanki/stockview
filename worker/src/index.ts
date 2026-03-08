import { Hono } from "hono";
import { cors } from "hono/cors";
import { Env } from "./types";
import { authMiddleware } from "./auth";
import { syncIbkrFlex } from "./services/ibkr-flex";
import { syncLongbridge } from "./services/longbridge";
import { dailySnapshot } from "./services/snapshot";

const app = new Hono<{ Bindings: Env }>();

// --- CORS ---
app.use("*", async (c, next) => {
  const allowedOrigins = c.env.CORS_ORIGINS
    ? c.env.CORS_ORIGINS.split(",").map((s) => s.trim())
    : [];
  const middleware = cors({
    origin: (origin) => {
      // No CORS_ORIGINS configured → allow all
      if (allowedOrigins.length === 0) return origin;
      // Check if request origin is in the allowed list
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

// --- IBKR Reports ---
app.get("/api/reports/ibkr", async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "200"), 1), 1000);
  const rows = await c.env.DB.prepare(
    "SELECT id, broker_source, symbol, quantity, avg_cost, market_value, unrealized_pnl, currency, report_date FROM reports WHERE broker_source = 'IBKR_FLEX' ORDER BY report_date DESC, id DESC LIMIT ?"
  )
    .bind(limit)
    .all();
  return c.json(rows.results);
});

// --- Sync IBKR ---
app.post("/api/sync/ibkr-flex", async (c) => {
  try {
    const imported = await syncIbkrFlex(c.env);
    return c.json({ success: true, imported, message: "IBKR Flex sync completed" });
  } catch (e: any) {
    return c.json({ success: false, imported: 0, message: e.message }, 502);
  }
});

// --- Longbridge Positions ---
app.get("/api/positions/longbridge", async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "200"), 1), 1000);
  const rows = await c.env.DB.prepare(
    "SELECT id, broker_source, symbol, market, quantity, avg_cost, last_price, current_value, cost_value, unrealized_pnl, unrealized_pnl_pct, currency, snapshot_time FROM positions WHERE broker_source = 'LONGBRIDGE_OPENAPI' ORDER BY snapshot_time DESC, id DESC LIMIT ?"
  )
    .bind(limit)
    .all();
  return c.json(rows.results);
});

// --- Sync Longbridge ---
app.post("/api/sync/longbridge", async (c) => {
  try {
    const imported = await syncLongbridge(c.env);
    return c.json({ success: true, imported, message: "Longbridge sync completed" });
  } catch (e: any) {
    return c.json({ success: false, imported: 0, message: e.message }, 502);
  }
});

// --- Portfolio Summary ---
app.get("/api/portfolio/summary", async (c) => {
  const db = c.env.DB;

  // Longbridge positions aggregation
  const posRows = await db
    .prepare(
      "SELECT broker_source, COALESCE(SUM(current_value), 0) as total_market_value, COALESCE(SUM(unrealized_pnl), 0) as total_unrealized_pnl FROM positions GROUP BY broker_source"
    )
    .all<{ broker_source: string; total_market_value: number; total_unrealized_pnl: number }>();

  // IBKR reports aggregation
  const repRows = await db
    .prepare(
      "SELECT broker_source, COALESCE(SUM(market_value), 0) as total_market_value, COALESCE(SUM(unrealized_pnl), 0) as total_unrealized_pnl FROM reports GROUP BY broker_source"
    )
    .all<{ broker_source: string; total_market_value: number; total_unrealized_pnl: number }>();

  const brokers = [...(posRows.results || []), ...(repRows.results || [])];
  const totalMarketValue = brokers.reduce((sum, b) => sum + b.total_market_value, 0);
  const totalUnrealizedPnl = brokers.reduce((sum, b) => sum + b.total_unrealized_pnl, 0);

  return c.json({
    brokers,
    total_market_value: totalMarketValue,
    total_unrealized_pnl: totalUnrealizedPnl,
  });
});

// --- Daily Snapshots ---
app.get("/api/portfolio/snapshots", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT date, total_value_usd FROM daily_snapshots ORDER BY date ASC"
  ).all();
  return c.json(rows.results);
});

// --- Export for Workers runtime ---
export default {
  fetch: app.fetch,

  // Cron trigger handler
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(dailySnapshot(env));
  },
};
