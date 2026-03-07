CREATE TABLE IF NOT EXISTS brokers (
  id SERIAL PRIMARY KEY,
  code VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(128) NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  broker_id INTEGER NOT NULL REFERENCES brokers(id),
  account_no VARCHAR(64) NOT NULL,
  account_name VARCHAR(128) NOT NULL,
  CONSTRAINT uq_broker_account UNIQUE (broker_id, account_no)
);

CREATE TABLE IF NOT EXISTS raw_imports (
  id SERIAL PRIMARY KEY,
  broker_source VARCHAR(64) NOT NULL,
  import_type VARCHAR(64) NOT NULL,
  raw_payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_imports_source ON raw_imports (broker_source);
CREATE INDEX IF NOT EXISTS idx_raw_imports_type ON raw_imports (import_type);
CREATE INDEX IF NOT EXISTS idx_raw_imports_created_at ON raw_imports (created_at);

CREATE TABLE IF NOT EXISTS positions (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  broker_source VARCHAR(64) NOT NULL,
  symbol VARCHAR(64) NOT NULL,
  market VARCHAR(32) NOT NULL DEFAULT '',
  quantity DOUBLE PRECISION NOT NULL,
  avg_cost DOUBLE PRECISION NOT NULL,
  last_price DOUBLE PRECISION NOT NULL,
  current_value DOUBLE PRECISION NOT NULL,
  cost_value DOUBLE PRECISION NOT NULL,
  unrealized_pnl DOUBLE PRECISION NOT NULL,
  unrealized_pnl_pct DOUBLE PRECISION NOT NULL,
  currency VARCHAR(16) NOT NULL DEFAULT 'USD',
  snapshot_time TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_positions_source ON positions (broker_source);
CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions (symbol);
CREATE INDEX IF NOT EXISTS idx_positions_snapshot_time ON positions (snapshot_time);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  broker_source VARCHAR(64) NOT NULL,
  report_type VARCHAR(64) NOT NULL DEFAULT 'FLEX_REPORT',
  report_date TIMESTAMPTZ NOT NULL,
  symbol VARCHAR(64) NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  avg_cost DOUBLE PRECISION NOT NULL,
  market_value DOUBLE PRECISION NOT NULL,
  unrealized_pnl DOUBLE PRECISION NOT NULL,
  currency VARCHAR(16) NOT NULL DEFAULT 'USD',
  parsed_payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_source ON reports (broker_source);
CREATE INDEX IF NOT EXISTS idx_reports_symbol ON reports (symbol);
CREATE INDEX IF NOT EXISTS idx_reports_report_date ON reports (report_date);

