import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { handler, ok } from "@/lib/http";
import { parseFilters } from "@/lib/queries";
import { buildChatAnalysis } from "@/lib/services/analytics";

export const GET = handler(async (request: NextRequest) => {
  const session = await requireUser();
  const filters = parseFilters(new URL(request.url));

  return ok(await buildChatAnalysis(session.sub, filters));
});
