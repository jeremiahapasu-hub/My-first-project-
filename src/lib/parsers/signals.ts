import Papa from "papaparse";
import { canonicalAsset } from "@/lib/analysis/assets";
import {
  looksLikeCsv,
  looksLikeJson,
  parseDate,
  parseNumber,
  parseTimeframe,
  pick,
  type ParseResult,
  type RowError,
} from "@/lib/parsers/common";
import type { Direction, SignalResult } from "@/lib/types";

export type ParsedSignal = {
  asset: string;
  direction: Direction;
  entryAt: Date;
  expiresAt: Date;
  timeframeSec: number;
  result: SignalResult;
  stake: number | null;
  payout: number | null;
  pnl: number | null;
  confidence: number | null;
  provider: string | null;
  rawText: string;
};

/** Header spellings seen across broker exports and signal-bot CSVs. */
const COLUMNS = {
  asset: ["asset", "pair", "symbol", "instrument", "market", "currency pair", "ticker"],
  direction: ["direction", "side", "action", "type", "call/put", "order", "signal"],
  entry: ["entry time", "entry", "open time", "time", "date", "opened at", "timestamp", "entry_at"],
  expiry: ["expiry time", "expiry", "close time", "closed at", "expiration", "expires at"],
  timeframe: ["timeframe", "duration", "expiry duration", "period", "tf", "expiration time"],
  result: ["result", "outcome", "status", "win/loss", "pl result"],
  stake: ["stake", "amount", "investment", "bet", "size", "trade amount"],
  payout: ["payout", "payout %", "payout rate", "return", "profit %"],
  pnl: ["pnl", "p/l", "profit", "profit/loss", "net", "result amount", "profit_loss"],
  confidence: ["confidence", "probability", "strength", "score", "accuracy"],
  provider: ["provider", "source", "channel", "author", "signal provider", "trader", "bot"],
};

/** Vocabulary for direction, covering binary-options phrasing. */
function parseDirection(raw: string | undefined): Direction | null {
  if (!raw) return null;

  const value = raw.trim().toLowerCase();

  if (/^(buy|call|up|long|higher|bull|bullish|1)$/.test(value)) return "BUY";
  if (/^(sell|put|down|short|lower|bear|bearish|0|-1|2)$/.test(value)) return "SELL";

  // Some feeds write "BUY EUR/USD" in a single cell.
  if (/\b(buy|call|up|long)\b/.test(value)) return "BUY";
  if (/\b(sell|put|down|short)\b/.test(value)) return "SELL";

  return null;
}

function parseResult(raw: string | undefined): SignalResult {
  if (!raw) return "PENDING";

  const value = raw.trim().toLowerCase();

  if (/^(win|won|w|profit|itm|success|1|true|✅)$/.test(value)) return "WIN";
  if (/^(loss|lose|lost|l|otm|fail|failed|0|false|❌)$/.test(value)) return "LOSS";
  if (/^(draw|tie|refund|refunded|break ?even|equal|push)$/.test(value)) return "DRAW";
  if (/^(pending|open|active|waiting|running|-)$/.test(value)) return "PENDING";

  if (/\bwin\b|\bwon\b/.test(value)) return "WIN";
  if (/\bloss\b|\blost\b/.test(value)) return "LOSS";

  return "PENDING";
}

/**
 * Normalises a confidence figure into 0..1.
 * Feeds express it as either a fraction (0.82) or a percentage (82).
 */
function normalizeConfidence(value: number | null): number | null {
  if (value === null) return null;
  if (value < 0) return null;
  if (value <= 1) return value;
  if (value <= 100) return Number((value / 100).toFixed(4));
  return null;
}

/** Converts one loosely-typed record into a validated signal. */
function buildSignal(
  record: Record<string, unknown>,
  rowNumber: number,
  errors: RowError[],
): ParsedSignal | null {
  const raw = JSON.stringify(record);

  const assetRaw = pick(record, COLUMNS.asset);
  if (!assetRaw) {
    errors.push({ row: rowNumber, reason: "No asset column found", raw });
    return null;
  }

  const asset = canonicalAsset(assetRaw) ?? assetRaw.toUpperCase().trim();

  const directionRaw = pick(record, COLUMNS.direction) ?? assetRaw;
  const direction = parseDirection(directionRaw);
  if (!direction) {
    errors.push({
      row: rowNumber,
      reason: `Could not read a BUY/SELL direction from "${directionRaw}"`,
      raw,
    });
    return null;
  }

  const entryAt = parseDate(pick(record, COLUMNS.entry));
  if (!entryAt) {
    errors.push({ row: rowNumber, reason: "Missing or unparseable entry time", raw });
    return null;
  }

  const timeframeSec = parseTimeframe(pick(record, COLUMNS.timeframe));
  const expiresAtRaw = parseDate(pick(record, COLUMNS.expiry));

  // Expiry can come as an absolute time, a duration, or both. Derive whichever
  // is missing; reject the row only when neither is present.
  let expiresAt: Date;
  let resolvedTimeframe: number;

  if (expiresAtRaw && timeframeSec) {
    expiresAt = expiresAtRaw;
    resolvedTimeframe = timeframeSec;
  } else if (expiresAtRaw) {
    expiresAt = expiresAtRaw;
    resolvedTimeframe = Math.max(
      1,
      Math.round((expiresAt.getTime() - entryAt.getTime()) / 1000),
    );
  } else if (timeframeSec) {
    resolvedTimeframe = timeframeSec;
    expiresAt = new Date(entryAt.getTime() + timeframeSec * 1000);
  } else {
    errors.push({
      row: rowNumber,
      reason: "Row has neither an expiry time nor a timeframe",
      raw,
    });
    return null;
  }

  if (expiresAt.getTime() < entryAt.getTime()) {
    errors.push({ row: rowNumber, reason: "Expiry is before entry", raw });
    return null;
  }

  return {
    asset,
    direction,
    entryAt,
    expiresAt,
    timeframeSec: resolvedTimeframe,
    result: parseResult(pick(record, COLUMNS.result)),
    stake: parseNumber(pick(record, COLUMNS.stake)),
    payout: parseNumber(pick(record, COLUMNS.payout)),
    pnl: parseNumber(pick(record, COLUMNS.pnl)),
    confidence: normalizeConfidence(parseNumber(pick(record, COLUMNS.confidence))),
    provider: pick(record, COLUMNS.provider) ?? null,
    rawText: raw,
  };
}

/** Parses a signals CSV. Delimiter is auto-detected by Papa Parse. */
export function parseSignalsCsv(text: string): ParseResult<ParsedSignal> {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });

  const errors: RowError[] = parsed.errors.map((error) => ({
    row: (error.row ?? 0) + 2,
    reason: error.message,
  }));

  const rows: ParsedSignal[] = [];

  parsed.data.forEach((record, index) => {
    const signal = buildSignal(record, index + 2, errors);
    if (signal) rows.push(signal);
  });

  return { rows, errors, seen: parsed.data.length };
}

/** Parses a signals JSON array, or an object wrapping one. */
export function parseSignalsJson(text: string): ParseResult<ParsedSignal> {
  const errors: RowError[] = [];

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { rows: [], errors: [{ row: 0, reason: "File is not valid JSON" }], seen: 0 };
  }

  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { signals?: unknown[] })?.signals)
      ? (data as { signals: unknown[] }).signals
      : Array.isArray((data as { data?: unknown[] })?.data)
        ? (data as { data: unknown[] }).data
        : null;

  if (!list) {
    return {
      rows: [],
      errors: [
        {
          row: 0,
          reason: 'Expected a JSON array, or an object with a "signals" or "data" array',
        },
      ],
      seen: 0,
    };
  }

  const rows: ParsedSignal[] = [];

  list.forEach((record, index) => {
    if (typeof record !== "object" || record === null) {
      errors.push({ row: index + 1, reason: "Entry is not an object" });
      return;
    }

    const signal = buildSignal(record as Record<string, unknown>, index + 1, errors);
    if (signal) rows.push(signal);
  });

  return { rows, errors, seen: list.length };
}

/**
 * Reads signals from free-form text, one per line.
 *
 * Targets the shape signal rooms actually post in, e.g.
 *   `EUR/USD OTC  BUY  M5  14:30  WIN`
 *   `🔵 GBPJPY CALL 5 min 2026-07-14 09:15 — result: loss`
 */
export function parseSignalsText(
  text: string,
  fallbackDate = new Date(),
): ParseResult<ParsedSignal> {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const errors: RowError[] = [];
  const rows: ParsedSignal[] = [];

  lines.forEach((line, index) => {
    const rowNumber = index + 1;

    const direction = parseDirection(line);
    if (!direction) {
      errors.push({ row: rowNumber, reason: "No BUY/SELL keyword in line", raw: line });
      return;
    }

    const assetMatch =
      /\b([A-Za-z]{3}\s?[/\-]\s?[A-Za-z]{3}|[A-Za-z]{6})\b(\s*\(?otc\)?)?/i.exec(line);

    if (!assetMatch) {
      errors.push({ row: rowNumber, reason: "No asset found in line", raw: line });
      return;
    }

    const asset =
      canonicalAsset(`${assetMatch[1]}${assetMatch[2] ? " OTC" : ""}`) ??
      assetMatch[1].toUpperCase();

    // A full date if present, otherwise a bare HH:MM applied to the fallback day.
    const dateMatch =
      /\b(\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?|\d{1,2}[/.]\d{1,2}[/.]\d{2,4}(?:\s+\d{1,2}:\d{2})?)\b/.exec(
        line,
      );

    let entryAt = dateMatch ? parseDate(dateMatch[1]) : null;

    if (!entryAt) {
      const timeMatch = /\b(\d{1,2}):(\d{2})\b/.exec(line);
      if (timeMatch) {
        entryAt = new Date(
          Date.UTC(
            fallbackDate.getUTCFullYear(),
            fallbackDate.getUTCMonth(),
            fallbackDate.getUTCDate(),
            Number(timeMatch[1]),
            Number(timeMatch[2]),
          ),
        );
      }
    }

    if (!entryAt) {
      errors.push({ row: rowNumber, reason: "No entry time found in line", raw: line });
      return;
    }

    const timeframeMatch =
      /\b([smh]\s?\d+|\d+\s?(?:s|sec|secs|m|min|mins|h|hr|hours))\b/i.exec(line);
    const timeframeSec = parseTimeframe(timeframeMatch?.[1]) ?? 300;

    const resultMatch = /\b(win|won|loss|lost|lose|draw|refund|itm|otm|pending)\b/i.exec(line);

    rows.push({
      asset,
      direction,
      entryAt,
      expiresAt: new Date(entryAt.getTime() + timeframeSec * 1000),
      timeframeSec,
      result: parseResult(resultMatch?.[1]),
      stake: null,
      payout: null,
      pnl: null,
      confidence: null,
      provider: null,
      rawText: line.trim(),
    });
  });

  return { rows, errors, seen: lines.length };
}

/** Dispatches on filename/content to the right signal parser. */
export function parseSignals(
  text: string,
  filename: string,
): ParseResult<ParsedSignal> {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".json")) return parseSignalsJson(text);
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) return parseSignalsCsv(text);

  if (looksLikeJson(text)) return parseSignalsJson(text);

  // A header row with a recognisable column name means it's really a CSV.
  if (looksLikeCsv(text, /asset|pair|symbol|direction|entry/i)) {
    return parseSignalsCsv(text);
  }

  return parseSignalsText(text);
}
