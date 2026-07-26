import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatTimeframe } from "@/lib/analysis/performance";
import type { ReportModel } from "@/lib/export/report";

/**
 * PDF rendering with pdf-lib.
 *
 * Built on the standard PDF fonts rather than an embedded webfont, so the
 * generated file stays small and needs no font assets shipped with the app.
 * WinAnsi is the trade-off — see `sanitize` below.
 */

const PAGE = { width: 595.28, height: 841.89 }; // A4 portrait, in points
const MARGIN = 48;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;

const INK = rgb(0.043, 0.071, 0.125);
const MUTED = rgb(0.39, 0.45, 0.55);
const ACCENT = rgb(0.118, 0.62, 0.541);
const LOSS = rgb(0.86, 0.15, 0.15);
const RULE = rgb(0.88, 0.9, 0.93);

/**
 * The standard fonts are WinAnsi-encoded and throw on anything outside it, so
 * characters that arrive from imported data — em dashes, curly quotes, emoji in
 * a provider name — are folded down to safe equivalents rather than crashing the
 * export.
 */
function sanitize(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7E¡-ÿ]/g, "");
}

type Cursor = { page: PDFPage; y: number; pageNumber: number };

class Renderer {
  private readonly pages: PDFPage[] = [];

  constructor(
    private readonly doc: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
    private cursor: Cursor,
  ) {
    this.pages.push(cursor.page);
  }

  get page() {
    return this.cursor.page;
  }

  get y() {
    return this.cursor.y;
  }

  set y(value: number) {
    this.cursor.y = value;
  }

  /** Starts a new page when the next block wouldn't fit above the footer. */
  ensure(space: number) {
    if (this.cursor.y - space > MARGIN + 28) return;

    const page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.pages.push(page);

    this.cursor = {
      page,
      y: PAGE.height - MARGIN,
      pageNumber: this.cursor.pageNumber + 1,
    };
  }

  text(
    value: string,
    options: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      x?: number;
      indent?: number;
    } = {},
  ) {
    const size = options.size ?? 10;
    const font = options.bold ? this.bold : this.regular;

    this.page.drawText(sanitize(value), {
      x: options.x ?? MARGIN + (options.indent ?? 0),
      y: this.cursor.y,
      size,
      font,
      color: options.color ?? INK,
    });
  }

  /** Wraps `value` to `width` and draws it, advancing the cursor per line. */
  paragraph(
    value: string,
    options: { size?: number; color?: ReturnType<typeof rgb>; width?: number } = {},
  ) {
    const size = options.size ?? 10;
    const width = options.width ?? CONTENT_WIDTH;
    const lineHeight = size * 1.45;

    for (const line of wrap(sanitize(value), this.regular, size, width)) {
      this.ensure(lineHeight);
      this.text(line, { size, color: options.color });
      this.cursor.y -= lineHeight;
    }
  }

  heading(value: string) {
    this.ensure(38);
    this.cursor.y -= 8;
    this.text(value, { size: 13, bold: true });
    this.cursor.y -= 6;

    this.page.drawLine({
      start: { x: MARGIN, y: this.cursor.y },
      end: { x: PAGE.width - MARGIN, y: this.cursor.y },
      thickness: 0.75,
      color: RULE,
    });

    this.cursor.y -= 14;
  }

  /** Draws a table, repeating the header row whenever it breaks across pages. */
  table(
    columns: { label: string; width: number; align?: "left" | "right" }[],
    rows: (string | number)[][],
    colorFor?: (row: (string | number)[]) => ReturnType<typeof rgb> | undefined,
  ) {
    const rowHeight = 16;

    const drawHeader = () => {
      this.ensure(rowHeight * 2);

      this.page.drawRectangle({
        x: MARGIN,
        y: this.cursor.y - 4,
        width: CONTENT_WIDTH,
        height: rowHeight,
        color: rgb(0.96, 0.97, 0.98),
      });

      let x = MARGIN + 6;
      for (const column of columns) {
        const label = sanitize(column.label);
        const offset =
          column.align === "right"
            ? column.width - 12 - this.bold.widthOfTextAtSize(label, 8.5)
            : 0;

        this.page.drawText(label, {
          x: x + offset,
          y: this.cursor.y,
          size: 8.5,
          font: this.bold,
          color: MUTED,
        });

        x += column.width;
      }

      this.cursor.y -= rowHeight + 4;
    };

    drawHeader();

    for (const row of rows) {
      if (this.cursor.y - rowHeight <= MARGIN + 28) {
        this.ensure(rowHeight * 3);
        drawHeader();
      }

      let x = MARGIN + 6;
      const rowColor = colorFor?.(row);

      row.forEach((cell, index) => {
        const column = columns[index];
        if (!column) return;

        const value = sanitize(String(cell ?? ""));
        const clipped = clip(value, this.regular, 9, column.width - 12);

        const offset =
          column.align === "right"
            ? column.width - 12 - this.regular.widthOfTextAtSize(clipped, 9)
            : 0;

        this.page.drawText(clipped, {
          x: x + offset,
          y: this.cursor.y,
          size: 9,
          font: this.regular,
          color: index === 0 ? INK : (rowColor ?? INK),
        });

        x += column.width;
      });

      this.cursor.y -= rowHeight;
    }

    this.cursor.y -= 8;
  }

  /** Footer with page numbers, drawn once every page exists. */
  finish(title: string) {
    const total = this.pages.length;

    this.pages.forEach((page, index) => {
      page.drawLine({
        start: { x: MARGIN, y: MARGIN + 18 },
        end: { x: PAGE.width - MARGIN, y: MARGIN + 18 },
        thickness: 0.5,
        color: RULE,
      });

      page.drawText(sanitize(title), {
        x: MARGIN,
        y: MARGIN + 5,
        size: 8,
        font: this.regular,
        color: MUTED,
      });

      const label = `Page ${index + 1} of ${total}`;
      page.drawText(label, {
        x: PAGE.width - MARGIN - this.regular.widthOfTextAtSize(label, 8),
        y: MARGIN + 5,
        size: 8,
        font: this.regular,
        color: MUTED,
      });
    });
  }
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;

    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }

  if (line) lines.push(line);
  return lines;
}

function clip(text: string, font: PDFFont, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;

  let result = text;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}...`, size) > width) {
    result = result.slice(0, -1);
  }

  return `${result}...`;
}

export async function buildPdf(model: ReportModel): Promise<Buffer> {
  const doc = await PDFDocument.create();

  doc.setTitle(model.title);
  doc.setProducer("Pocket Signal Lab");
  doc.setCreationDate(model.generatedAt);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const first = doc.addPage([PAGE.width, PAGE.height]);
  const r = new Renderer(doc, regular, bold, {
    page: first,
    y: PAGE.height - MARGIN,
    pageNumber: 1,
  });

  // --- Title block ----------------------------------------------------------
  r.text(model.title, { size: 22, bold: true });
  r.y -= 26;

  r.text(`Generated ${model.generatedAt.toISOString().replace("T", " ").slice(0, 19)} UTC`, {
    size: 9,
    color: MUTED,
  });
  r.y -= 18;

  for (const line of model.scopeLines) {
    r.text(line, { size: 9, color: MUTED });
    r.y -= 12;
  }

  r.y -= 8;

  // --- Summary --------------------------------------------------------------
  r.heading("Summary");
  r.table(
    [
      { label: "Metric", width: CONTENT_WIDTH * 0.62 },
      { label: "Value", width: CONTENT_WIDTH * 0.38, align: "right" },
    ],
    model.summary.map((item) => [item.label, item.value]),
  );

  // --- Breakdowns -----------------------------------------------------------
  const breakdown = (
    title: string,
    firstColumn: string,
    rows: ReportModel["assetRows"],
  ) => {
    if (rows.length === 0) return;

    r.heading(title);
    r.table(
      [
        { label: firstColumn, width: CONTENT_WIDTH * 0.4 },
        { label: "Settled", width: CONTENT_WIDTH * 0.2, align: "right" },
        { label: "Win rate", width: CONTENT_WIDTH * 0.2, align: "right" },
        { label: "Net P/L", width: CONTENT_WIDTH * 0.2, align: "right" },
      ],
      rows.map((row) => [row.label, row.settled, row.winRate, row.net]),
      (row) => (Number(row[3]) < 0 ? LOSS : ACCENT),
    );
  };

  breakdown("Performance by asset", "Asset", model.assetRows);
  breakdown("Performance by hour (UTC)", "Hour", model.hourRows);
  breakdown("Performance by provider", "Provider", model.providerRows);

  // --- Insights -------------------------------------------------------------
  if (model.insights.length > 0) {
    r.heading("Findings");

    for (const insight of model.insights) {
      r.ensure(40);
      r.text(insight.title, { size: 10, bold: true });
      r.y -= 14;
      r.paragraph(insight.detail, { size: 9, color: MUTED });
      r.y -= 6;
    }
  }

  // --- Signals --------------------------------------------------------------
  if (model.signals.length > 0) {
    r.heading(`Signals (${model.signals.length})`);

    r.table(
      [
        { label: "Entry (UTC)", width: CONTENT_WIDTH * 0.2 },
        { label: "Asset", width: CONTENT_WIDTH * 0.17 },
        { label: "Dir", width: CONTENT_WIDTH * 0.09 },
        { label: "TF", width: CONTENT_WIDTH * 0.08 },
        { label: "Result", width: CONTENT_WIDTH * 0.12 },
        { label: "P/L", width: CONTENT_WIDTH * 0.12, align: "right" },
        { label: "Provider", width: CONTENT_WIDTH * 0.22 },
      ],
      model.signals.map((signal) => [
        signal.entryAt.replace("T", " ").slice(0, 16),
        signal.asset,
        signal.direction,
        formatTimeframe(signal.timeframeSec),
        signal.result,
        signal.pnl === null ? "-" : signal.pnl.toFixed(2),
        signal.provider ?? "-",
      ]),
      (row) => (row[4] === "WIN" ? ACCENT : row[4] === "LOSS" ? LOSS : MUTED),
    );
  }

  // --- Disclaimer -----------------------------------------------------------
  r.ensure(60);
  r.heading("Important");
  r.paragraph(model.disclaimer, { size: 8.5, color: MUTED });

  r.finish(model.title);

  return Buffer.from(await doc.save());
}
