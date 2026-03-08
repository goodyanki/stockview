/** Ensure broker exists, return its id */
export async function ensureBroker(db: D1Database, code: string, name: string): Promise<number> {
  const row = await db.prepare("SELECT id FROM brokers WHERE code = ?").bind(code).first<{ id: number }>();
  if (row) return row.id;
  const result = await db.prepare("INSERT INTO brokers (code, name) VALUES (?, ?)").bind(code, name).run();
  return result.meta.last_row_id as number;
}

/** Ensure account exists, return its id */
export async function ensureAccount(
  db: D1Database,
  brokerCode: string,
  accountNo: string,
  accountName: string
): Promise<number> {
  const brokerId = await ensureBroker(db, brokerCode, brokerCode);
  const row = await db
    .prepare("SELECT id FROM accounts WHERE broker_id = ? AND account_no = ?")
    .bind(brokerId, accountNo)
    .first<{ id: number }>();
  if (row) return row.id;
  const result = await db
    .prepare("INSERT INTO accounts (broker_id, account_no, account_name) VALUES (?, ?, ?)")
    .bind(brokerId, accountNo, accountName)
    .run();
  return result.meta.last_row_id as number;
}

/** Save raw import for audit */
export async function addRawImport(
  db: D1Database,
  brokerSource: string,
  importType: string,
  rawPayload: string
): Promise<void> {
  await db
    .prepare("INSERT INTO raw_imports (broker_source, import_type, raw_payload) VALUES (?, ?, ?)")
    .bind(brokerSource, importType, rawPayload)
    .run();
}

/** Replace all IBKR reports for an account */
export async function replaceIbkrReports(
  db: D1Database,
  accountId: number,
  rows: Array<{
    report_date: string;
    symbol: string;
    quantity: number;
    avg_cost: number;
    market_value: number;
    unrealized_pnl: number;
    currency: string;
    parsed_payload: string;
  }>
): Promise<number> {
  await db
    .prepare("DELETE FROM reports WHERE account_id = ? AND broker_source = 'IBKR_FLEX'")
    .bind(accountId)
    .run();

  const stmt = db.prepare(
    `INSERT INTO reports (account_id, broker_source, report_type, report_date, symbol, quantity, avg_cost, market_value, unrealized_pnl, currency, parsed_payload)
     VALUES (?, 'IBKR_FLEX', 'FLEX_REPORT', ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const batch = rows.map((r) =>
    stmt.bind(accountId, r.report_date, r.symbol, r.quantity, r.avg_cost, r.market_value, r.unrealized_pnl, r.currency, r.parsed_payload)
  );

  if (batch.length > 0) {
    await db.batch(batch);
  }
  return rows.length;
}

/** Replace all Longbridge positions for an account */
export async function replaceLongbridgePositions(
  db: D1Database,
  accountId: number,
  rows: Array<{
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
  }>
): Promise<number> {
  await db
    .prepare("DELETE FROM positions WHERE account_id = ? AND broker_source = 'LONGBRIDGE_OPENAPI'")
    .bind(accountId)
    .run();

  const stmt = db.prepare(
    `INSERT INTO positions (account_id, broker_source, symbol, market, quantity, avg_cost, last_price, current_value, cost_value, unrealized_pnl, unrealized_pnl_pct, currency, snapshot_time)
     VALUES (?, 'LONGBRIDGE_OPENAPI', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const batch = rows.map((r) =>
    stmt.bind(
      accountId, r.symbol, r.market, r.quantity, r.avg_cost, r.last_price,
      r.current_value, r.cost_value, r.unrealized_pnl, r.unrealized_pnl_pct,
      r.currency, r.snapshot_time
    )
  );

  if (batch.length > 0) {
    await db.batch(batch);
  }
  return rows.length;
}

/** Save or update daily snapshot */
export async function saveDailySnapshot(db: D1Database, totalValueUsd: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const existing = await db.prepare("SELECT id FROM daily_snapshots WHERE date = ?").bind(today).first();
  if (existing) {
    await db.prepare("UPDATE daily_snapshots SET total_value_usd = ? WHERE date = ?").bind(totalValueUsd, today).run();
  } else {
    await db.prepare("INSERT INTO daily_snapshots (date, total_value_usd) VALUES (?, ?)").bind(today, totalValueUsd).run();
  }
}
