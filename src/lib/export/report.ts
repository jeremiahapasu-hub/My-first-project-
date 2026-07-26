import { formatTimeframe } from "@/lib/analysis/performance";
import type { Overview } from "@/lib/services/analytics";
import type { SignalDTO } from "@/lib/types";

/**
 * The shape every exporter renders.
 *
 * Building this once means the CSV, the spreadsheet and the PDF cannot disagree
 * about what the report says — they differ only in presentation.
 */
export type ReportModel = {
  title: string;
  generatedAt: Date;
  scopeLines: string[];
  summary: { label: string; value: string }[];
  signals: SignalDTO[];
  assetRows: { label: string; settled: number; winRate: string; net: string }[];
  hourRows: { label: string; settled: number; winRate: string; net: string }[];
  providerRows: { label: string; settled: number; winRate: string; net: string }[];
  insights: { title: string; detail: string }[];
  disclaimer: string;
};

export const DISCLAIMER =
  "This report describes historical data that the account holder imported. " +
  "It is not financial advice, not a recommendation to trade, and not a prediction " +
  "of future results. Figures are only as accurate as the imported source data.";

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const num = (value: number) => value.toFixed(2);

function describeScope(filters: Record<string, unknown>): string[] {
  const lines: string[] = [];

  const from = filters.from ? String(filters.from) : null;
  const to = filters.to ? String(filters.to) : null;

  lines.push(
    from || to
      ? `Date range: ${from ?? "earliest"} to ${to ?? "latest"}`
      : "Date range: all imported data",
  );

  for (const [key, label] of [
    ["asset", "Asset"],
    ["provider", "Provider"],
    ["result", "Result"],
    ["direction", "Direction"],
  ] as const) {
    if (filters[key]) lines.push(`${label}: ${String(filters[key])}`);
  }

  if (filters.timeframe) {
    lines.push(`Timeframe: ${formatTimeframe(Number(filters.timeframe))}`);
  }

  if (lines.length === 1) lines.push("Filters: none applied");

  return lines;
}

export function buildReportModel(input: {
  overview: Overview;
  signals: SignalDTO[];
  insights: { title: string; detail: string }[];
  filters: Record<string, unknown>;
  accountName: string;
}): ReportModel {
  const { stats } = input.overview;

  const rows = (buckets: Overview["assets"]) =>
    buckets.map((bucket) => ({
      label: bucket.label,
      settled: bucket.settled,
      winRate: pct(bucket.winRate),
      net: num(bucket.netPnl),
    }));

  return {
    title: "Signal performance report",
    generatedAt: new Date(),
    scopeLines: [`Account: ${input.accountName}`, ...describeScope(input.filters)],
    summary: [
      { label: "Signals in scope", value: String(stats.total) },
      { label: "Settled", value: String(stats.settled) },
      { label: "Pending", value: String(stats.pending) },
      { label: "Wins", value: String(stats.wins) },
      { label: "Losses", value: String(stats.losses) },
      { label: "Draws", value: String(stats.draws) },
      { label: "Win rate", value: pct(stats.winRate) },
      { label: "Accuracy (draws counted against)", value: pct(stats.accuracy) },
      { label: "Net P/L", value: num(stats.netPnl) },
      { label: "Average P/L per settled signal", value: num(stats.avgPnl) },
      {
        label: "Profit factor",
        value: stats.profitFactor === null ? "—" : stats.profitFactor.toFixed(2),
      },
      { label: "Best winning run", value: String(stats.bestStreak) },
      { label: "Worst losing run", value: String(stats.worstStreak) },
    ],
    signals: input.signals,
    assetRows: rows(input.overview.assets),
    hourRows: rows(input.overview.hourly),
    providerRows: rows(input.overview.providers),
    insights: input.insights,
    disclaimer: DISCLAIMER,
  };
}
