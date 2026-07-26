import type {
  Bucket,
  HeatCell,
  PerformanceStats,
  SeriesPoint,
  SignalResult,
} from "@/lib/types";

/**
 * The minimum shape `computeStats` needs. Deliberately narrower than the Prisma
 * model so these functions stay pure and unit-testable without a database.
 */
export type SignalLike = {
  asset: string;
  direction: "BUY" | "SELL";
  entryAt: Date;
  timeframeSec: number;
  result: SignalResult;
  pnl: number | null;
  stake: number | null;
  payout: number | null;
  confidence: number | null;
  provider?: { name: string } | null;
};

const EMPTY: PerformanceStats = {
  total: 0,
  settled: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  pending: 0,
  winRate: 0,
  accuracy: 0,
  netPnl: 0,
  avgPnl: 0,
  profitFactor: null,
  bestStreak: 0,
  worstStreak: 0,
};

/**
 * Core aggregation.
 *
 * Two different "hit rate" numbers are reported on purpose, because traders mean
 * different things by them:
 *   - winRate  = wins / (wins + losses) — the conventional figure, draws excluded.
 *   - accuracy = wins / settled — draws counted against you, since a refunded
 *     trade still means the call didn't land.
 * Pending signals are excluded from both; they have no outcome yet.
 */
export function computeStats(signals: SignalLike[]): PerformanceStats {
  if (signals.length === 0) return { ...EMPTY };

  let wins = 0;
  let losses = 0;
  let draws = 0;
  let pending = 0;
  let netPnl = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  for (const signal of signals) {
    switch (signal.result) {
      case "WIN":
        wins += 1;
        break;
      case "LOSS":
        losses += 1;
        break;
      case "DRAW":
        draws += 1;
        break;
      default:
        pending += 1;
    }

    if (signal.pnl !== null && signal.result !== "PENDING") {
      netPnl += signal.pnl;
      if (signal.pnl >= 0) grossProfit += signal.pnl;
      else grossLoss += Math.abs(signal.pnl);
    }
  }

  const settled = wins + losses + draws;
  const decided = wins + losses;

  // Streaks are computed in chronological order, so callers must not pre-sort
  // by anything else. Draws and pending trades break neither streak.
  const ordered = [...signals].sort(
    (a, b) => a.entryAt.getTime() - b.entryAt.getTime(),
  );

  let bestStreak = 0;
  let worstStreak = 0;
  let currentWin = 0;
  let currentLoss = 0;

  for (const signal of ordered) {
    if (signal.result === "WIN") {
      currentWin += 1;
      currentLoss = 0;
      bestStreak = Math.max(bestStreak, currentWin);
    } else if (signal.result === "LOSS") {
      currentLoss += 1;
      currentWin = 0;
      worstStreak = Math.max(worstStreak, currentLoss);
    }
  }

  return {
    total: signals.length,
    settled,
    wins,
    losses,
    draws,
    pending,
    winRate: decided === 0 ? 0 : round(wins / decided),
    accuracy: settled === 0 ? 0 : round(wins / settled),
    netPnl: round(netPnl, 2),
    avgPnl: settled === 0 ? 0 : round(netPnl / settled, 2),
    // Undefined rather than Infinity when there are no losses at all — the UI
    // shows "—" instead of a number that would look like a real ratio.
    profitFactor: grossLoss === 0 ? null : round(grossProfit / grossLoss, 2),
    bestStreak,
    worstStreak,
  };
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Groups signals by an arbitrary key and computes stats per group. */
export function bucketBy(
  signals: SignalLike[],
  keyOf: (signal: SignalLike) => string | null,
  labelOf: (key: string) => string = (key) => key,
): Bucket[] {
  const groups = new Map<string, SignalLike[]>();

  for (const signal of signals) {
    const key = keyOf(signal);
    if (key === null) continue;

    const existing = groups.get(key);
    if (existing) existing.push(signal);
    else groups.set(key, [signal]);
  }

  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      label: labelOf(key),
      ...computeStats(group),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

const ISO_DAY = (date: Date) => date.toISOString().slice(0, 10);

/** ISO week key, e.g. "2026-W31". Weeks start Monday. */
export function isoWeekKey(date: Date): string {
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // Shift to the Thursday of this week; ISO weeks are numbered by their Thursday.
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);

  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);

  const week =
    1 +
    Math.round(
      (target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000),
    );

  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export const byDay = (signals: SignalLike[]) =>
  bucketBy(signals, (s) => ISO_DAY(s.entryAt));

export const byWeek = (signals: SignalLike[]) =>
  bucketBy(signals, (s) => isoWeekKey(s.entryAt));

export const byMonth = (signals: SignalLike[]) =>
  bucketBy(signals, (s) => s.entryAt.toISOString().slice(0, 7));

export const byAsset = (signals: SignalLike[]) =>
  bucketBy(signals, (s) => s.asset);

export const byProvider = (signals: SignalLike[]) =>
  bucketBy(signals, (s) => s.provider?.name ?? "Unattributed");

export const byHour = (signals: SignalLike[]) =>
  bucketBy(
    signals,
    (s) => String(s.entryAt.getUTCHours()).padStart(2, "0"),
    (key) => `${key}:00`,
  );

export const byTimeframe = (signals: SignalLike[]) =>
  bucketBy(
    signals,
    (s) => String(s.timeframeSec).padStart(6, "0"),
    (key) => formatTimeframe(Number(key)),
  );

export function formatTimeframe(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/**
 * Daily time series with a running P/L total, for the equity-curve chart.
 * Days with no signals are omitted rather than zero-filled, so a gap in trading
 * doesn't render as a flat line that looks like a losing streak.
 */
export function dailySeries(signals: SignalLike[]): SeriesPoint[] {
  const buckets = byDay(signals);
  let cumulative = 0;

  return buckets.map((bucket) => {
    cumulative = round(cumulative + bucket.netPnl, 2);

    return {
      date: bucket.key,
      winRate: bucket.winRate,
      accuracy: bucket.accuracy,
      pnl: bucket.netPnl,
      cumulativePnl: cumulative,
      count: bucket.total,
    };
  });
}

/**
 * Weekday × hour grid. Every one of the 168 cells is emitted, including empties,
 * because a heat map with holes punched in it is unreadable.
 */
export function heatmap(signals: SignalLike[]): HeatCell[] {
  const grid = new Map<string, SignalLike[]>();

  for (const signal of signals) {
    const key = `${signal.entryAt.getUTCDay()}-${signal.entryAt.getUTCHours()}`;
    const existing = grid.get(key);
    if (existing) existing.push(signal);
    else grid.set(key, [signal]);
  }

  const cells: HeatCell[] = [];

  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const group = grid.get(`${weekday}-${hour}`) ?? [];
      const stats = computeStats(group);

      cells.push({
        weekday,
        hour,
        count: stats.total,
        winRate: stats.winRate,
      });
    }
  }

  return cells;
}

/**
 * Ranks buckets by win rate, but only among those with enough signals to mean
 * anything. A 100% win rate over two trades is noise, and presenting it as a
 * "best asset" would be actively misleading.
 */
export function rankBuckets(
  buckets: Bucket[],
  minimumSample = 5,
): { best: Bucket[]; worst: Bucket[]; excluded: number } {
  const eligible = buckets.filter((bucket) => bucket.settled >= minimumSample);
  const sorted = [...eligible].sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.settled - a.settled;
  });

  return {
    best: sorted.slice(0, 5),
    worst: sorted.slice(-5).reverse(),
    excluded: buckets.length - eligible.length,
  };
}
