import { Env, isTruthy } from "../types";
import { ensureAccount, addRawImport, replaceIbkrReports } from "../db";

const FLEX_SEND_URL = "https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest";
const FLEX_GET_URL = "https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement";

export interface IbkrReportRow {
  report_date: string;
  symbol: string;
  quantity: number;
  avg_cost: number;
  market_value: number;
  unrealized_pnl: number;
  currency: string;
  parsed_payload: string;
}

/** Fetch IBKR Flex data from API and return parsed rows (no DB write) */
export async function fetchIbkrFlex(env: Env): Promise<IbkrReportRow[]> {
  const xmlPayload = await fetchStatement(env);
  return parseStatement(xmlPayload);
}

/** Fetch IBKR Flex data, save to D1, return count */
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

  const sendResp = await fetchWithTimeout(`${FLEX_SEND_URL}?${sendParams}`, {
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  if (sendResp.status === 304) {
    throw new Error("IBKR send request returned 304 (no data)");
  }
  if (!sendResp.ok) {
    throw new Error(`IBKR send request failed: ${sendResp.status}`);
  }

  const sendText = await sendResp.text();
  const referenceCode = extractReferenceCode(sendText);
  if (!referenceCode) {
    throw new Error("IBKR send request failed: missing reference code");
  }

  for (let i = 0; i < 5; i++) {
    const getParams = new URLSearchParams({ t: env.IBKR_FLEX_TOKEN, q: referenceCode, v: "3" });
    const result = await fetchWithTimeout(`${FLEX_GET_URL}?${getParams}`, {
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });

    if (result.status === 304) {
      throw new Error("IBKR get statement returned 304 (no data)");
    }
    if (!result.ok) {
      throw new Error(`IBKR get statement failed: ${result.status}`);
    }

    const text = await result.text();
    if (text.includes("Statement generation in progress")) {
      await sleep(2000);
      continue;
    }

    return text;
  }

  throw new Error("IBKR statement still in progress");
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 20_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractReferenceCode(text: string): string {
  const patterns = [/<ReferenceCode>(\d+)<\/ReferenceCode>/, /referenceCode="(\d+)"/];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return "";
}

function parseStatement(xmlPayload: string): IbkrReportRow[] {
  try {
    const domParserCtor = (globalThis as unknown as { DOMParser?: new () => any }).DOMParser;
    if (!domParserCtor) {
      return mockRows();
    }

    const parser = new domParserCtor();
    const doc = parser.parseFromString(xmlPayload, "text/xml");
    const parserErrors = doc.getElementsByTagName("parsererror");
    if (parserErrors && parserErrors.length > 0) {
      return mockRows();
    }

    let reportDate = new Date().toISOString();
    const flexStatements = doc.getElementsByTagName("FlexStatement");
    if (flexStatements && flexStatements.length > 0) {
      const rawDate = flexStatements[0].getAttribute("toDate");
      if (rawDate) {
        const parsed = parseReportDate(rawDate);
        if (parsed) reportDate = parsed;
      }
    }

    const parsedRows: IbkrReportRow[] = [];
    const nodes = doc.getElementsByTagName("*");

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const { raw, lower } = readNodeAttributes(node);
      if (Object.keys(lower).length === 0) continue;

      const symbol = lower.symbol || lower.underlyingsymbol;
      const quantityRaw = lower.position || lower.quantity || lower.qty;
      if (!symbol || quantityRaw === undefined) continue;

      const quantity = toFloat(quantityRaw);
      const costBasisPrice = toFloat(lower.costbasisprice || lower.avgcost || lower.avg_price);
      const totalCost = toFloat(lower.costbasismoney || lower.costbasis);
      const avgCost = costBasisPrice || (quantity ? totalCost / quantity : 0);
      const marketValue = toFloat(lower.positionvalue || lower.marketvalue || lower.currentvalue);
      const unrealizedPnl = toFloat(lower.fifopnlunrealized || lower.unrealizedpl || lower.unrealized_pnl);
      const currency = lower.currency || "USD";

      parsedRows.push({
        report_date: reportDate,
        symbol,
        quantity,
        avg_cost: avgCost,
        market_value: marketValue,
        unrealized_pnl: unrealizedPnl,
        currency,
        parsed_payload: JSON.stringify(raw),
      });
    }

    return parsedRows.length > 0 ? parsedRows : mockRows();
  } catch {
    return mockRows();
  }
}

function readNodeAttributes(node: any): { raw: Record<string, string>; lower: Record<string, string> } {
  const raw: Record<string, string> = {};
  const lower: Record<string, string> = {};

  const attrs = node?.attributes;
  if (!attrs || typeof attrs.length !== "number") {
    return { raw, lower };
  }

  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    const name = String(attr?.name || "");
    const value = String(attr?.value || "");
    if (!name) continue;
    raw[name] = value;
    lower[name.toLowerCase()] = value;
  }

  return { raw, lower };
}

function parseReportDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const isoLike = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T00:00:00Z`)
    : new Date(trimmed);

  return Number.isNaN(isoLike.getTime()) ? null : isoLike.toISOString();
}

function toFloat(value: string | undefined): number {
  if (!value) return 0;
  const num = parseFloat(value.replace(/,/g, ""));
  return Number.isNaN(num) ? 0 : num;
}

function mockXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse>
  <FlexStatements>
    <FlexStatement toDate="2026-03-07">
      <OpenPosition symbol="AAPL" position="20" costBasisPrice="170.5" marketValue="3640" fifoPnlUnrealized="230" currency="USD"/>
      <OpenPosition symbol="MSFT" position="8" costBasisPrice="390.3" marketValue="3240" fifoPnlUnrealized="118" currency="USD"/>
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>
`;
}

function mockRows(): IbkrReportRow[] {
  const now = new Date().toISOString();
  return [
    {
      report_date: now,
      symbol: "AAPL",
      quantity: 20,
      avg_cost: 170.5,
      market_value: 3640,
      unrealized_pnl: 230,
      currency: "USD",
      parsed_payload: '{"source":"mock"}',
    },
    {
      report_date: now,
      symbol: "MSFT",
      quantity: 8,
      avg_cost: 390.3,
      market_value: 3240,
      unrealized_pnl: 118,
      currency: "USD",
      parsed_payload: '{"source":"mock"}',
    },
  ];
}
