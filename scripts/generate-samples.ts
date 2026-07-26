/**
 * Writes the sample dataset in `samples/`.
 *
 * The data is synthetic and generated from a fixed seed, so every checkout gets
 * byte-identical files. It is shaped to exercise the analysis code rather than to
 * flatter it: some assets genuinely underperform, one provider is much worse than
 * the others, there is a real losing streak, a promotional-spam cluster, and a
 * handful of deliberately malformed rows so the importer's error path is visible.
 *
 * Run with:  npm run samples
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Mulberry32 — small, fast, and deterministic given the same seed. */
function makeRng(seed: number) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(20260726);

const pick = <T,>(items: T[]): T => items[Math.floor(rng() * items.length)];
const between = (min: number, max: number) => min + rng() * (max - min);

/**
 * Per-asset behaviour. `edge` is the true win probability the generator draws
 * against, so the analysis has a real signal to find rather than pure noise.
 */
const ASSETS = [
  { symbol: "EUR/USD", edge: 0.58, weight: 20, payout: 0.82 },
  { symbol: "GBP/USD", edge: 0.54, weight: 14, payout: 0.8 },
  { symbol: "USD/JPY", edge: 0.51, weight: 12, payout: 0.81 },
  { symbol: "AUD/USD", edge: 0.47, weight: 9, payout: 0.78 },
  { symbol: "EUR/JPY", edge: 0.49, weight: 8, payout: 0.79 },
  { symbol: "GBP/JPY", edge: 0.41, weight: 8, payout: 0.77 },
  { symbol: "USD/CAD", edge: 0.52, weight: 6, payout: 0.8 },
  { symbol: "EUR/USD OTC", edge: 0.44, weight: 10, payout: 0.85 },
  { symbol: "GBP/USD OTC", edge: 0.43, weight: 7, payout: 0.85 },
  { symbol: "BTC/USD", edge: 0.55, weight: 6, payout: 0.7 },
  { symbol: "XAU/USD", edge: 0.56, weight: 5, payout: 0.75 },
];

const PROVIDERS = [
  { name: "AlphaPips Room", modifier: 0.05, weight: 30 },
  { name: "QuantEdge Bot", modifier: 0.02, weight: 25 },
  { name: "Daily Binary Club", modifier: -0.09, weight: 22 },
  { name: "Manual — own analysis", modifier: 0.03, weight: 15 },
  { name: "TelegramVIPSignals", modifier: -0.12, weight: 8 },
];

const TIMEFRAMES = [
  { seconds: 60, label: "M1", modifier: -0.05, weight: 22 },
  { seconds: 180, label: "M3", modifier: 0.0, weight: 18 },
  { seconds: 300, label: "M5", modifier: 0.04, weight: 32 },
  { seconds: 900, label: "M15", modifier: 0.03, weight: 18 },
  { seconds: 1800, label: "M30", modifier: 0.01, weight: 7 },
  { seconds: 3600, label: "H1", modifier: -0.02, weight: 3 },
];

/**
 * Liquidity by hour (UTC). The London/New York overlap really is different from
 * the Asian session, so the hourly chart should show that rather than a flat line.
 */
const HOUR_QUALITY: Record<number, number> = {
  0: -0.04, 1: -0.05, 2: -0.03, 3: -0.02, 4: -0.03, 5: -0.01,
  6: 0.01, 7: 0.03, 8: 0.05, 9: 0.06, 10: 0.05, 11: 0.03,
  12: 0.04, 13: 0.06, 14: 0.07, 15: 0.06, 16: 0.03, 17: 0.01,
  18: -0.01, 19: -0.02, 20: -0.03, 21: -0.04, 22: -0.05, 23: -0.05,
};

function weightedPick<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng() * total;

  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }

  return items[items.length - 1];
}

const DAYS = 92;
const END = new Date(Date.UTC(2026, 6, 25, 0, 0, 0));
const START = new Date(END.getTime() - DAYS * 86400 * 1000);

const pad = (n: number) => String(n).padStart(2, "0");

const fmtDateTime = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
  `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

type SignalRow = {
  entry: Date;
  expiry: Date;
  asset: string;
  direction: "BUY" | "SELL";
  timeframe: (typeof TIMEFRAMES)[number];
  result: "WIN" | "LOSS" | "DRAW" | "PENDING";
  stake: number;
  payoutPct: number;
  pnl: number;
  confidence: number;
  provider: string;
};

function generateSignals(): SignalRow[] {
  const rows: SignalRow[] = [];

  for (let day = 0; day < DAYS; day += 1) {
    const date = new Date(START.getTime() + day * 86400 * 1000);
    const weekday = date.getUTCDay();

    // Markets are thin at the weekend; OTC keeps a trickle going.
    const isWeekend = weekday === 0 || weekday === 6;
    const count = isWeekend
      ? Math.floor(between(0, 4))
      : Math.floor(between(4, 14));

    // A slow improvement over the period, so the trend detector has something
    // real to report rather than fitting noise.
    const learningCurve = (day / DAYS) * 0.06 - 0.03;

    // One deliberate bad patch, to produce a genuine losing streak.
    const slump = day >= 44 && day <= 49 ? -0.28 : 0;

    for (let i = 0; i < count; i += 1) {
      const asset = weightedPick(ASSETS);
      const provider = weightedPick(PROVIDERS);
      const timeframe = weightedPick(TIMEFRAMES);

      const hour = isWeekend
        ? Math.floor(between(8, 22))
        : Math.floor(between(6, 20));
      const minute = Math.floor(between(0, 60));

      const entry = new Date(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          hour,
          minute,
          0,
        ),
      );

      const expiry = new Date(entry.getTime() + timeframe.seconds * 1000);

      const probability = Math.min(
        0.9,
        Math.max(
          0.08,
          asset.edge +
            provider.modifier +
            timeframe.modifier +
            (HOUR_QUALITY[hour] ?? 0) +
            learningCurve +
            slump,
        ),
      );

      // The most recent two days are still open, so the UI has pending rows.
      const isPending = day >= DAYS - 2 && rng() < 0.55;

      let result: SignalRow["result"];
      if (isPending) result = "PENDING";
      else if (rng() < 0.012) result = "DRAW";
      else result = rng() < probability ? "WIN" : "LOSS";

      const stake = Number(pick([5, 10, 10, 20, 25, 50]).toFixed(2));
      const payoutPct = Number(
        (asset.payout + between(-0.03, 0.03)).toFixed(2),
      );

      const pnl =
        result === "WIN"
          ? Number((stake * payoutPct).toFixed(2))
          : result === "LOSS"
            ? -stake
            : 0;

      rows.push({
        entry,
        expiry,
        asset: asset.symbol,
        direction: rng() < 0.52 ? "BUY" : "SELL",
        timeframe,
        result,
        stake,
        payoutPct,
        pnl: result === "PENDING" ? 0 : pnl,
        confidence: Number(between(0.55, 0.95).toFixed(2)),
        provider: provider.name,
      });
    }
  }

  return rows.sort((a, b) => a.entry.getTime() - b.entry.getTime());
}

function writeSignalsCsv(rows: SignalRow[], path: string) {
  const header = [
    "Entry Time",
    "Expiry Time",
    "Asset",
    "Direction",
    "Timeframe",
    "Result",
    "Stake",
    "Payout %",
    "P/L",
    "Confidence",
    "Provider",
  ].join(",");

  const lines = rows.map((row) =>
    [
      fmtDateTime(row.entry),
      fmtDateTime(row.expiry),
      row.asset,
      row.direction,
      row.timeframe.label,
      row.result === "PENDING" ? "pending" : row.result.toLowerCase(),
      row.stake.toFixed(2),
      row.payoutPct.toFixed(2),
      row.result === "PENDING" ? "" : row.pnl.toFixed(2),
      row.confidence.toFixed(2),
      row.provider,
    ]
      // Quote any field containing the delimiter.
      .map((field) => (field.includes(",") ? `"${field}"` : field))
      .join(","),
  );

  // Three malformed rows, so the importer's rejection reporting is demonstrable
  // on the sample data rather than only in theory.
  lines.splice(12, 0, "2026-05-02 10:15:00,,NOTANASSET,SIDEWAYS,M5,win,10.00,0.80,8.00,0.71,AlphaPips Room");
  lines.splice(60, 0, ",,EUR/USD,BUY,M5,win,10.00,0.80,8.00,0.66,QuantEdge Bot");
  lines.push("2026-07-25 09:00:00,,GBP/USD,BUY,,pending,10.00,0.80,,0.70,QuantEdge Bot");

  writeFileSync(path, [header, ...lines].join("\n") + "\n", "utf8");
}

function writeSignalsJson(rows: SignalRow[], path: string) {
  // A different vocabulary on purpose — this file proves the header aliasing in
  // the parser works, not just the one layout the CSV happens to use.
  const payload = {
    exportedAt: END.toISOString(),
    source: "user-provided signal log",
    signals: rows.slice(-120).map((row) => ({
      symbol: row.asset,
      side: row.direction === "BUY" ? "call" : "put",
      openTime: Math.floor(row.entry.getTime() / 1000),
      duration: `${row.timeframe.seconds}s`,
      outcome: row.result.toLowerCase(),
      amount: row.stake,
      profit: row.result === "PENDING" ? null : row.pnl,
      probability: Math.round(row.confidence * 100),
      source: row.provider,
    })),
  };

  writeFileSync(path, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

// --- Chat -------------------------------------------------------------------

const AUTHORS = [
  "marcus_fx", "elena.trades", "quiet_quant", "PipHunter", "sarah_k",
  "tomas", "NightOwlFX", "dana_r", "mo_analytics", "kenji",
];

const BULLISH_TEMPLATES = [
  "{asset} looking strong above support, taking a call on the {tf}",
  "clean breakout on {asset}, buying this one",
  "{asset} bounced off the demand zone — bullish for me",
  "rsi oversold on {asset}, expecting a reversal up",
  "green candles stacking on {asset}, momentum is up 📈",
  "golden cross forming on {asset} 4h, long bias",
  "{asset} holding the trendline nicely, call on {tf} expiry",
  "that was a clean win on {asset}, +{n} 🚀",
];

const BEARISH_TEMPLATES = [
  "{asset} rejected at resistance, putting on the {tf}",
  "breakdown below support on {asset}, going short",
  "{asset} looks weak here, sell",
  "overbought rsi on {asset}, expecting a drop",
  "red across the board, {asset} dumping 📉",
  "death cross on {asset}, bearish for the session",
  "took a loss on {asset}, -{n}. bad entry on my part",
  "{asset} downtrend intact, not buying this dip",
];

const NEUTRAL_TEMPLATES = [
  "anyone else watching {asset} today?",
  "{asset} ranging, sitting this one out",
  "what timeframe are you all using for {asset}?",
  "waiting for the news at 13:30 before touching {asset}",
  "sideways chop on {asset}, no clean setup",
  "how do you handle {asset} during rollover?",
  "does anyone have data on {asset} otc payouts?",
  "market's quiet, {asset} barely moving",
];

/**
 * Conversational filler. Without this the templates above collide constantly
 * once normalised, and the sample data would read as ~80% duplicates — which
 * says more about the generator than about the duplicate detector.
 */
const OPENERS = [
  "", "", "", "ok so ", "right, ", "hmm ", "fwiw ", "quick one — ",
  "morning all, ", "back at the desk. ", "just checked and ", "honestly ",
  "not sure but ", "looking at the 15m and ", "after that last one, ",
];

const TAILS = [
  "", "", "", " thoughts?", " anyone agree?", " might be wrong on this one.",
  " small size though.", " sticking to my plan.", " let's see how it plays out.",
  " third time this week.", " chart's in the other channel.",
  " will post the result after.", " same setup as yesterday.",
  " could be a fakeout, watching.", " not touching it until the close.",
];

const SPAM_TEMPLATES = [
  "🚀🚀🚀 JOIN MY VIP GROUP 100% ACCURACY GUARANTEED 🚀🚀🚀 t.me/fakevipsignals",
  "DM me and I can manage your account, guaranteed profit no loss",
  "sign up bonus with my link — double your money in a week, use promo code WIN2X",
  "join my vip signal channel, risk-free trading, inbox me now",
  "💰💰💰💰💰💰💰💰",
  "GUARANTEED 100% WIN RATE SUBSCRIBE NOW discord.gg/notreal",
];

type ChatRow = { at: Date; author: string; text: string; channel: string };

function generateChat(signals: SignalRow[]): ChatRow[] {
  const rows: ChatRow[] = [];
  const channels = ["signals-general", "eurusd-desk", "vip-room"];

  for (let day = 0; day < DAYS; day += 1) {
    const date = new Date(START.getTime() + day * 86400 * 1000);
    const weekday = date.getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;

    const count = isWeekend
      ? Math.floor(between(2, 10))
      : Math.floor(between(10, 30));

    // Chat mood tracks the same slump the signals have, so the sentiment series
    // and the performance series are correlated the way they would be in reality.
    const slump = day >= 44 && day <= 49;
    const bullishBias = slump ? 0.25 : 0.5;

    for (let i = 0; i < count; i += 1) {
      const hour = Math.floor(between(5, 23));
      const minute = Math.floor(between(0, 60));

      const at = new Date(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          hour,
          minute,
          Math.floor(between(0, 60)),
        ),
      );

      const roll = rng();
      let text: string;

      if (roll < 0.06) {
        text = pick(SPAM_TEMPLATES);
      } else {
        const asset = weightedPick(ASSETS).symbol;
        const tf = pick(TIMEFRAMES).label;
        const amount = (between(5, 60)).toFixed(2);

        const moodRoll = rng();
        const template =
          moodRoll < bullishBias
            ? pick(BULLISH_TEMPLATES)
            : moodRoll < bullishBias + 0.35
              ? pick(BEARISH_TEMPLATES)
              : pick(NEUTRAL_TEMPLATES);

        text =
          pick(OPENERS) +
          template
            .replace(/{asset}/g, asset)
            .replace(/{tf}/g, tf)
            .replace(/{n}/g, amount) +
          pick(TAILS);
      }

      rows.push({
        at,
        author: roll < 0.06 ? pick(["promo_bot", "signals_vip_x"]) : pick(AUTHORS),
        text,
        channel: pick(channels),
      });
    }
  }

  // A repeated message, so duplicate detection has something to catch.
  const dupeSource = rows[Math.floor(rows.length * 0.3)];
  for (let i = 0; i < 5; i += 1) {
    rows.push({
      ...dupeSource,
      at: new Date(dupeSource.at.getTime() + (i + 1) * 3600 * 1000),
      author: "echo_user",
    });
  }

  void signals;
  return rows.sort((a, b) => a.at.getTime() - b.at.getTime());
}

function writeChatText(rows: ChatRow[], path: string) {
  const lines = rows.map(
    (row) => `[${fmtDateTime(row.at)}] ${row.author}: ${row.text}`,
  );

  writeFileSync(path, lines.join("\n") + "\n", "utf8");
}

function writeChatCsv(rows: ChatRow[], path: string) {
  const header = "timestamp,channel,author,message";

  const lines = rows.slice(-400).map((row) => {
    const escaped = row.text.replace(/"/g, '""');
    return `${fmtDateTime(row.at)},${row.channel},${row.author},"${escaped}"`;
  });

  writeFileSync(path, [header, ...lines].join("\n") + "\n", "utf8");
}

// --- Entry point ------------------------------------------------------------

const outDir = join(process.cwd(), "samples");
mkdirSync(outDir, { recursive: true });

const signals = generateSignals();
const chat = generateChat(signals);

writeSignalsCsv(signals, join(outDir, "signals.csv"));
writeSignalsJson(signals, join(outDir, "signals.json"));
writeChatText(chat, join(outDir, "chat-export.txt"));
writeChatCsv(chat, join(outDir, "chat-export.csv"));

const settled = signals.filter((s) => s.result !== "PENDING");
const wins = settled.filter((s) => s.result === "WIN").length;

console.log(`samples/signals.csv        ${signals.length} rows (+3 deliberately malformed)`);
console.log(`samples/signals.json       120 rows, alternate column names`);
console.log(`samples/chat-export.txt    ${chat.length} messages`);
console.log(`samples/chat-export.csv    400 messages`);
console.log(
  `\nGenerated win rate: ${((wins / settled.length) * 100).toFixed(1)}% over ${settled.length} settled`,
);
