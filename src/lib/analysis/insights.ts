import {
  byAsset,
  byHour,
  byProvider,
  byTimeframe,
  computeStats,
  dailySeries,
  formatTimeframe,
  rankBuckets,
  type SignalLike,
} from "@/lib/analysis/performance";
import type { Insight, InsightPayload, SentimentPoint } from "@/lib/types";

/**
 * Deterministic insight generation.
 *
 * Everything here is derived arithmetically from the user's own imported rows.
 * No market data is fetched and nothing is predicted — each insight describes
 * something that already happened in the data, with an explicit confidence based
 * on how much data supports it.
 */

/** Below this many settled signals, nothing is worth saying with confidence. */
const MIN_SAMPLE = 20;

/** Sample size at which we treat a rate estimate as fully trustworthy. */
const FULL_CONFIDENCE_SAMPLE = 200;

function sampleConfidence(n: number): number {
  if (n <= 0) return 0;
  return Number(Math.min(1, Math.sqrt(n / FULL_CONFIDENCE_SAMPLE)).toFixed(2));
}

/**
 * Standard error of a proportion, used to decide whether a gap between two
 * groups is big enough to mention at all.
 */
function proportionStdErr(p: number, n: number): number {
  if (n === 0) return 1;
  return Math.sqrt(Math.max(p * (1 - p), 0.0001) / n);
}

export type InsightInput = {
  signals: SignalLike[];
  sentimentSeries: SentimentPoint[];
  spamRatio: number;
  topStrategies: { name: string; count: number }[];
};

export function generateInsights(input: InsightInput): InsightPayload {
  const { signals, sentimentSeries, spamRatio, topStrategies } = input;
  const overall = computeStats(signals);
  const insights: Insight[] = [];

  const push = (insight: Omit<Insight, "id">) =>
    insights.push({ id: `insight-${insights.length + 1}`, ...insight });

  if (overall.settled < MIN_SAMPLE) {
    push({
      kind: "risk",
      severity: "warning",
      title: "Not enough settled signals for reliable analysis",
      detail:
        `Only ${overall.settled} signal${overall.settled === 1 ? " has" : "s have"} a recorded outcome. ` +
        `Rates computed on fewer than ${MIN_SAMPLE} results swing wildly with each new trade. ` +
        `Import more history before reading anything into the numbers below.`,
      confidence: 1,
    });
  }

  // --- Overall hit rate -----------------------------------------------------
  if (overall.settled > 0) {
    const stdErr = proportionStdErr(overall.winRate, overall.settled);
    const margin = 1.96 * stdErr;
    const beatsCoinFlip = overall.winRate - margin > 0.5;
    const losesToCoinFlip = overall.winRate + margin < 0.5;

    push({
      kind: "trend",
      severity: beatsCoinFlip ? "good" : losesToCoinFlip ? "critical" : "info",
      title: `Win rate ${(overall.winRate * 100).toFixed(1)}% across ${overall.settled} settled signals`,
      detail: beatsCoinFlip
        ? `The 95% confidence interval (±${(margin * 100).toFixed(1)} pts) sits entirely above 50%, so this is unlikely to be chance alone over this sample.`
        : losesToCoinFlip
          ? `The 95% confidence interval (±${(margin * 100).toFixed(1)} pts) sits entirely below 50%. Over this sample the feed underperformed a coin flip.`
          : `The 95% confidence interval (±${(margin * 100).toFixed(1)} pts) still straddles 50%, so this sample cannot distinguish the feed from chance.`,
      confidence: sampleConfidence(overall.settled),
    });
  }

  // --- Recent direction of travel ------------------------------------------
  const series = dailySeries(signals);
  if (series.length >= 6) {
    const half = Math.floor(series.length / 2);
    const older = series.slice(0, half);
    const recent = series.slice(half);

    const weightedRate = (points: typeof series) => {
      const total = points.reduce((sum, p) => sum + p.count, 0);
      if (total === 0) return 0;
      return points.reduce((sum, p) => sum + p.winRate * p.count, 0) / total;
    };

    const before = weightedRate(older);
    const after = weightedRate(recent);
    const delta = after - before;

    if (Math.abs(delta) >= 0.05) {
      push({
        kind: "trend",
        severity: delta > 0 ? "good" : "warning",
        title: `Win rate ${delta > 0 ? "improving" : "deteriorating"} over the period`,
        detail:
          `The most recent ${recent.length} active days average ${(after * 100).toFixed(1)}% ` +
          `against ${(before * 100).toFixed(1)}% for the earlier ${older.length} — ` +
          `a ${delta > 0 ? "gain" : "drop"} of ${Math.abs(delta * 100).toFixed(1)} points.`,
        confidence: sampleConfidence(overall.settled) * 0.9,
      });
    }
  }

  // --- Drawdown -------------------------------------------------------------
  if (series.length >= 3) {
    let peak = -Infinity;
    let maxDrawdown = 0;
    for (const point of series) {
      peak = Math.max(peak, point.cumulativePnl);
      maxDrawdown = Math.max(maxDrawdown, peak - point.cumulativePnl);
    }

    if (maxDrawdown > 0) {
      push({
        kind: "risk",
        severity: maxDrawdown > Math.abs(overall.netPnl) ? "warning" : "info",
        title: `Largest peak-to-trough drawdown: ${maxDrawdown.toFixed(2)}`,
        detail:
          `Equity fell ${maxDrawdown.toFixed(2)} from its high point before recovering or ending the period. ` +
          `Net result over the same window was ${overall.netPnl.toFixed(2)}.`,
        confidence: sampleConfidence(overall.settled),
      });
    }
  }

  // --- Losing streak --------------------------------------------------------
  if (overall.worstStreak >= 4) {
    push({
      kind: "risk",
      severity: overall.worstStreak >= 7 ? "critical" : "warning",
      title: `Longest losing run: ${overall.worstStreak} consecutive signals`,
      detail:
        `A run of this length occurred within the imported history. Any position sizing that ` +
        `escalates after a loss would have needed to survive ${overall.worstStreak} straight losses here.`,
      confidence: 1,
    });
  }

  // --- Best and worst assets -----------------------------------------------
  const assetRanking = rankBuckets(byAsset(signals), 8);
  if (assetRanking.best.length > 0) {
    const best = assetRanking.best[0];
    push({
      kind: "pattern",
      severity: "good",
      title: `${best.label} is the strongest asset in this data`,
      detail:
        `${(best.winRate * 100).toFixed(1)}% across ${best.settled} settled signals. ` +
        (assetRanking.excluded > 0
          ? `${assetRanking.excluded} other asset${assetRanking.excluded === 1 ? " was" : "s were"} excluded for having fewer than 8 results.`
          : `All assets in the set cleared the 8-result minimum.`),
      confidence: sampleConfidence(best.settled),
    });
  }

  if (assetRanking.worst.length > 0) {
    const worst = assetRanking.worst[0];
    if (worst.key !== assetRanking.best[0]?.key && worst.winRate < 0.5) {
      push({
        kind: "pattern",
        severity: "warning",
        title: `${worst.label} is the weakest asset in this data`,
        detail: `${(worst.winRate * 100).toFixed(1)}% across ${worst.settled} settled signals, with a net result of ${worst.netPnl.toFixed(2)}.`,
        confidence: sampleConfidence(worst.settled),
      });
    }
  }

  // --- Time of day ----------------------------------------------------------
  const hourRanking = rankBuckets(byHour(signals), 8);
  if (hourRanking.best.length > 0 && hourRanking.worst.length > 0) {
    const best = hourRanking.best[0];
    const worst = hourRanking.worst[0];
    const gap = best.winRate - worst.winRate;

    // Only report the spread if it exceeds the combined noise of both estimates.
    const noise =
      1.96 *
      Math.sqrt(
        proportionStdErr(best.winRate, best.settled) ** 2 +
          proportionStdErr(worst.winRate, worst.settled) ** 2,
      );

    if (gap > noise && gap >= 0.1) {
      push({
        kind: "pattern",
        severity: "info",
        title: `Hour of day separates outcomes by ${(gap * 100).toFixed(1)} points`,
        detail:
          `${best.label} UTC returned ${(best.winRate * 100).toFixed(1)}% over ${best.settled} signals, ` +
          `against ${(worst.winRate * 100).toFixed(1)}% at ${worst.label} UTC over ${worst.settled}. ` +
          `The gap is wider than the sampling noise of either estimate.`,
        confidence: sampleConfidence(Math.min(best.settled, worst.settled)),
      });
    }
  }

  // --- Timeframe ------------------------------------------------------------
  const timeframeRanking = rankBuckets(byTimeframe(signals), 8);
  if (timeframeRanking.best.length > 1) {
    const best = timeframeRanking.best[0];
    push({
      kind: "pattern",
      severity: "info",
      title: `${best.label} expiries performed best`,
      detail: `${(best.winRate * 100).toFixed(1)}% over ${best.settled} settled signals at this expiry length.`,
      confidence: sampleConfidence(best.settled),
    });
  }

  // --- Provider -------------------------------------------------------------
  const providerBuckets = byProvider(signals).filter((b) => b.settled >= 10);
  if (providerBuckets.length >= 2) {
    const sorted = [...providerBuckets].sort((a, b) => b.winRate - a.winRate);
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];

    if (top.winRate - bottom.winRate >= 0.1) {
      push({
        kind: "pattern",
        severity: "info",
        title: `Providers diverge by ${((top.winRate - bottom.winRate) * 100).toFixed(1)} points`,
        detail:
          `${top.label} at ${(top.winRate * 100).toFixed(1)}% (${top.settled} settled) versus ` +
          `${bottom.label} at ${(bottom.winRate * 100).toFixed(1)}% (${bottom.settled} settled).`,
        confidence: sampleConfidence(Math.min(top.settled, bottom.settled)),
      });
    }
  }

  // --- Chat sentiment -------------------------------------------------------
  if (sentimentSeries.length >= 3) {
    const mean =
      sentimentSeries.reduce((sum, point) => sum + point.score, 0) /
      sentimentSeries.length;

    const totals = sentimentSeries.reduce(
      (acc, point) => ({
        bullish: acc.bullish + point.bullish,
        bearish: acc.bearish + point.bearish,
        neutral: acc.neutral + point.neutral,
      }),
      { bullish: 0, bearish: 0, neutral: 0 },
    );

    const messages = totals.bullish + totals.bearish + totals.neutral;
    const lean = mean > 0.08 ? "bullish" : mean < -0.08 ? "bearish" : "balanced";

    push({
      kind: "sentiment",
      severity: "info",
      title: `Room sentiment reads ${lean}`,
      detail:
        `Mean polarity ${mean >= 0 ? "+" : ""}${mean.toFixed(3)} across ${messages} messages ` +
        `over ${sentimentSeries.length} days — ${totals.bullish} bullish, ${totals.bearish} bearish, ${totals.neutral} neutral.`,
      confidence: sampleConfidence(messages),
    });

    // Sentiment leaning one way while the signals lean the other is worth a flag.
    const buyShare =
      signals.length === 0
        ? 0
        : signals.filter((s) => s.direction === "BUY").length / signals.length;

    if (Math.abs(mean) > 0.08 && signals.length >= MIN_SAMPLE) {
      const chatBullish = mean > 0;
      const signalsBullish = buyShare > 0.55;
      const signalsBearish = buyShare < 0.45;

      if ((chatBullish && signalsBearish) || (!chatBullish && signalsBullish)) {
        push({
          kind: "sentiment",
          severity: "warning",
          title: "Chat sentiment and signal direction disagree",
          detail:
            `Messages lean ${chatBullish ? "bullish" : "bearish"} while ${(buyShare * 100).toFixed(0)}% of signals are BUY. ` +
            `Worth checking whether the commentary and the calls come from the same source.`,
          confidence: 0.6,
        });
      }
    }
  }

  if (spamRatio > 0.2) {
    push({
      kind: "risk",
      severity: spamRatio > 0.4 ? "critical" : "warning",
      title: `${(spamRatio * 100).toFixed(0)}% of messages flagged promotional`,
      detail:
        `A high share of the room is solicitation rather than analysis. Sentiment computed over ` +
        `this channel is measuring marketing copy as much as trader opinion — consider excluding ` +
        `flagged messages from the chat view.`,
      confidence: 0.9,
    });
  }

  if (topStrategies.length > 0) {
    const named = topStrategies
      .slice(0, 3)
      .map((s) => `${s.name} (${s.count})`)
      .join(", ");

    push({
      kind: "pattern",
      severity: "info",
      title: "Most-discussed strategies",
      detail: `${named}. Counts are mentions in imported messages, not trades taken.`,
      confidence: sampleConfidence(
        topStrategies.reduce((sum, s) => sum + s.count, 0),
      ),
    });
  }

  // --- Recommendations ------------------------------------------------------
  // Framed as things to examine in the data, never as trades to place.
  const recommendations: string[] = [];

  if (assetRanking.worst.length > 0 && assetRanking.worst[0].winRate < 0.45) {
    recommendations.push(
      `Review why ${assetRanking.worst[0].label} underperforms the rest of the set before including it in further analysis.`,
    );
  }
  if (overall.pending > overall.settled && overall.total > 0) {
    recommendations.push(
      `${overall.pending} of ${overall.total} signals have no recorded outcome. Backfilling results would materially change every rate on this page.`,
    );
  }
  if (spamRatio > 0.2) {
    recommendations.push(
      "Re-run chat analysis with promotional messages excluded to see whether the sentiment picture holds.",
    );
  }
  if (overall.settled >= MIN_SAMPLE && overall.profitFactor !== null && overall.profitFactor < 1) {
    recommendations.push(
      `Profit factor is ${overall.profitFactor.toFixed(2)} — gross losses exceed gross gains despite the reported win rate. Check payout ratios per asset.`,
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      "No data-quality problems stand out. Keep importing results so the sample keeps growing.",
    );
  }

  for (const text of recommendations) {
    push({
      kind: "recommendation",
      severity: "info",
      title: "Suggested next step",
      detail: text,
      confidence: 0.7,
    });
  }

  // --- Risk assessment ------------------------------------------------------
  const riskFactors: string[] = [];
  let riskScore = 0;

  if (overall.settled < MIN_SAMPLE) {
    riskScore += 30;
    riskFactors.push("Sample too small for stable estimates");
  }
  if (overall.worstStreak >= 5) {
    riskScore += 20;
    riskFactors.push(`Losing runs reach ${overall.worstStreak} signals`);
  }
  if (overall.winRate < 0.5 && overall.settled >= MIN_SAMPLE) {
    riskScore += 25;
    riskFactors.push("Win rate below 50% over a meaningful sample");
  }
  if (overall.profitFactor !== null && overall.profitFactor < 1) {
    riskScore += 15;
    riskFactors.push("Gross losses exceed gross gains");
  }
  if (spamRatio > 0.3) {
    riskScore += 10;
    riskFactors.push("Chat source is heavily promotional");
  }
  if (overall.pending > overall.settled) {
    riskScore += 10;
    riskFactors.push("Most signals have no recorded outcome");
  }
  if (riskFactors.length === 0) {
    riskFactors.push("No elevated risk factors detected in the imported data");
  }

  riskScore = Math.min(100, riskScore);
  const level =
    riskScore >= 70
      ? "high"
      : riskScore >= 45
        ? "elevated"
        : riskScore >= 20
          ? "moderate"
          : "low";

  // Capped below 1: however large the sample, a retrospective read of one
  // person's imported rows is never grounds for claiming total confidence, and
  // "100%" on a dashboard reads as certainty rather than as a scaled score.
  const confidenceScore = Number(
    Math.min(
      0.95,
      sampleConfidence(overall.settled) * 0.7 +
        (overall.pending > 0
          ? 0.3 * (overall.settled / Math.max(overall.total, 1))
          : 0.3),
    ).toFixed(2),
  );

  const summary = buildSummary(overall, confidenceScore, level);

  return {
    engine: "heuristic",
    generatedAt: new Date().toISOString(),
    confidenceScore,
    summary,
    insights,
    riskAssessment: { level, score: riskScore, factors: riskFactors },
  };
}

function buildSummary(
  overall: ReturnType<typeof computeStats>,
  confidence: number,
  risk: string,
): string {
  if (overall.total === 0) {
    return "No signals matched the current filters. Import a signal export or widen the date range to see analysis here.";
  }

  const parts = [
    `${overall.total} signals in scope, ${overall.settled} with a recorded outcome.`,
    overall.settled > 0
      ? `Win rate ${(overall.winRate * 100).toFixed(1)}% and accuracy ${(overall.accuracy * 100).toFixed(1)}% once draws are counted against.`
      : "None of them have settled yet, so no hit rate can be computed.",
    overall.netPnl !== 0
      ? `Net result ${overall.netPnl >= 0 ? "+" : ""}${overall.netPnl.toFixed(2)} with a profit factor of ${overall.profitFactor?.toFixed(2) ?? "—"}.`
      : "No profit/loss figures were present in the import.",
    `Best run ${overall.bestStreak}, worst run ${overall.worstStreak}.`,
    `Overall risk reads ${risk}, and the analysis carries ${(confidence * 100).toFixed(0)}% confidence given the sample size.`,
  ];

  return parts.join(" ");
}
