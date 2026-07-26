/**
 * Shared helpers for turning messy user exports into typed rows.
 *
 * Every parser here follows the same contract: never throw on a bad row. Collect
 * the reason, skip the row, and keep going — one malformed line in a 5,000-row
 * export should not lose the other 4,999.
 */

export type RowError = {
  row: number;
  reason: string;
  raw?: string;
};

export type ParseResult<T> = {
  rows: T[];
  errors: RowError[];
  /** Total rows seen before validation, so the UI can show what was dropped. */
  seen: number;
};

/**
 * Finds a value by trying several header spellings.
 * Header matching is case-insensitive and ignores spaces, underscores and dashes,
 * so "Entry Time", "entry_time" and "entrytime" all resolve to the same column.
 */
export function pick(
  row: Record<string, unknown>,
  candidates: string[],
): string | undefined {
  const normalized = new Map<string, unknown>();

  for (const [key, value] of Object.entries(row)) {
    normalized.set(normalizeKey(key), value);
  }

  for (const candidate of candidates) {
    const value = normalized.get(normalizeKey(candidate));
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return undefined;
}

export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_\-.]/g, "");
}

/**
 * Parses the date formats that actually turn up in broker and chat exports.
 *
 * Handles ISO 8601, unix seconds and milliseconds, `DD/MM/YYYY HH:mm`,
 * `DD.MM.YYYY HH:mm:ss` and `YYYY-MM-DD HH:mm`. Ambiguous `MM/DD` vs `DD/MM` is
 * resolved as day-first, which is what Pocket Option's exports use.
 */
export function parseDate(input: string | undefined): Date | null {
  if (!input) return null;

  const value = input.trim();
  if (!value) return null;

  // Unix timestamps.
  if (/^\d{10}$/.test(value)) return new Date(Number(value) * 1000);
  if (/^\d{13}$/.test(value)) return new Date(Number(value));

  // Day-first with / . or - separators.
  const dayFirst =
    /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(
      value,
    );

  if (dayFirst) {
    const [, d, m, y, hh = "0", mm = "0", ss = "0"] = dayFirst;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    const date = new Date(
      Date.UTC(year, Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)),
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // `YYYY-MM-DD HH:mm[:ss]` without a timezone — read as UTC rather than letting
  // the server's local zone silently shift every timestamp.
  const spaceSeparated =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);

  if (spaceSeparated) {
    const [, y, m, d, hh, mm, ss = "0"] = spaceSeparated;
    return new Date(
      Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)),
    );
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Reads an expiry length in any of the notations these feeds use:
 * `M1`, `M5`, `1m`, `5 min`, `300`, `00:05:00`, `1h`, `S30`.
 * Returns seconds, or null if nothing recognisable is present.
 */
export function parseTimeframe(input: string | undefined): number | null {
  if (!input) return null;

  const value = input.trim().toLowerCase();
  if (!value) return null;

  // HH:MM:SS or MM:SS
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (clock) {
    const [, a, b, c] = clock;
    return c === undefined
      ? Number(a) * 60 + Number(b)
      : Number(a) * 3600 + Number(b) * 60 + Number(c);
  }

  // MT-style M1 / S30 / H1
  const mt = /^([smhd])\s*(\d+)$/.exec(value);
  if (mt) {
    const [, unit, amount] = mt;
    return Number(amount) * unitSeconds(unit);
  }

  // 5m / 30 sec / 1 hour
  const suffixed = /^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?$/.exec(
    value,
  );

  if (suffixed) {
    const amount = Number(suffixed[1]);
    const unit = suffixed[2];

    // A bare number is seconds, which is how these exports write it.
    if (!unit) return Math.round(amount);

    return Math.round(amount * unitSeconds(unit[0]));
  }

  return null;
}

function unitSeconds(unit: string): number {
  switch (unit) {
    case "s":
      return 1;
    case "m":
      return 60;
    case "h":
      return 3600;
    case "d":
      return 86400;
    default:
      return 1;
  }
}

/**
 * True only if the text really parses as JSON.
 *
 * Sniffing the first character is not enough: a plain-text chat log starts with
 * `[2026-07-14 09:15] alice: ...`, which looks like the opening of a JSON array
 * but is not one. Parsing is cheap relative to importing the wrong way.
 */
export function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return false;

  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** Heuristic for a delimited file: a header row naming any of `hints`. */
export function looksLikeCsv(text: string, hints: RegExp): boolean {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return /[,;\t]/.test(firstLine) && hints.test(firstLine);
}

/** Reads a number from a string that may carry currency symbols or commas. */
export function parseNumber(input: string | undefined): number | null {
  if (input === undefined) return null;

  const cleaned = input.replace(/[^0-9.\-+]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "+") return null;

  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
