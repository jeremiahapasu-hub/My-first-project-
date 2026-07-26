import {
  byAsset,
  byDay,
  byHour,
  byMonth,
  byProvider,
  byTimeframe,
  byWeek,
  computeStats,
  dailySeries,
  heatmap,
  rankBuckets,
  type SignalLike,
} from "@/lib/analysis/performance";
import { generateInsights } from "@/lib/analysis/insights";
import { narrateInsights, summarizeDiscussion } from "@/lib/ai/summarize";
import { loadMessages, loadSignals, type Filters } from "@/lib/queries";
import type { InsightPayload, SentimentPoint } from "@/lib/types";

/**
 * Read-side services.
 *
 * Server components import these directly and API routes wrap them, so both
 * surfaces return exactly the same numbers.
 */

export type Overview = Awaited<ReturnType<typeof buildOverview>>;

export async function buildOverview(userId: string, filters: Filters) {
  const signals = (await loadSignals(userId, filters)) as SignalLike[];

  const assets = byAsset(signals);
  const providers = byProvider(signals);
  const hours = byHour(signals);

  return {
    stats: computeStats(signals),
    series: dailySeries(signals),
    daily: byDay(signals),
    weekly: byWeek(signals),
    monthly: byMonth(signals),
    assets,
    providers,
    hourly: hours,
    timeframes: byTimeframe(signals),
    // Ranked separately from the raw buckets: ranking applies a minimum sample
    // size, and the charts want every bucket including the thin ones.
    assetRanking: rankBuckets(assets, 8),
    hourRanking: rankBuckets(hours, 8),
    providerRanking: rankBuckets(providers, 10),
    /** Distribution for the signal-frequency chart. */
    frequency: byDay(signals).map((bucket) => ({
      date: bucket.key,
      count: bucket.total,
    })),
  };
}

export async function buildHeatmap(userId: string, filters: Filters) {
  const signals = (await loadSignals(userId, filters)) as SignalLike[];
  return { cells: heatmap(signals) };
}

/** Daily sentiment counts plus the mean polarity per day. */
export function sentimentSeries(
  messages: { postedAt: Date; sentiment: string; sentimentScore: number }[],
): SentimentPoint[] {
  const byDate = new Map<
    string,
    { bullish: number; bearish: number; neutral: number; scores: number[] }
  >();

  for (const message of messages) {
    const key = message.postedAt.toISOString().slice(0, 10);

    const bucket =
      byDate.get(key) ??
      { bullish: 0, bearish: 0, neutral: 0, scores: [] as number[] };

    if (message.sentiment === "BULLISH") bucket.bullish += 1;
    else if (message.sentiment === "BEARISH") bucket.bearish += 1;
    else bucket.neutral += 1;

    bucket.scores.push(message.sentimentScore);
    byDate.set(key, bucket);
  }

  return [...byDate.entries()]
    .map(([date, bucket]) => ({
      date,
      bullish: bucket.bullish,
      bearish: bucket.bearish,
      neutral: bucket.neutral,
      score: Number(
        (
          bucket.scores.reduce((sum, value) => sum + value, 0) /
          bucket.scores.length
        ).toFixed(4),
      ),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Counts occurrences across every message's tag array. */
function tally(rows: string[][]): { name: string; count: number }[] {
  const counts = new Map<string, number>();

  for (const row of rows) {
    for (const value of row) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export async function buildChatAnalysis(userId: string, filters: Filters) {
  // Spam is measured against everything, then excluded from the tone read —
  // otherwise "20% of this room is spam" could never be reported.
  const [visible, all] = await Promise.all([
    loadMessages(userId, filters),
    loadMessages(userId, { ...filters, includeSpam: true }),
  ]);

  const spamCount = all.filter((message) => message.isSpam).length;
  const duplicateCount = all.filter((message) => message.isDuplicate).length;

  const counts = {
    bullish: visible.filter((m) => m.sentiment === "BULLISH").length,
    bearish: visible.filter((m) => m.sentiment === "BEARISH").length,
    neutral: visible.filter((m) => m.sentiment === "NEUTRAL").length,
  };

  const topAssets = tally(visible.map((m) => m.assets));
  const topStrategies = tally(visible.map((m) => m.strategies));

  const digest = await summarizeDiscussion({
    messageCount: visible.length,
    topAssets: topAssets.slice(0, 8),
    topStrategies: topStrategies.slice(0, 8),
    ...counts,
    spam: spamCount,
    // A few genuine excerpts, so an AI summary has something concrete to work
    // from. Promotional messages are excluded from the sample.
    samples: visible
      .filter((m) => !m.isSpam && m.content.length > 40)
      .slice(-12)
      .map((m) => m.content.slice(0, 200)),
  });

  return {
    totals: {
      analysed: visible.length,
      all: all.length,
      spam: spamCount,
      duplicates: duplicateCount,
      spamRatio: all.length === 0 ? 0 : Number((spamCount / all.length).toFixed(4)),
      ...counts,
    },
    series: sentimentSeries(visible),
    topAssets: topAssets.slice(0, 15),
    topStrategies: topStrategies.slice(0, 12),
    topAuthors: [...
      visible.reduce((map, message) => {
        map.set(message.author, (map.get(message.author) ?? 0) + 1);
        return map;
      }, new Map<string, number>())
    ]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    summary: digest,
  };
}

export async function buildInsights(
  userId: string,
  filters: Filters,
): Promise<InsightPayload> {
  const [signals, messages, allMessages] = await Promise.all([
    loadSignals(userId, filters) as Promise<SignalLike[]>,
    loadMessages(userId, filters),
    loadMessages(userId, { ...filters, includeSpam: true }),
  ]);

  const spamRatio =
    allMessages.length === 0
      ? 0
      : allMessages.filter((message) => message.isSpam).length / allMessages.length;

  const payload = generateInsights({
    signals,
    sentimentSeries: sentimentSeries(messages),
    spamRatio,
    topStrategies: tally(messages.map((message) => message.strategies)).slice(0, 6),
  });

  // Adds prose when an OpenAI key is configured; a no-op otherwise.
  return narrateInsights(payload);
}
