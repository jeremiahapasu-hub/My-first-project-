import { audit } from "@/lib/auth/guard";
import { clearSessionCookie, getSession } from "@/lib/auth/session";
import { handler, ok } from "@/lib/http";

export const POST = handler(async () => {
  const session = await getSession();

  await clearSessionCookie();

  if (session) await audit("auth.logout", session.sub);

  return ok({ signedOut: true });
});
