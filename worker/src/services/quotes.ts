import { Env } from "../types";

const YAHOO_CHART_ENDPOINT = "https://query1.finance.yahoo.com/v8/finance/chart";

/**
 * Fetch delayed market prices from Yahoo Finance.
 * Accepts symbols in any format (IBKR or Longbridge) and normalizes them.
 * Returns a map: original_symbol -> price
 */
export async function fetchQuotes(env: Env, symbols: string[]): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};

  const yahooToOriginal: Record<string, string[]> = {};
  for (const symbol of symbols) {
    const normalized = toYahooSymbol(symbol);
    if (!normalized) continue;
    if (!yahooToOriginal[normalized]) yahooToOriginal[normalized] = [];
    yahooToOriginal[normalized].push(symbol);
  }

  const yahooSymbols = Object.keys(yahooToOriginal);
  const yahooQuotes = await fetchYahooQuotes(env, yahooSymbols);

  const mapped: Record<string, number> = {};
  for (const [yahooSymbol, originals] of Object.entries(yahooToOriginal)) {
    const price = yahooQuotes[yahooSymbol];
    if (price === undefined) continue;
    for (const original of originals) mapped[original] = price;
  }
  return mapped;
}

/** Fetch FX rates to USD from Yahoo Finance. Example: HKD -> HKDUSD=X */
export async function fetchFxToUsd(env: Env, currencies: string[]): Promise<Record<string, number>> {
  const rates: Record<string, number> = { USD: 1 };
  if (currencies.length === 0) return rates;

  const normalized = Array.from(
    new Set(currencies.map((currency) => currency.trim().toUpperCase()).filter(Boolean))
  );

  const yahooToCurrency: Record<string, string> = {};
  for (const currency of normalized) {
    if (currency === "USD") continue;
    yahooToCurrency[`${currency}USD=X`] = currency;
  }

  const yahooSymbols = Object.keys(yahooToCurrency);
  const yahooQuotes = await fetchYahooQuotes(env, yahooSymbols);

  for (const [yahooSymbol, currency] of Object.entries(yahooToCurrency)) {
    const rate = yahooQuotes[yahooSymbol];
    if (rate !== undefined) {
      rates[currency] = rate;
    }
  }

  return rates;
}

/**
 * Convert broker-specific symbol to Yahoo Finance format.
 * - Longbridge "AVGO.US" -> "AVGO"
 * - Longbridge "00700.HK" -> "0700.HK"
 * - IBKR "BRK.B" -> "BRK-B"
 * - IBKR options "AMZN  270115C00250000" -> null (skip)
 */
function toYahooSymbol(symbol: string): string | null {
  const trimmed = symbol.trim();
  if (!trimmed || looksLikeOptionSymbol(trimmed)) return null;

  // Longbridge format: SYMBOL.MARKET; keep only known suffixes.
  if (trimmed.includes(".")) {
    const parts = trimmed.split(".");
    const ticker = parts.slice(0, -1).join(".");
    const market = parts[parts.length - 1].toUpperCase();

    if (market === "US") return normalizeUsTicker(ticker);
    if (market === "HK") return normalizeHkTicker(ticker);
    return normalizeUsTicker(ticker);
  }

  return normalizeUsTicker(trimmed);
}

function looksLikeOptionSymbol(symbol: string): boolean {
  // Typical IBKR option symbol format, e.g. "AMZN  270115C00250000"
  if (/\s+\d{6}[CP]\d{8}$/.test(symbol.toUpperCase())) return true;
  // Conservative fallback: spaces with many digits are very likely derivatives, not equities.
  return /\s/.test(symbol) && /\d{4,}/.test(symbol);
}

function normalizeUsTicker(ticker: string): string | null {
  const compact = ticker.trim().toUpperCase();
  if (!compact) return null;

  if (/\s/.test(compact)) {
    const collapsed = compact.replace(/\s+/g, " ");
    // Support class shares in spaced form, e.g. "BRK B" -> "BRK-B"
    if (/^[A-Z0-9]+\s[A-Z0-9]+$/.test(collapsed)) {
      return collapsed.replace(" ", "-");
    }
    return null;
  }

  return compact.replace(/\./g, "-");
}

function normalizeHkTicker(ticker: string): string | null {
  const compact = ticker.trim().toUpperCase();
  if (!compact) return null;

  if (/^\d+$/.test(compact)) {
    // Yahoo HK equity format expects 4 digits, e.g. 0700.HK, 9988.HK
    const code = Number.parseInt(compact, 10).toString().padStart(4, "0");
    return `${code}.HK`;
  }

  return `${compact}.HK`;
}

async function fetchYahooQuotes(_env: Env, symbols: string[]): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};

  const quotes: Record<string, number> = {};
  const uniqueSymbols = Array.from(new Set(symbols.filter(Boolean)));

  const concurrency = 8;
  for (let i = 0; i < uniqueSymbols.length; i += concurrency) {
    const chunk = uniqueSymbols.slice(i, i + concurrency);
    const pairs = await Promise.all(
      chunk.map(async (symbol) => {
        const price = await fetchYahooChartPrice(symbol);
        return [symbol, price] as const;
      })
    );

    for (const [symbol, price] of pairs) {
      if (price !== undefined) {
        quotes[symbol] = price;
      }
    }
  }

  return quotes;
}

async function fetchYahooChartPrice(symbol: string): Promise<number | undefined> {
  const url = `${YAHOO_CHART_ENDPOINT}/${encodeURIComponent(symbol)}?interval=1d&range=5d`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Yahoo chart request failed (${response.status}) for: ${symbol}`);
      return undefined;
    }

    const payload = (await response.json()) as any;
    const result = payload?.chart?.result?.[0];
    if (!result || typeof result !== "object") return undefined;

    return parseYahooPrice(result);
  } catch (error) {
    console.error(`Yahoo chart request failed for: ${symbol}`, error);
    return undefined;
  }
}

function parseYahooPrice(payload: Record<string, unknown>): number | undefined {
  const meta = (payload.meta || {}) as Record<string, unknown>;
  const indicators = (payload.indicators || {}) as Record<string, unknown>;
  const quoteList = Array.isArray(indicators.quote) ? indicators.quote : [];
  const quote0 = (quoteList[0] || {}) as Record<string, unknown>;

  const closeSeries = Array.isArray(quote0.close) ? quote0.close : [];
  const latestClose = findLastPositiveNumber(closeSeries);

  return (
    toPositiveNumber(meta.regularMarketPrice) ??
    toPositiveNumber(meta.previousClose) ??
    toPositiveNumber(meta.chartPreviousClose) ??
    latestClose
  );
}

function findLastPositiveNumber(items: unknown[]): number | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const value = toPositiveNumber(items[i]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function toPositiveNumber(input: unknown): number | undefined {
  if (typeof input !== "string" && typeof input !== "number") return undefined;
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}
