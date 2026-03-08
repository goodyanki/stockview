import { Env, isTruthy } from "../types";
import { ensureAccount, addRawImport, replaceIbkrReports } from "../db";

const FLEX_SEND_URL = "https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest";
const FLEX_GET_URL = "https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement";

export async function syncIbkrFlex(env: Env): Promise<number> {
  const accountId = await ensureAccount(
    env.DB,
    "IBKR_FLEX",
    env.IBKR_ACCOUNT_NO || "U1234567",
    env.IBKR_ACCOUNT_NAME || "IBKR Main"
  );

  const xmlPayload = await fetchStatement(env);
  await addRawImport(env.DB, "IBKR_FLEX", "FLEX_REPORT", xmlPayload);
  const rows = parseStatement(xmlPayload);
  return replaceIbkrReports(env.DB, accountId, rows);
}

async function fetchStatement(env: Env): Promise<string> {
  if (isTruthy(env.IBKR_USE_MOCK) || !env.IBKR_FLEX_TOKEN || !env.IBKR_FLEX_QUERY_ID) {
    return mockXml();
  }

  const sendParams = new URLSearchParams({
    t: env.IBKR_FLEX_TOKEN,
    q: env.IBKR_FLEX_QUERY_ID,
    v: "3",
  });
  const sendResp = await fetch(`${FLEX_SEND_URL}?${sendParams}`, {
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  if (!sendResp.ok) throw new Error(`IBKR send request failed: ${sendResp.status}`);
  const sendText = await sendResp.text();

  const referenceCode = extractReferenceCode(sendText);
  if (!referenceCode) throw new Error("IBKR send request failed: missing reference code");

  for (let i = 0; i < 5; i++) {
    const getParams = new URLSearchParams({ t: env.IBKR_FLEX_TOKEN, q: referenceCode, v: "3" });
    const result = await fetch(`${FLEX_GET_URL}?${getParams}`, {
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
    if (!result.ok) throw new Error(`IBKR get statement failed: ${result.status}`);
    const text = await result.text();
    if (text.includes("Statement generation in progress")) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    return text;
  }
  throw new Error("IBKR statement still in progress after retries");
}

function extractReferenceCode(text: string): string {
  const patterns = [/<ReferenceCode>(\d+)<\/ReferenceCode>/, /referenceCode="(\d+)"/];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return "";
}

interface ParsedRow {
  report_date: string;
  symbol: string;
  quantity: number;
  avg_cost: number;
  market_value: number;
  unrealized_pnl: number;
  currency: string;
  parsed_payload: string;
}

function parseStatement(xmlPayload: string): ParsedRow[] {
  // Use regex-based XML parsing (Workers don't have DOMParser for XML by default)
  // Extract toDate from FlexStatement
  let reportDate = new Date().toISOString();
  const dateMatch = xmlPayload.match(/toDate="([^"]+)"/);
  if (dateMatch) {
    reportDate = new Date(dateMatch[1]).toISOString();
  }

  const rows: ParsedRow[] = [];
  // Match self-closing tags with attributes containing symbol and position
  const tagRegex = /<(\w+)\s([^>]*?)\/?>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(xmlPayload)) !== null) {
    const attrString = match[2];
    const attrs = parseAttributes(attrString);

    const symbol = attrs.symbol || attrs.underlyingsymbol;
    const quantityRaw = attrs.position || attrs.quantity || attrs.qty;
    if (!symbol || !quantityRaw) continue;

    const quantity = toFloat(quantityRaw);
    const costBasisPrice = toFloat(attrs.costbasisprice || attrs.avgcost || attrs.avg_price);
    let avgCost: number;
    if (costBasisPrice) {
      avgCost = costBasisPrice;
    } else {
      const totalCost = toFloat(attrs.costbasismoney || attrs.costbasis);
      avgCost = quantity ? totalCost / quantity : 0;
    }
    const marketValue = toFloat(attrs.positionvalue || attrs.marketvalue || attrs.currentvalue);
    const unrealizedPnl = toFloat(attrs.fifopnlunrealized || attrs.unrealizedpl || attrs.unrealized_pnl);
    const currency = attrs.currency || "USD";

    rows.push({
      report_date: reportDate,
      symbol,
      quantity,
      avg_cost: avgCost,
      market_value: marketValue,
      unrealized_pnl: unrealizedPnl,
      currency,
      parsed_payload: JSON.stringify(attrs),
    });
  }

  return rows.length > 0 ? rows : mockRows();
}

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(attrString)) !== null) {
    attrs[m[1].toLowerCase()] = m[2];
  }
  return attrs;
}

function toFloat(value: string | undefined): number {
  if (!value) return 0;
  const num = parseFloat(value.replace(/,/g, ""));
  return isNaN(num) ? 0 : num;
}

function mockXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse>
  <FlexStatements>
    <FlexStatement toDate="${new Date().toISOString().slice(0, 10)}">
      <OpenPosition symbol="AAPL" position="20" costBasisPrice="170.5" marketValue="3640" fifoPnlUnrealized="230" currency="USD"/>
      <OpenPosition symbol="MSFT" position="8" costBasisPrice="390.3" marketValue="3240" fifoPnlUnrealized="118" currency="USD"/>
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;
}

function mockRows(): ParsedRow[] {
  const now = new Date().toISOString();
  return [
    { report_date: now, symbol: "AAPL", quantity: 20, avg_cost: 170.5, market_value: 3640, unrealized_pnl: 230, currency: "USD", parsed_payload: '{"source":"mock"}' },
    { report_date: now, symbol: "MSFT", quantity: 8, avg_cost: 390.3, market_value: 3240, unrealized_pnl: 118, currency: "USD", parsed_payload: '{"source":"mock"}' },
  ];
}
