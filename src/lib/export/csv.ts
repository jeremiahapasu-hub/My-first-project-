import { formatTimeframe } from "@/lib/analysis/performance";
import type { ReportModel } from "@/lib/export/report";

/**
 * RFC 4180 escaping.
 *
 * The leading apostrophe guard matters: a value beginning with `=`, `+`, `-` or
 * `@` is executed as a formula when the file is opened in Excel or Sheets, which
 * turns an imported provider name into a CSV-injection vector.
 */
function escape(value: unknown): string {
  if (value === null || value === undefined) return "";

  let text = String(value);

  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function toCsvRows(rows: (string | number | null)[][]): string {
  return rows.map((row) => row.map(escape).join(",")).join("\r\n");
}

/** The signal table, one row per signal. */
export function signalsCsv(model: ReportModel): string {
  const header = [
    "Entry (UTC)",
    "Expiry (UTC)",
    "Asset",
    "Direction",
    "Timeframe",
    "Result",
    "Stake",
    "Payout",
    "P/L",
    "Confidence",
    "Provider",
  ];

  const rows = model.signals.map((signal) => [
    signal.entryAt.replace("T", " ").slice(0, 19),
    signal.expiresAt.replace("T", " ").slice(0, 19),
    signal.asset,
    signal.direction,
    formatTimeframe(signal.timeframeSec),
    signal.result,
    signal.stake ?? "",
    signal.payout ?? "",
    signal.pnl ?? "",
    signal.confidence ?? "",
    signal.provider ?? "",
  ]);

  return toCsvRows([header, ...rows]);
}

/**
 * The full report as a single CSV.
 *
 * CSV has no concept of sheets, so the sections are stacked with blank-line
 * separators and their own header rows — the conventional way to fit a
 * multi-section report into one flat file.
 */
export function reportCsv(model: ReportModel): string {
  const blocks: string[] = [];

  blocks.push(
    toCsvRows([
      [model.title],
      [`Generated ${model.generatedAt.toISOString()}`],
      ...model.scopeLines.map((line) => [line]),
    ]),
  );

  blocks.push(
    toCsvRows([
      ["Summary", ""],
      ...model.summary.map((row) => [row.label, row.value]),
    ]),
  );

  const section = (
    title: string,
    rows: { label: string; settled: number; winRate: string; net: string }[],
  ) =>
    toCsvRows([
      [title, "", "", ""],
      ["Name", "Settled", "Win rate", "Net P/L"],
      ...rows.map((row) => [row.label, row.settled, row.winRate, row.net]),
    ]);

  blocks.push(section("By asset", model.assetRows));
  blocks.push(section("By hour (UTC)", model.hourRows));
  blocks.push(section("By provider", model.providerRows));

  if (model.insights.length > 0) {
    blocks.push(
      toCsvRows([
        ["Insights", ""],
        ["Finding", "Detail"],
        ...model.insights.map((insight) => [insight.title, insight.detail]),
      ]),
    );
  }

  blocks.push(toCsvRows([["Signals"]]));
  blocks.push(signalsCsv(model));
  blocks.push(toCsvRows([[""], [model.disclaimer]]));

  return blocks.join("\r\n\r\n");
}
