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
  cost_value: number;
  last_price: number | null;
  market_value: number | null;
  unrealized_pnl: number | null;
  market_value_usd: number | null;
  cost_value_usd: number | null;
  unrealized_pnl_usd: number | null;
  has_live_price: boolean;
  live_price_missing_reason: string | null;
  has_fx_rate: boolean;
  fx_rate_to_usd: number | null;
  fx_rate_missing_reason: string | null;
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
  cost_value: number;
  last_price: number | null;
  current_value: number | null;
  market_value: number | null;
  unrealized_pnl: number | null;
  unrealized_pnl_pct: number | null;
  market_value_usd: number | null;
  cost_value_usd: number | null;
  unrealized_pnl_usd: number | null;
  has_live_price: boolean;
  live_price_missing_reason: string | null;
  has_fx_rate: boolean;
  fx_rate_to_usd: number | null;
  fx_rate_missing_reason: string | null;
  currency: string;
  snapshot_time: string;
}

export interface BrokerSummary {
  broker_source: string;
  total_market_value_usd: number;
  total_unrealized_pnl_usd: number;
  total_market_value: number;
  total_unrealized_pnl: number;
  total_positions: number;
  priced_positions: number;
}

export interface DataQualitySummary {
  total_positions: number;
  priced_positions: number;
  missing_live_price_symbols: string[];
  missing_fx_currencies: string[];
}

export interface PortfolioSummary {
  brokers: BrokerSummary[];
  total_market_value_usd: number;
  total_unrealized_pnl_usd: number;
  total_market_value: number;
  total_unrealized_pnl: number;
  data_quality: DataQualitySummary;
}

export interface DailySnapshot {
  date: string;
  total_value_usd: number;
}
