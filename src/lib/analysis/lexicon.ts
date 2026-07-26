/**
 * Vocabulary used by the chat analyser.
 *
 * This is a domain lexicon, not a general-purpose one: "call" and "put" are
 * directional here, "green"/"red" describe candles, and a phrase like "in the
 * money" is strongly positive in a trading room and meaningless elsewhere.
 *
 * Weights are on a -3..+3 scale and get normalised into [-1, 1] downstream.
 */

export const BULLISH_TERMS: Record<string, number> = {
  buy: 2,
  buying: 2,
  long: 2,
  call: 2,
  calls: 2,
  up: 1,
  bull: 2.5,
  bullish: 3,
  moon: 2,
  mooning: 2,
  pump: 2,
  pumping: 2,
  rally: 2.5,
  rallying: 2.5,
  breakout: 2.5,
  surge: 2,
  surging: 2,
  rise: 1.5,
  rising: 1.5,
  rebound: 2,
  recover: 1.5,
  recovery: 1.5,
  green: 1.5,
  gain: 2,
  gains: 2,
  profit: 2,
  profits: 2,
  win: 2.5,
  wins: 2.5,
  winning: 2.5,
  won: 2.5,
  itm: 2.5,
  strong: 1.5,
  support: 1,
  uptrend: 3,
  higher: 1.5,
  golden: 2,
  accumulate: 1.5,
  oversold: 1.5,
  "🚀": 2.5,
  "📈": 2.5,
  "🟢": 2,
  "💚": 1.5,
  "✅": 1.5,
};

export const BEARISH_TERMS: Record<string, number> = {
  sell: 2,
  selling: 2,
  short: 2,
  put: 2,
  puts: 2,
  down: 1,
  bear: 2.5,
  bearish: 3,
  dump: 2.5,
  dumping: 2.5,
  crash: 3,
  crashing: 3,
  drop: 2,
  dropping: 2,
  fall: 1.5,
  falling: 1.5,
  plunge: 2.5,
  reject: 2,
  rejection: 2,
  red: 1.5,
  loss: 2.5,
  losses: 2.5,
  lose: 2.5,
  losing: 2.5,
  lost: 2.5,
  otm: 2.5,
  weak: 1.5,
  resistance: 1,
  downtrend: 3,
  lower: 1.5,
  breakdown: 2.5,
  correction: 1.5,
  overbought: 1.5,
  liquidated: 3,
  "🔻": 2.5,
  "📉": 2.5,
  "🔴": 2,
  "❌": 1.5,
};

/**
 * Words that flip the polarity of the term that follows them, within a small
 * window. "not bullish" must not score as bullish.
 */
export const NEGATORS = new Set([
  "not",
  "no",
  "never",
  "dont",
  "don't",
  "doesnt",
  "doesn't",
  "isnt",
  "isn't",
  "wasnt",
  "wasn't",
  "avoid",
  "without",
  "cant",
  "can't",
  "stop",
  "hardly",
  "barely",
]);

/** Multipliers applied to the next scored term. */
export const INTENSIFIERS: Record<string, number> = {
  very: 1.5,
  super: 1.5,
  extremely: 1.8,
  huge: 1.6,
  massive: 1.7,
  strong: 1.4,
  strongly: 1.4,
  big: 1.3,
  slightly: 0.6,
  bit: 0.6,
  little: 0.6,
  somewhat: 0.7,
  maybe: 0.6,
  possibly: 0.6,
};

/**
 * Strategy vocabulary. Keys are canonical names; values are the phrases that
 * imply them. Matching is done on the normalised message body.
 */
export const STRATEGY_PATTERNS: Record<string, string[]> = {
  "Support & Resistance": [
    "support",
    "resistance",
    "s/r",
    "key level",
    "supply zone",
    "demand zone",
  ],
  "Trend Following": [
    "trend",
    "uptrend",
    "downtrend",
    "trend line",
    "trendline",
    "with the trend",
  ],
  "Moving Average": [
    "moving average",
    "ma cross",
    "ema",
    "sma",
    "golden cross",
    "death cross",
  ],
  RSI: ["rsi", "relative strength", "overbought", "oversold"],
  MACD: ["macd", "signal line", "histogram"],
  "Bollinger Bands": ["bollinger", "bands", "bb squeeze", "upper band", "lower band"],
  "Price Action": [
    "price action",
    "pin bar",
    "engulfing",
    "doji",
    "candlestick",
    "wick",
    "hammer",
  ],
  Breakout: ["breakout", "break out", "breaking out", "break above", "break below"],
  "Reversal": ["reversal", "reverse", "bounce", "retrace", "pullback"],
  "Martingale": ["martingale", "double down", "recover loss", "2x stake"],
  "News Trading": ["news", "nfp", "cpi", "fed", "fomc", "rate decision", "economic calendar"],
  "Fibonacci": ["fibonacci", "fib", "retracement", "0.618", "golden ratio"],
  "Scalping": ["scalp", "scalping", "quick trade", "1 min", "1m expiry", "30 sec"],
};

/**
 * Assets are detected structurally (see `assets.ts`) rather than from a fixed
 * list, but these aliases map colloquial names onto canonical symbols.
 */
export const ASSET_ALIASES: Record<string, string> = {
  bitcoin: "BTC/USD",
  btc: "BTC/USD",
  ethereum: "ETH/USD",
  eth: "ETH/USD",
  cable: "GBP/USD",
  fiber: "EUR/USD",
  gold: "XAU/USD",
  xau: "XAU/USD",
  silver: "XAG/USD",
  oil: "WTI/USD",
  crude: "WTI/USD",
  nasdaq: "NAS100",
  ndx: "NAS100",
  sp500: "SPX500",
  spx: "SPX500",
  dax: "GER40",
  dow: "US30",
};

/** Phrases that mark a message as promotional rather than analytical. */
export const SPAM_PATTERNS: { label: string; test: RegExp }[] = [
  { label: "invite link", test: /(t\.me\/|discord\.gg\/|wa\.me\/|bit\.ly\/|chat\.whatsapp)/i },
  {
    label: "solicitation",
    test: /\b(dm me|inbox me|pm me|contact me|whatsapp me|join my|subscribe|vip (group|signal|channel))\b/i,
  },
  {
    label: "guaranteed returns",
    test: /\b(guaranteed|100% (win|accuracy|profit)|no loss|risk[- ]free|double your (money|account))\b/i,
  },
  { label: "referral", test: /\b(referral|promo code|sign ?up (link|bonus)|use my link)\b/i },
  { label: "account management", test: /\b(i (can )?manage your account|send me your (login|credentials|password))\b/i },
];
