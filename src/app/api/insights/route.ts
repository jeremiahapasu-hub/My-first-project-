import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { handler, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { parseFilters } from "@/lib/queries";
import { buildInsights } from "@/lib/services/analytics";

export const GET = handler(async (request: NextRequest) => {
  const session = await requireUser();
  const url = new URL(request.url);
  const filters = parseFilters(url);

  const payload = await buildInsights(session.sub, filters);

  // `?save=true` freezes the run so it can be re-opened exactly as generated.
  if (url.searchParams.get("save") === "true") {
    await prisma.insightReport.create({
      data: {
        userId: session.sub,
        scope: filters as never,
        payload: payload as never,
        engine: payload.engine,
      },
    });
  }

  return ok(payload);
});
