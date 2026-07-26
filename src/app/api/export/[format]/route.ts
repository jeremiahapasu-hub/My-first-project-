import type { NextRequest } from "next/server";
import { audit, requireUser } from "@/lib/auth/guard";
import { reportCsv, signalsCsv } from "@/lib/export/csv";
import { buildPdf } from "@/lib/export/pdf";
import { buildReportModel } from "@/lib/export/report";
import { buildWorkbook } from "@/lib/export/xlsx";
import { badRequest, handler } from "@/lib/http";
import { loadSignals, parseFilters } from "@/lib/queries";
import { buildInsights, buildOverview } from "@/lib/services/analytics";
import type { SignalDTO } from "@/lib/types";

/**
 * Report download in CSV, XLSX or PDF.
 *
 * All three render the same `ReportModel`, so a spreadsheet and a PDF pulled with
 * identical filters always agree.
 */

// Rendering a large workbook or PDF is CPU-bound and can exceed the default.
export const maxDuration = 60;

const FORMATS = ["csv", "xlsx", "pdf"] as const;
type Format = (typeof FORMATS)[number];

/** Row cap per format — a 20k-row PDF helps nobody and would time out. */
const ROW_LIMIT: Record<Format, number> = {
  csv: 50_000,
  xlsx: 50_000,
  pdf: 1_500,
};

export const GET = handler(
  async (
    request: NextRequest,
    context: { params: Promise<{ format: string }> },
  ) => {
    const session = await requireUser();
    const { format } = await context.params;

    if (!FORMATS.includes(format as Format)) {
      throw badRequest(`Unsupported format "${format}". Use csv, xlsx or pdf.`);
    }

    const url = new URL(request.url);
    const filters = parseFilters(url);
    const signalsOnly = url.searchParams.get("signalsOnly") === "true";

    const [overview, rawSignals, insights] = await Promise.all([
      buildOverview(session.sub, filters),
      loadSignals(session.sub, filters),
      // The insight pass is skipped for a signals-only CSV, which is the export
      // people reach for when they just want the rows in a spreadsheet.
      signalsOnly && format === "csv"
        ? Promise.resolve(null)
        : buildInsights(session.sub, filters),
    ]);

    const limit = ROW_LIMIT[format as Format];

    const signals: SignalDTO[] = rawSignals
      .slice(0, limit)
      .map((signal) => ({
        id: signal.id,
        asset: signal.asset,
        direction: signal.direction,
        entryAt: signal.entryAt.toISOString(),
        expiresAt: signal.expiresAt.toISOString(),
        timeframeSec: signal.timeframeSec,
        result: signal.result,
        stake: signal.stake,
        payout: signal.payout,
        pnl: signal.pnl,
        confidence: signal.confidence,
        provider: signal.provider?.name ?? null,
      }));

    const model = buildReportModel({
      overview,
      signals,
      insights:
        insights?.insights.map((insight) => ({
          title: insight.title,
          detail: insight.detail,
        })) ?? [],
      filters,
      accountName: session.email,
    });

    if (rawSignals.length > limit) {
      model.scopeLines.push(
        `Note: showing the first ${limit.toLocaleString()} of ${rawSignals.length.toLocaleString()} signals.`,
      );
    }

    const stamp = model.generatedAt.toISOString().slice(0, 10);
    const base = `signal-report-${stamp}`;

    await audit("export", session.sub, { format, rows: signals.length });

    if (format === "csv") {
      const body = signalsOnly ? signalsCsv(model) : reportCsv(model);

      return new Response(`﻿${body}`, {
        headers: {
          // The BOM makes Excel open UTF-8 correctly on Windows.
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${base}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (format === "xlsx") {
      const buffer = await buildWorkbook(model);

      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${base}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const buffer = await buildPdf(model);

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${base}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  },
);
