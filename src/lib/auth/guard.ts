import { getSession, type SessionPayload } from "@/lib/auth/session";
import { forbidden, unauthorized } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/types";

/** Role capability matrix. Higher roles inherit everything below them. */
const RANK: Record<Role, number> = {
  VIEWER: 1,
  ANALYST: 2,
  ADMIN: 3,
};

export function roleAtLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

/** Throws 401 unless a valid session cookie is present. */
export async function requireUser(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw unauthorized();
  return session;
}

/**
 * Throws 401 when signed out, 403 when the role is too low.
 *
 * Note that VIEWER is read-only: every mutating route guards on ANALYST.
 */
export async function requireRole(minimum: Role): Promise<SessionPayload> {
  const session = await requireUser();

  if (!roleAtLeast(session.role, minimum)) {
    throw forbidden(
      `This action needs the ${minimum} role; your account is ${session.role}.`,
    );
  }

  return session;
}

/**
 * Records a security-relevant action. Failures here must never break the request
 * that triggered them, so the write is deliberately swallowed on error.
 */
export async function audit(
  action: string,
  userId: string | null,
  meta?: Record<string, unknown>,
  ip?: string | null,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        userId: userId ?? undefined,
        meta: (meta ?? {}) as never,
        ip: ip ?? undefined,
      },
    });
  } catch (error) {
    console.error("[audit] failed to record", action, error);
  }
}
