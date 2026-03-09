import { Env } from "../types";

const TWELVE_DATA_BASE = "https://api.twelvedata.com";

/**
 * Fetch real-time prices from Twelve Data API.
 * Accepts symbols in any format (IBKR or Longbridge) and normalizes them.
 * Returns a map: original_symbol -> price
 */
export async function fetchQuotes(env: Env, symbols: string[]): Promise<Record<string, number>> {
  if (!env.TWELVE_API_KEY || symbols.length === 0) return {};

  const tdToOriginal: Record<string, string[]> = {};
  for (const symbol of symbols) {
    const normalized = toTwelveDataSymbol(symbol);
    if (!normalized) continue;
    if (!tdToOriginal[normalized]) tdToOriginal[normalized] = [];
    tdToOriginal[normalized].push(symbol);
  }

  const tdSymbols = Object.keys(tdToOriginal);
  const tdQuotes = await fetchTwelveQuotes(env, tdSymbols);

  const mapped: Record<string, number> = {};
  for (const [tdSymbol, originals] of Object.entries(tdToOriginal)) {
    const price = tdQuotes[tdSymbol];
    if (price === undefined) continue;
    for (const original of originals) mapped[original] = price;
  }
  return mapped;
}

/** Fetch FX rates to USD. Example: HKD -> HKD/USD */
export async function fetchFxToUsd(env: Env, currencies: string[]): Promise<Record<string, number>> {
  const rates: Record<string, number> = { USD: 1 };
  if (!env.TWELVE_API_KEY || currencies.length === 0) return rates;

  const normalized = Array.from(
    new Set(currencies.map((currency) => currency.trim().toUpperCase()).filter(Boolean))
  );

  const tdToCurrency: Record<string, string> = {};
  for (const currency of normalized) {
    if (currency === "USD") continue;
    tdToCurrency[`${currency}/USD`] = currency;
  }

  const tdSymbols = Object.keys(tdToCurrency);
  const tdQuotes = await fetchTwelveQuotes(env, tdSymbols);

  for (const [tdSymbol, currency] of Object.entries(tdToCurrency)) {
    const rate = tdQuotes[tdSymbol];
    if (rate !== undefined) {
      rates[currency] = rate;
    }
  }

  return rates;
}

/**
 * Convert broker-specific symbol to Twelve Data format.
 * - Longbridge "AVGO.US" -> "AVGO"
 * - Longbridge "00700.HK" -> "00700:HKEX" or keep as-is
 * - IBKR "AAPL" -> "AAPL"
 * - IBKR options "AMZN  270115C00250000" -> null (skip)
 */
function toTwelveDataSymbol(symbol: string): string | null {
  // Skip options (contain spaces or long format)
  if (/\s/.test(symbol.trim())) return null;

  // Longbridge format: SYMBOL.MARKET
  if (symbol.includes(".")) {
    const parts = symbol.split(".");
    const ticker = parts[0];
    const market = parts[parts.length - 1].toUpperCase();

    if (market === "US") return ticker;
    if (market === "HK") return ticker + ".HK"; // Twelve Data uses XXXX.HK for HK stocks
    return ticker;
  }

  // Plain symbol (IBKR stocks/ETFs)
  return symbol;
}

async function fetchTwelveQuotes(env: Env, symbols: string[]): Promise<Record<string, number>> {
  if (!env.TWELVE_API_KEY || symbols.length === 0) return {};

  const quotes: Record<string, number> = {};

  // Keep batch size conservative for API limits.
  for (let i = 0; i < symbols.length; i += 8) {
    const batch = symbols.slice(i, i + 8);
    const url = `${TWELVE_DATA_BASE}/quote?symbol=${encodeURIComponent(batch.join(","))}&apikey=${env.TWELVE_API_KEY}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`Twelve Data quote request failed (${response.status}) for: ${batch.join(",")}`);
        continue;
      }

      const payload = (await response.json()) as Record<string, unknown>;
      if (batch.length === 1) {
        const symbol = batch[0];
        const price = parseQuotePrice(payload);
        if (price !== undefined) {
          quotes[symbol] = price;
        }
        continue;
      }

      for (const symbol of batch) {
        const quote = payload[symbol];
        if (!quote || typeof quote !== "object") continue;
        const price = parseQuotePrice(quote as Record<string, unknown>);
        if (price !== undefined) {
          quotes[symbol] = price;
        }
      }
    } catch (error) {
      console.error(`Twelve Data quote request failed for: ${batch.join(",")}`, error);
    }
  }

  return quotes;
}

function parseQuotePrice(payload: Record<string, unknown>): number | undefined {
  const status = payload.status;
  if (typeof status === "string" && status.toLowerCase() === "error") {
    return undefined;
  }

  const close = toPositiveNumber(payload.close);
  if (close !== undefined) return close;

  const price = toPositiveNumber(payload.price);
  if (price !== undefined) return price;

  return toPositiveNumber(payload.previous_close);
}

function toPositiveNumber(input: unknown): number | undefined {
  if (typeof input !== "string" && typeof input !== "number") return undefined;
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}
