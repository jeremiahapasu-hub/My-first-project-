import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { handler, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { parseFilters, signalSelect, signalWhere } from "@/lib/queries";

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Capped so a crafted `?pageSize=100000` can't be used to pull the whole table.
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["entryAt", "asset", "result", "pnl"]).default("entryAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const GET = handler(async (request: NextRequest) => {
  const session = await requireUser();
  const url = new URL(request.url);

  const filters = parseFilters(url);
  const { page, pageSize, sort, order } = paginationSchema.parse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
    order: url.searchParams.get("order") ?? undefined,
  });

  const where = signalWhere(session.sub, filters);

  const [total, rows] = await Promise.all([
    prisma.signal.count({ where }),
    prisma.signal.findMany({
      where,
      select: signalSelect,
      orderBy: { [sort]: order },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return ok({
    rows: rows.map((row) => ({
      ...row,
      entryAt: row.entryAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      provider: row.provider?.name ?? null,
    })),
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  });
});
