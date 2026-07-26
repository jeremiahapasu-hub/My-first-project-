import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { handler, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { messageWhere, parseFilters } from "@/lib/queries";

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const GET = handler(async (request: NextRequest) => {
  const session = await requireUser();
  const url = new URL(request.url);

  const filters = parseFilters(url);
  const { page, pageSize } = paginationSchema.parse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });

  const where = messageWhere(session.sub, filters);

  const [total, rows] = await Promise.all([
    prisma.chatMessage.count({ where }),
    prisma.chatMessage.findMany({
      where,
      orderBy: { postedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        channel: true,
        author: true,
        content: true,
        postedAt: true,
        sentiment: true,
        sentimentScore: true,
        assets: true,
        strategies: true,
        isSpam: true,
        spamReason: true,
        isDuplicate: true,
      },
    }),
  ]);

  return ok({
    rows: rows.map((row) => ({
      ...row,
      postedAt: row.postedAt.toISOString(),
    })),
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  });
});
