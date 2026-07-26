import type { NextRequest } from "next/server";
import { audit } from "@/lib/auth/guard";
import { fakeVerify, verifyPassword } from "@/lib/auth/password";
import { setSessionCookie, signSession } from "@/lib/auth/session";
import { ApiError, handler, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validation";

export const POST = handler(async (request: NextRequest) => {
  const body = loginSchema.parse(await request.json());
  const ip = request.headers.get("x-forwarded-for");

  const user = await prisma.user.findUnique({
    where: { email: body.email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      passwordHash: true,
    },
  });

  // Same error text and comparable timing whether the account exists or the
  // password is wrong, so this endpoint can't be used to enumerate accounts.
  if (!user) {
    await fakeVerify();
    await audit("auth.login.failed", null, { email: body.email }, ip);
    throw new ApiError(401, "Email or password is incorrect");
  }

  if (!(await verifyPassword(body.password, user.passwordHash))) {
    await audit("auth.login.failed", user.id, { email: body.email }, ip);
    throw new ApiError(401, "Email or password is incorrect");
  }

  const token = await signSession({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  await setSessionCookie(token);
  await audit("auth.login", user.id, {}, ip);

  return ok({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
});
