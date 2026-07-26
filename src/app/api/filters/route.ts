import { requireUser } from "@/lib/auth/guard";
import { handler, ok } from "@/lib/http";
import { filterOptions } from "@/lib/queries";

/** Distinct values backing the dashboard's filter dropdowns. */
export const GET = handler(async () => {
  const session = await requireUser();
  return ok(await filterOptions(session.sub));
});
