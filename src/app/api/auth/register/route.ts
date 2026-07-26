import type { NextRequest } from "next/server";
import { audit } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { setSessionCookie, signSession } from "@/lib/auth/session";
import { badRequest, handler, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validation";

export const POST = handler(async (request: NextRequest) => {
  const body = registerSchema.parse(await request.json());

  const existing = await prisma.user.findUnique({
    where: { email: body.email },
    select: { id: true },
  });

  if (existing) {
    throw badRequest("An account with that email already exists");
  }

  // The first account to register becomes the admin; everyone after is an
  // analyst. This avoids shipping a default admin password.
  const isFirstUser = (await prisma.user.count()) === 0;

  const user = await prisma.user.create({
    data: {
      email: body.email,
      name: body.name,
      passwordHash: await hashPassword(body.password),
      role: isFirstUser ? "ADMIN" : "ANALYST",
    },
    select: { id: true, email: true, name: true, role: true },
  });

  const token = await signSession({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  await setSessionCookie(token);
  await audit("auth.register", user.id, { email: user.email });

  return ok({ user }, { status: 201 });
});
