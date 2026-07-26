import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { handler, ok } from "@/lib/http";
import { parseFilters } from "@/lib/queries";
import { buildHeatmap } from "@/lib/services/analytics";

export const GET = handler(async (request: NextRequest) => {
  const session = await requireUser();
  const filters = parseFilters(new URL(request.url));

  return ok(await buildHeatmap(session.sub, filters));
});
