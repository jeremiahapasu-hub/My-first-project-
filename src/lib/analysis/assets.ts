import { ASSET_ALIASES, STRATEGY_PATTERNS } from "@/lib/analysis/lexicon";

/**
 * Currency codes recognised when reconstructing a pair. Kept explicit so that
 * random three-letter words ("THE", "BUY", "OTC") don't get read as currencies.
 */
const CURRENCIES = new Set([
  "EUR", "USD", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF",
  "SEK", "NOK", "TRY", "ZAR", "MXN", "SGD", "HKD", "CNH",
  "BTC", "ETH", "LTC", "XRP", "SOL", "ADA", "DOGE",
  "XAU", "XAG", "WTI",
]);

/** Indices and commodities that appear as standalone symbols, not pairs. */
const STANDALONE = new Set([
  "NAS100", "SPX500", "US30", "GER40", "UK100", "JPN225", "AUS200", "FRA40",
]);

/**
 * Pocket Option writes over-the-counter variants as e.g. "EUR/USD OTC".
 * The suffix matters — OTC pricing is broker-synthesised, so it is kept as part
 * of the canonical symbol rather than folded into the base pair.
 */
const OTC_SUFFIX = /\s*[-(]?\s*otc\s*\)?/i;

/**
 * Normalises anything that looks like an asset into a canonical symbol.
 *
 * Handles `EURUSD`, `EUR/USD`, `EUR-USD`, `eur usd`, `EURUSD-OTC`, aliases like
 * "gold", and standalone index symbols. Returns null when the input isn't an asset.
 */
export function canonicalAsset(raw: string): string | null {
  if (!raw) return null;

  const isOtc = OTC_SUFFIX.test(raw);
  const cleaned = raw.replace(OTC_SUFFIX, "").trim();
  const upper = cleaned.toUpperCase().replace(/[^A-Z0-9/]/g, "");

  const withOtc = (symbol: string) => (isOtc ? `${symbol} OTC` : symbol);

  const alias = ASSET_ALIASES[cleaned.toLowerCase().replace(/[^a-z0-9]/g, "")];
  if (alias) return withOtc(alias);

  if (STANDALONE.has(upper)) return withOtc(upper);

  // Already delimited: EUR/USD
  if (upper.includes("/")) {
    const [base, quote] = upper.split("/");
    if (CURRENCIES.has(base) && CURRENCIES.has(quote)) {
      return withOtc(`${base}/${quote}`);
    }
    return null;
  }

  // Concatenated: EURUSD
  if (upper.length === 6) {
    const base = upper.slice(0, 3);
    const quote = upper.slice(3);
    if (CURRENCIES.has(base) && CURRENCIES.has(quote)) {
      return withOtc(`${base}/${quote}`);
    }
  }

  return null;
}

/** Finds every distinct asset mentioned in a block of text. */
export function detectAssets(text: string): string[] {
  const found = new Set<string>();

  // Pairs written with a delimiter, plus an optional OTC marker.
  const delimited = text.matchAll(
    /\b([A-Za-z]{3})\s?[/\-_]\s?([A-Za-z]{3})\b(\s*\(?\s*otc\s*\)?)?/gi,
  );
  for (const match of delimited) {
    const symbol = canonicalAsset(
      `${match[1]}/${match[2]}${match[3] ? " OTC" : ""}`,
    );
    if (symbol) found.add(symbol);
  }

  // Bare six-letter pairs and standalone symbols.
  const bare = text.matchAll(/\b([A-Za-z]{6}|[A-Z]{2,3}\d{2,3})\b(\s*\(?\s*otc\s*\)?)?/g);
  for (const match of bare) {
    const symbol = canonicalAsset(`${match[1]}${match[2] ? " OTC" : ""}`);
    if (symbol) found.add(symbol);
  }

  // Colloquial names.
  for (const alias of Object.keys(ASSET_ALIASES)) {
    const pattern = new RegExp(`\\b${alias}\\b`, "i");
    if (pattern.test(text)) {
      const symbol = canonicalAsset(alias);
      if (symbol) found.add(symbol);
    }
  }

  return [...found].sort();
}

/** Finds every strategy whose vocabulary appears in the text. */
export function detectStrategies(text: string): string[] {
  const haystack = text.toLowerCase();
  const found: string[] = [];

  for (const [strategy, phrases] of Object.entries(STRATEGY_PATTERNS)) {
    if (phrases.some((phrase) => haystack.includes(phrase))) {
      found.push(strategy);
    }
  }

  return found.sort();
}
