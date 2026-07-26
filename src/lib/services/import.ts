import { markDuplicates } from "@/lib/analysis/spam";
import { parseChat } from "@/lib/parsers/chat";
import { parseSignals } from "@/lib/parsers/signals";
import { prisma } from "@/lib/prisma";

/**
 * The ingestion service.
 *
 * Both the upload endpoint and the seed script go through here, so the demo data
 * is created by exactly the code path a real import uses — if the importer breaks,
 * seeding breaks too, rather than the two drifting quietly apart.
 */

export type ImportSummary = {
  batchId: string;
  filename: string;
  seen: number;
  accepted: number;
  rejected: number;
  errors: { row: number; reason: string; raw?: string }[];
  /** Duplicate count, chat imports only. */
  duplicates?: number;
};

/** Chunk size for createMany — keeps a large upload off one giant statement. */
const CHUNK = 500;

function chunked<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export async function importSignals(
  userId: string,
  text: string,
  filename: string,
): Promise<ImportSummary> {
  const parsed = parseSignals(text, filename);

  const batch = await prisma.importBatch.create({
    data: {
      userId,
      kind: "SIGNALS",
      filename,
      rowCount: parsed.seen,
      acceptedCount: parsed.rows.length,
      rejectedCount: parsed.errors.length,
      // Cap what's persisted; a pathological file could otherwise store megabytes
      // of rejection text in a single JSON column.
      errors: parsed.errors.slice(0, 200) as never,
    },
  });

  // Resolve provider names to rows once, rather than per signal.
  const providerNames = [
    ...new Set(
      parsed.rows
        .map((row) => row.provider?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ];

  const providerIds = new Map<string, string>();

  for (const name of providerNames) {
    const provider = await prisma.provider.upsert({
      where: { userId_name: { userId, name } },
      create: { userId, name },
      update: {},
      select: { id: true, name: true },
    });

    providerIds.set(provider.name, provider.id);
  }

  for (const group of chunked(parsed.rows)) {
    await prisma.signal.createMany({
      data: group.map((row) => ({
        userId,
        batchId: batch.id,
        providerId: row.provider
          ? (providerIds.get(row.provider.trim()) ?? null)
          : null,
        asset: row.asset,
        direction: row.direction,
        entryAt: row.entryAt,
        expiresAt: row.expiresAt,
        timeframeSec: row.timeframeSec,
        result: row.result,
        stake: row.stake,
        payout: row.payout,
        pnl: row.pnl,
        confidence: row.confidence,
        rawText: row.rawText,
      })),
    });
  }

  return {
    batchId: batch.id,
    filename,
    seen: parsed.seen,
    accepted: parsed.rows.length,
    rejected: parsed.errors.length,
    errors: parsed.errors.slice(0, 50),
  };
}

export async function importChat(
  userId: string,
  text: string,
  filename: string,
  channel = "imported",
): Promise<ImportSummary> {
  const parsed = parseChat(text, filename, channel);

  const batch = await prisma.importBatch.create({
    data: {
      userId,
      kind: "CHAT",
      filename,
      rowCount: parsed.seen,
      acceptedCount: parsed.rows.length,
      rejectedCount: parsed.errors.length,
      errors: parsed.errors.slice(0, 200) as never,
    },
  });

  // Duplicates are detected against the user's entire history, not just this
  // file, so re-uploading an overlapping export doesn't inflate the counts.
  const existing = await prisma.chatMessage.findMany({
    where: { userId },
    select: { contentHash: true },
    distinct: ["contentHash"],
  });

  const seenHashes = new Set(existing.map((row) => row.contentHash));
  const flagged = markDuplicates(parsed.rows, seenHashes);

  for (const group of chunked(flagged)) {
    await prisma.chatMessage.createMany({
      data: group.map((row) => ({
        userId,
        batchId: batch.id,
        channel: row.channel,
        author: row.author,
        content: row.content,
        postedAt: row.postedAt,
        sentiment: row.sentiment,
        sentimentScore: row.sentimentScore,
        assets: row.assets,
        strategies: row.strategies,
        isSpam: row.isSpam,
        spamReason: row.spamReason,
        isDuplicate: row.isDuplicate,
        contentHash: row.contentHash,
      })),
    });
  }

  return {
    batchId: batch.id,
    filename,
    seen: parsed.seen,
    accepted: parsed.rows.length,
    rejected: parsed.errors.length,
    errors: parsed.errors.slice(0, 50),
    duplicates: flagged.filter((row) => row.isDuplicate).length,
  };
}
