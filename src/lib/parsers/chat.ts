import Papa from "papaparse";
import { detectAssets, detectStrategies } from "@/lib/analysis/assets";
import { analyzeSentiment } from "@/lib/analysis/sentiment";
import { contentHash, detectSpam } from "@/lib/analysis/spam";
import {
  looksLikeCsv,
  looksLikeJson,
  parseDate,
  pick,
  type ParseResult,
  type RowError,
} from "@/lib/parsers/common";
import type { Sentiment } from "@/lib/types";

export type ParsedMessage = {
  channel: string;
  author: string;
  content: string;
  postedAt: Date;
  sentiment: Sentiment;
  sentimentScore: number;
  assets: string[];
  strategies: string[];
  isSpam: boolean;
  spamReason: string | null;
  contentHash: string;
};

const COLUMNS = {
  channel: ["channel", "room", "group", "chat", "source", "conversation"],
  author: ["author", "user", "username", "sender", "from", "name", "nickname"],
  content: ["content", "message", "text", "body", "msg", "comment"],
  posted: ["posted at", "timestamp", "time", "date", "sent at", "datetime", "created at"],
};

/** Runs the analysis passes that every message gets, whatever the source format. */
function enrich(
  channel: string,
  author: string,
  content: string,
  postedAt: Date,
): ParsedMessage {
  const sentiment = analyzeSentiment(content);
  const spam = detectSpam(content, author);

  return {
    channel,
    author,
    content,
    postedAt,
    sentiment: sentiment.sentiment,
    sentimentScore: sentiment.score,
    assets: detectAssets(content),
    strategies: detectStrategies(content),
    isSpam: spam.isSpam,
    spamReason: spam.reason,
    contentHash: contentHash(content),
  };
}

export function parseChatCsv(
  text: string,
  defaultChannel: string,
): ParseResult<ParsedMessage> {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });

  const errors: RowError[] = parsed.errors.map((error) => ({
    row: (error.row ?? 0) + 2,
    reason: error.message,
  }));

  const rows: ParsedMessage[] = [];

  parsed.data.forEach((record, index) => {
    const rowNumber = index + 2;
    const content = pick(record, COLUMNS.content);

    if (!content) {
      errors.push({ row: rowNumber, reason: "No message content column found" });
      return;
    }

    const postedAt = parseDate(pick(record, COLUMNS.posted));
    if (!postedAt) {
      errors.push({ row: rowNumber, reason: "Missing or unparseable timestamp" });
      return;
    }

    rows.push(
      enrich(
        pick(record, COLUMNS.channel) ?? defaultChannel,
        pick(record, COLUMNS.author) ?? "unknown",
        content,
        postedAt,
      ),
    );
  });

  return { rows, errors, seen: parsed.data.length };
}

export function parseChatJson(
  text: string,
  defaultChannel: string,
): ParseResult<ParsedMessage> {
  const errors: RowError[] = [];

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { rows: [], errors: [{ row: 0, reason: "File is not valid JSON" }], seen: 0 };
  }

  // Telegram desktop exports nest the array under `messages`.
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { messages?: unknown[] })?.messages)
      ? (data as { messages: unknown[] }).messages
      : null;

  if (!list) {
    return {
      rows: [],
      errors: [
        { row: 0, reason: 'Expected a JSON array or an object with a "messages" array' },
      ],
      seen: 0,
    };
  }

  const channelName =
    (data as { name?: string })?.name?.toString() ?? defaultChannel;

  const rows: ParsedMessage[] = [];

  list.forEach((entry, index) => {
    const rowNumber = index + 1;

    if (typeof entry !== "object" || entry === null) {
      errors.push({ row: rowNumber, reason: "Entry is not an object" });
      return;
    }

    const record = entry as Record<string, unknown>;

    // Telegram splits message bodies into an array of text runs.
    const rawContent = record.text ?? pick(record, COLUMNS.content);
    const content = Array.isArray(rawContent)
      ? rawContent
          .map((part) =>
            typeof part === "string"
              ? part
              : ((part as { text?: string })?.text ?? ""),
          )
          .join("")
      : typeof rawContent === "string"
        ? rawContent
        : pick(record, COLUMNS.content);

    if (!content || !content.trim()) {
      errors.push({ row: rowNumber, reason: "Message has no text content" });
      return;
    }

    const postedAt = parseDate(
      pick(record, [...COLUMNS.posted, "date_unixtime", "date"]),
    );

    if (!postedAt) {
      errors.push({ row: rowNumber, reason: "Missing or unparseable timestamp" });
      return;
    }

    rows.push(
      enrich(
        pick(record, COLUMNS.channel) ?? channelName,
        pick(record, [...COLUMNS.author, "from"]) ?? "unknown",
        content.trim(),
        postedAt,
      ),
    );
  });

  return { rows, errors, seen: list.length };
}

/**
 * Parses a plain-text chat log.
 *
 * Recognises the common export shapes:
 *   `[2026-07-14 09:15] alice: message`
 *   `2026-07-14, 09:15 - alice: message`   (WhatsApp)
 *   `09:15 alice: message`                 (time only)
 *
 * A line that matches none of these is treated as a continuation of the previous
 * message, which is how multi-line posts survive the round trip.
 */
export function parseChatText(
  text: string,
  defaultChannel: string,
  fallbackDate = new Date(),
): ParseResult<ParsedMessage> {
  const lines = text.split(/\r?\n/);
  const errors: RowError[] = [];

  type Draft = { author: string; content: string[]; postedAt: Date };
  const drafts: Draft[] = [];

  const PATTERNS = [
    /^\s*\[(?<ts>[^\]]+)\]\s*(?<author>[^:]{1,60}?):\s*(?<body>.*)$/,
    /^\s*(?<ts>\d{1,2}[/.]\d{1,2}[/.]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?)\s*[-–]\s*(?<author>[^:]{1,60}?):\s*(?<body>.*)$/,
    /^\s*(?<ts>\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}(?::\d{2})?)\s*[-–]?\s*(?<author>[^:]{1,60}?):\s*(?<body>.*)$/,
    /^\s*(?<ts>\d{1,2}:\d{2}(?::\d{2})?)\s+(?<author>[^:]{1,60}?):\s*(?<body>.*)$/,
  ];

  lines.forEach((line, index) => {
    if (!line.trim()) return;

    let matched = false;

    for (const pattern of PATTERNS) {
      const match = pattern.exec(line);
      if (!match?.groups) continue;

      const { ts, author, body } = match.groups;

      let postedAt = parseDate(ts);

      // Time-only lines inherit the day from the fallback date.
      if (!postedAt) {
        const timeOnly = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(ts.trim());
        if (timeOnly) {
          postedAt = new Date(
            Date.UTC(
              fallbackDate.getUTCFullYear(),
              fallbackDate.getUTCMonth(),
              fallbackDate.getUTCDate(),
              Number(timeOnly[1]),
              Number(timeOnly[2]),
              Number(timeOnly[3] ?? 0),
            ),
          );
        }
      }

      if (!postedAt) {
        errors.push({
          row: index + 1,
          reason: `Could not read a timestamp from "${ts}"`,
          raw: line,
        });
        matched = true;
        break;
      }

      drafts.push({ author: author.trim(), content: [body], postedAt });
      matched = true;
      break;
    }

    if (matched) return;

    if (drafts.length > 0) {
      drafts[drafts.length - 1].content.push(line.trim());
    } else {
      errors.push({
        row: index + 1,
        reason: "Line has no recognisable timestamp and no preceding message",
        raw: line,
      });
    }
  });

  const rows = drafts
    .map((draft) =>
      enrich(
        defaultChannel,
        draft.author,
        draft.content.join("\n").trim(),
        draft.postedAt,
      ),
    )
    .filter((message) => message.content.length > 0);

  return { rows, errors, seen: drafts.length + errors.length };
}

/** Dispatches on filename/content to the right chat parser. */
export function parseChat(
  text: string,
  filename: string,
  defaultChannel = "imported",
): ParseResult<ParsedMessage> {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".json")) return parseChatJson(text, defaultChannel);
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
    return parseChatCsv(text, defaultChannel);
  }

  // `.txt` and `.log` are always chat transcripts. Sniffing content would
  // misfire here, because a transcript's first line opens with `[timestamp]`.
  if (lower.endsWith(".txt") || lower.endsWith(".log")) {
    return parseChatText(text, defaultChannel);
  }

  if (looksLikeJson(text)) return parseChatJson(text, defaultChannel);
  if (looksLikeCsv(text, /message|content|text|author|user/i)) {
    return parseChatCsv(text, defaultChannel);
  }

  return parseChatText(text, defaultChannel);
}
