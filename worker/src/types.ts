export interface Env {
  DB: D1Database;

  // Auth
  VIEW_USERNAME: string;
  VIEW_PASSWORD: string;
  BACKEND_API_KEY: string;

  // CORS
  CORS_ORIGINS: string; // comma-separated

  // IBKR Flex
  IBKR_FLEX_TOKEN: string;
  IBKR_FLEX_QUERY_ID: string;
  IBKR_ACCOUNT_NO: string;
  IBKR_ACCOUNT_NAME: string;
  IBKR_USE_MOCK: string; // "true" / "false"

  // Twelve Data
  TWELVE_API_KEY: string;

  // Longbridge
  LONGPORT_APP_KEY: string;
  LONGPORT_APP_SECRET: string;
  LONGPORT_TOKEN: string;
  LONGBRIDGE_ACCOUNT_NO: string;
  LONGBRIDGE_ACCOUNT_NAME: string;
  LONGBRIDGE_USE_MOCK: string;
}

export function isTruthy(val: string | undefined): boolean {
  if (!val) return false;
  return ["true", "1", "yes", "on"].includes(val.trim().toLowerCase());
}

// --- Response types ---

export interface SyncResult {
  success: boolean;
  imported: number;
  message: string;
}

export interface IbkrReport {
  id: number;
  broker_source: string;
  symbol: string;
  quantity: number;
  avg_cost: number;
  market_value: number;
  unrealized_pnl: number;
  currency: string;
  report_date: string;
}

export interface LongbridgePosition {
  id: number;
  broker_source: string;
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

export interface BrokerSummary {
  broker_source: string;
  total_market_value: number;
  total_unrealized_pnl: number;
}

export interface PortfolioSummary {
  brokers: BrokerSummary[];
  total_market_value: number;
  total_unrealized_pnl: number;
}

export interface DailySnapshot {
  date: string;
  total_value_usd: number;
}
