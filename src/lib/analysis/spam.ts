import { createHash } from "node:crypto";
import { SPAM_PATTERNS } from "@/lib/analysis/lexicon";

export type SpamVerdict = {
  isSpam: boolean;
  reason: string | null;
};

/**
 * Normalises a message down to its semantic core so that near-identical posts
 * hash the same: casing, punctuation, whitespace, and the digits that make
 * otherwise-identical spam look unique ("join now 1", "join now 2") are dropped.
 */
export function normalizeForHash(content: string): string {
  return content
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " url ")
    .replace(/\d+/g, "#")
    .replace(/[^\p{L}\p{N}#\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function contentHash(content: string): string {
  return createHash("sha256")
    .update(normalizeForHash(content))
    .digest("hex")
    .slice(0, 32);
}

/**
 * Flags promotional and scam-shaped messages.
 *
 * These are surfaced, never silently dropped — a message being promotional is
 * itself a fact about the room, and the user can filter it out if they want to.
 */
export function detectSpam(content: string, author: string): SpamVerdict {
  for (const { label, test } of SPAM_PATTERNS) {
    if (test.test(content)) {
      return { isSpam: true, reason: label };
    }
  }

  const letters = content.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 12) {
    const uppercase = content.replace(/[^A-Z]/g, "").length;
    if (uppercase / letters.length > 0.7) {
      return { isSpam: true, reason: "shouting" };
    }
  }

  // A wall of emoji with almost no words is decoration, not analysis.
  const emoji = [...content.matchAll(/\p{Extended_Pictographic}/gu)].length;
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  if (emoji >= 6 && emoji > words) {
    return { isSpam: true, reason: "emoji flood" };
  }

  if (/(.)\1{9,}/.test(content)) {
    return { isSpam: true, reason: "character flood" };
  }

  if (author.trim().length === 0) {
    return { isSpam: true, reason: "missing author" };
  }

  return { isSpam: false, reason: null };
}

/**
 * Marks repeats of an already-seen body as duplicates.
 *
 * The first occurrence of a hash is kept as the original; every later one is
 * flagged. `seen` is threaded through by the caller so duplicates are detected
 * against the user's whole history, not just the current upload.
 */
export function markDuplicates<T extends { contentHash: string }>(
  rows: T[],
  seen: Set<string>,
): (T & { isDuplicate: boolean })[] {
  return rows.map((row) => {
    const isDuplicate = seen.has(row.contentHash);
    seen.add(row.contentHash);
    return { ...row, isDuplicate };
  });
}
