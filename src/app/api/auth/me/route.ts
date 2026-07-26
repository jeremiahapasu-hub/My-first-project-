import { requireUser } from "@/lib/auth/guard";
import { handler, ok } from "@/lib/http";

export const GET = handler(async () => {
  const session = await requireUser();

  return ok({
    user: {
      id: session.sub,
      email: session.email,
      name: session.name,
      role: session.role,
    },
  });
});
