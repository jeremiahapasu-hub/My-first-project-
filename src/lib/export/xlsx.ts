import ExcelJS from "exceljs";
import { formatTimeframe } from "@/lib/analysis/performance";
import type { ReportModel } from "@/lib/export/report";

/** Palette matched to the dashboard so an exported book looks like the app. */
const INK = "FF0B1220";
const ACCENT = "FF1E9E8A";
const HEADER_TEXT = "FFF8FAFC";

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: HEADER_TEXT }, size: 11 };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: INK },
  };
  row.alignment = { vertical: "middle" };
  row.height = 20;
}

/**
 * Excel executes a cell that starts with `=`, `+`, `-` or `@`, so imported text
 * is prefixed the same way the CSV writer does it.
 */
function safeText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export async function buildWorkbook(model: ReportModel): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = "Pocket Signal Lab";
  workbook.created = model.generatedAt;

  // --- Summary --------------------------------------------------------------
  const summary = workbook.addWorksheet("Summary", {
    views: [{ showGridLines: false }],
  });

  summary.columns = [
    { key: "label", width: 42 },
    { key: "value", width: 22 },
  ];

  const titleRow = summary.addRow([model.title]);
  titleRow.font = { bold: true, size: 16, color: { argb: INK } };
  summary.mergeCells(titleRow.number, 1, titleRow.number, 2);

  summary.addRow([`Generated ${model.generatedAt.toISOString()}`]).font = {
    italic: true,
    size: 10,
  };

  for (const line of model.scopeLines) {
    summary.addRow([line]).font = { size: 10 };
  }

  summary.addRow([]);
  styleHeader(summary.addRow(["Metric", "Value"]));

  for (const item of model.summary) {
    const row = summary.addRow([item.label, item.value]);
    row.getCell(2).alignment = { horizontal: "right" };
  }

  summary.addRow([]);
  const disclaimerRow = summary.addRow([model.disclaimer]);
  disclaimerRow.font = { italic: true, size: 9, color: { argb: "FF64748B" } };
  disclaimerRow.alignment = { wrapText: true, vertical: "top" };
  summary.mergeCells(disclaimerRow.number, 1, disclaimerRow.number, 2);
  disclaimerRow.height = 46;

  // --- Breakdown sheets -----------------------------------------------------
  const addBreakdown = (
    name: string,
    firstColumn: string,
    rows: ReportModel["assetRows"],
  ) => {
    const sheet = workbook.addWorksheet(name, {
      views: [{ showGridLines: false, state: "frozen", ySplit: 1 }],
    });

    sheet.columns = [
      { key: "label", width: 26 },
      { key: "settled", width: 12 },
      { key: "winRate", width: 12 },
      { key: "net", width: 14 },
    ];

    styleHeader(sheet.addRow([firstColumn, "Settled", "Win rate", "Net P/L"]));

    for (const row of rows) {
      const added = sheet.addRow([
        safeText(row.label),
        row.settled,
        row.winRate,
        Number(row.net),
      ]);

      added.getCell(4).numFmt = "#,##0.00;[Red]-#,##0.00";
      added.getCell(2).alignment = { horizontal: "right" };
      added.getCell(3).alignment = { horizontal: "right" };
    }

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: 4 },
    };
  };

  addBreakdown("By asset", "Asset", model.assetRows);
  addBreakdown("By hour", "Hour (UTC)", model.hourRows);
  addBreakdown("By provider", "Provider", model.providerRows);

  // --- Signals --------------------------------------------------------------
  const signals = workbook.addWorksheet("Signals", {
    views: [{ showGridLines: false, state: "frozen", ySplit: 1 }],
  });

  signals.columns = [
    { key: "entry", width: 21 },
    { key: "expiry", width: 21 },
    { key: "asset", width: 16 },
    { key: "direction", width: 11 },
    { key: "timeframe", width: 11 },
    { key: "result", width: 11 },
    { key: "stake", width: 10 },
    { key: "payout", width: 10 },
    { key: "pnl", width: 12 },
    { key: "confidence", width: 12 },
    { key: "provider", width: 24 },
  ];

  styleHeader(
    signals.addRow([
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
    ]),
  );

  for (const signal of model.signals) {
    const row = signals.addRow([
      new Date(signal.entryAt),
      new Date(signal.expiresAt),
      safeText(signal.asset),
      signal.direction,
      formatTimeframe(signal.timeframeSec),
      signal.result,
      signal.stake,
      signal.payout,
      signal.pnl,
      signal.confidence,
      signal.provider ? safeText(signal.provider) : "",
    ]);

    row.getCell(1).numFmt = "yyyy-mm-dd hh:mm";
    row.getCell(2).numFmt = "yyyy-mm-dd hh:mm";
    row.getCell(9).numFmt = "#,##0.00;[Red]-#,##0.00";
    row.getCell(10).numFmt = "0%";

    // Result gets its own colour so a long sheet is scannable.
    const resultCell = row.getCell(6);
    if (signal.result === "WIN") {
      resultCell.font = { color: { argb: ACCENT }, bold: true };
    } else if (signal.result === "LOSS") {
      resultCell.font = { color: { argb: "FFDC2626" }, bold: true };
    }
  }

  signals.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 11 },
  };

  // --- Insights -------------------------------------------------------------
  if (model.insights.length > 0) {
    const insights = workbook.addWorksheet("Insights", {
      views: [{ showGridLines: false }],
    });

    insights.columns = [
      { key: "title", width: 48 },
      { key: "detail", width: 96 },
    ];

    styleHeader(insights.addRow(["Finding", "Detail"]));

    for (const insight of model.insights) {
      const row = insights.addRow([
        safeText(insight.title),
        safeText(insight.detail),
      ]);
      row.alignment = { wrapText: true, vertical: "top" };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
