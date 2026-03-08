import { Env } from "../types";

const TWELVE_DATA_BASE = "https://api.twelvedata.com";

export interface QuoteResult {
  symbol: string;
  price: number;
}

/**
 * Fetch real-time prices from Twelve Data API.
 * Accepts symbols in any format (IBKR or Longbridge) and normalizes them.
 * Returns a map: original_symbol -> price
 */
export async function fetchQuotes(env: Env, symbols: string[]): Promise<Record<string, number>> {
  if (!env.TWELVE_API_KEY || symbols.length === 0) return {};

  // Build mapping: twelveDataSymbol -> originalSymbol[]
  const tdToOriginal: Record<string, string[]> = {};
  for (const sym of symbols) {
    const tdSym = toTwelveDataSymbol(sym);
    if (!tdSym) continue; // skip unsupported (e.g. options)
    if (!tdToOriginal[tdSym]) tdToOriginal[tdSym] = [];
    tdToOriginal[tdSym].push(sym);
  }

  const tdSymbols = Object.keys(tdToOriginal);
  if (tdSymbols.length === 0) return {};

  // Twelve Data supports comma-separated symbols in /quote
  const priceMap: Record<string, number> = {};

  // Batch in groups of 8 to stay within rate limits
  for (let i = 0; i < tdSymbols.length; i += 8) {
    const batch = tdSymbols.slice(i, i + 8);
    const url = `${TWELVE_DATA_BASE}/quote?symbol=${encodeURIComponent(batch.join(","))}&apikey=${env.TWELVE_API_KEY}`;

    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const data = (await resp.json()) as any;

      if (batch.length === 1) {
        // Single symbol: response is the quote object directly
        const price = parseFloat(data.close) || parseFloat(data.previous_close) || 0;
        for (const orig of tdToOriginal[batch[0]] || []) {
          priceMap[orig] = price;
        }
      } else {
        // Multiple symbols: response is keyed by symbol
        for (const tdSym of batch) {
          const quote = data[tdSym];
          if (!quote || quote.status === "error") continue;
          const price = parseFloat(quote.close) || parseFloat(quote.previous_close) || 0;
          for (const orig of tdToOriginal[tdSym] || []) {
            priceMap[orig] = price;
          }
        }
      }
    } catch (e) {
      console.error(`Twelve Data fetch failed for batch ${batch.join(",")}`, e);
    }
  }

  return priceMap;
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
