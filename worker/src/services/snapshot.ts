import { Env } from "../types";
import { saveDailySnapshot } from "../db";
import { syncIbkrFlex } from "./ibkr-flex";
import { syncLongbridge } from "./longbridge";

/** Run daily: sync both brokers then save a portfolio snapshot */
export async function dailySnapshot(env: Env): Promise<void> {
  try {
    await syncIbkrFlex(env);
  } catch (e) {
    console.error("Daily snapshot: IBKR sync failed", e);
  }

  try {
    await syncLongbridge(env);
  } catch (e) {
    console.error("Daily snapshot: Longbridge sync failed", e);
  }

  // Calculate total from DB
  const summary = await getPortfolioTotal(env.DB);
  await saveDailySnapshot(env.DB, summary);
  console.log(`Daily snapshot saved: ${summary.toFixed(2)} USD`);
}

async function getPortfolioTotal(db: D1Database): Promise<number> {
  const posResult = await db
    .prepare("SELECT COALESCE(SUM(current_value), 0) as total FROM positions")
    .first<{ total: number }>();
  const repResult = await db
    .prepare("SELECT COALESCE(SUM(market_value), 0) as total FROM reports")
    .first<{ total: number }>();
  return (posResult?.total || 0) + (repResult?.total || 0);
}
