-- Brokers
CREATE TABLE IF NOT EXISTS brokers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

-- Accounts
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  broker_id INTEGER NOT NULL REFERENCES brokers(id),
  account_no TEXT NOT NULL,
  account_name TEXT NOT NULL,
  UNIQUE(broker_id, account_no)
);

-- Raw imports (audit trail)
CREATE TABLE IF NOT EXISTS raw_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  broker_source TEXT NOT NULL,
  import_type TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Positions (Longbridge real-time)
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  broker_source TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT '',
  quantity REAL NOT NULL,
  avg_cost REAL NOT NULL,
  last_price REAL NOT NULL,
  current_value REAL NOT NULL,
  cost_value REAL NOT NULL,
  unrealized_pnl REAL NOT NULL,
  unrealized_pnl_pct REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  snapshot_time TEXT NOT NULL
);

-- Reports (IBKR Flex)
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  broker_source TEXT NOT NULL,
  report_type TEXT NOT NULL DEFAULT 'FLEX_REPORT',
  report_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  quantity REAL NOT NULL,
  avg_cost REAL NOT NULL,
  market_value REAL NOT NULL,
  unrealized_pnl REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  parsed_payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Daily snapshots (chart data)
CREATE TABLE IF NOT EXISTS daily_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  total_value_usd REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_raw_imports_broker ON raw_imports(broker_source);
CREATE INDEX IF NOT EXISTS idx_raw_imports_created ON raw_imports(created_at);
CREATE INDEX IF NOT EXISTS idx_positions_account ON positions(account_id);
CREATE INDEX IF NOT EXISTS idx_positions_broker ON positions(broker_source);
CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol);
CREATE INDEX IF NOT EXISTS idx_positions_time ON positions(snapshot_time);
CREATE INDEX IF NOT EXISTS idx_reports_account ON reports(account_id);
CREATE INDEX IF NOT EXISTS idx_reports_broker ON reports(broker_source);
CREATE INDEX IF NOT EXISTS idx_reports_symbol ON reports(symbol);
CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(report_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_date ON daily_snapshots(date);

-- Seed default brokers
INSERT OR IGNORE INTO brokers (code, name) VALUES ('IBKR_FLEX', 'Interactive Brokers Flex');
INSERT OR IGNORE INTO brokers (code, name) VALUES ('LONGBRIDGE_OPENAPI', 'Longbridge OpenAPI');

-- Seed initial snapshot
INSERT OR IGNORE INTO daily_snapshots (date, total_value_usd) VALUES ('2026-01-05', 43369.0);
