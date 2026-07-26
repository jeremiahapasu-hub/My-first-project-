import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { SignalFilters } from "@/lib/types";

/**
 * Filter parsing and the shared `where` builders.
 *
 * Every read path funnels through here, and every builder takes `userId` as its
 * first argument, so it is structurally impossible to build a query that reads
 * across tenants.
 */

export const filterSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  asset: z.string().optional(),
  provider: z.string().optional(),
  result: z.enum(["WIN", "LOSS", "DRAW", "PENDING"]).optional(),
  direction: z.enum(["BUY", "SELL"]).optional(),
  timeframe: z.coerce.number().int().positive().optional(),
  channel: z.string().optional(),
  sentiment: z.enum(["BULLISH", "BEARISH", "NEUTRAL"]).optional(),
  includeSpam: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((value) => value === "true"),
  search: z.string().optional(),
});

export type Filters = z.infer<typeof filterSchema>;

/** Reads filters off a URL, dropping blanks so `?asset=` doesn't filter on "". */
export function parseFilters(url: URL): Filters {
  const raw: Record<string, string> = {};

  for (const [key, value] of url.searchParams.entries()) {
    if (value.trim() !== "") raw[key] = value;
  }

  return filterSchema.parse(raw);
}

/** End-of-day for a bare `YYYY-MM-DD`, so `to` is inclusive of that whole day. */
function endOfDay(value: string): Date {
  const date = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}

export function signalWhere(
  userId: string,
  filters: Filters,
): Prisma.SignalWhereInput {
  const where: Prisma.SignalWhereInput = { userId };

  if (filters.from || filters.to) {
    where.entryAt = {};
    if (filters.from) where.entryAt.gte = new Date(filters.from);
    if (filters.to) where.entryAt.lte = endOfDay(filters.to);
  }

  if (filters.asset) where.asset = filters.asset;
  if (filters.result) where.result = filters.result;
  if (filters.direction) where.direction = filters.direction;
  if (filters.timeframe) where.timeframeSec = filters.timeframe;
  if (filters.provider) where.provider = { name: filters.provider };

  return where;
}

export function messageWhere(
  userId: string,
  filters: Filters,
): Prisma.ChatMessageWhereInput {
  const where: Prisma.ChatMessageWhereInput = { userId };

  if (filters.from || filters.to) {
    where.postedAt = {};
    if (filters.from) where.postedAt.gte = new Date(filters.from);
    if (filters.to) where.postedAt.lte = endOfDay(filters.to);
  }

  if (filters.channel) where.channel = filters.channel;
  if (filters.sentiment) where.sentiment = filters.sentiment;
  if (filters.asset) where.assets = { has: filters.asset };

  // Promotional messages are hidden by default; they skew every sentiment read.
  if (!filters.includeSpam) where.isSpam = false;

  if (filters.search) {
    where.content = { contains: filters.search, mode: "insensitive" };
  }

  return where;
}

/** The signal shape the analysis functions expect. */
export const signalSelect = {
  id: true,
  asset: true,
  direction: true,
  entryAt: true,
  expiresAt: true,
  timeframeSec: true,
  result: true,
  stake: true,
  payout: true,
  pnl: true,
  confidence: true,
  provider: { select: { name: true } },
} satisfies Prisma.SignalSelect;

export async function loadSignals(userId: string, filters: Filters) {
  return prisma.signal.findMany({
    where: signalWhere(userId, filters),
    select: signalSelect,
    orderBy: { entryAt: "asc" },
  });
}

export async function loadMessages(userId: string, filters: Filters) {
  return prisma.chatMessage.findMany({
    where: messageWhere(userId, filters),
    orderBy: { postedAt: "asc" },
  });
}

/** Distinct values for the filter bar's dropdowns. */
export async function filterOptions(userId: string) {
  const [assets, providers, channels, timeframes] = await Promise.all([
    prisma.signal.findMany({
      where: { userId },
      select: { asset: true },
      distinct: ["asset"],
      orderBy: { asset: "asc" },
    }),
    prisma.provider.findMany({
      where: { userId },
      select: { name: true },
      orderBy: { name: "asc" },
    }),
    prisma.chatMessage.findMany({
      where: { userId },
      select: { channel: true },
      distinct: ["channel"],
      orderBy: { channel: "asc" },
    }),
    prisma.signal.findMany({
      where: { userId },
      select: { timeframeSec: true },
      distinct: ["timeframeSec"],
      orderBy: { timeframeSec: "asc" },
    }),
  ]);

  return {
    assets: assets.map((row) => row.asset),
    providers: providers.map((row) => row.name),
    channels: channels.map((row) => row.channel),
    timeframes: timeframes.map((row) => row.timeframeSec),
  };
}

/** Serialises filters back into a query string for links and export URLs. */
export function toQueryString(filters: Partial<SignalFilters> & Record<string, unknown>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }

  return params.toString();
}
