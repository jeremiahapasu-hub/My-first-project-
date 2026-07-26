import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import type { Role } from "@/lib/types";

export const SESSION_COOKIE = "psl_session";

export type SessionPayload = {
  sub: string;
  email: string;
  name: string;
  role: Role;
};

const secret = new TextEncoder().encode(env.AUTH_SECRET);
const ALG = "HS256";

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({
    email: payload.email,
    name: payload.name,
    role: payload.role,
  })
    .setProtectedHeader({ alg: ALG })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer("pocket-signal-lab")
    .setAudience("pocket-signal-lab")
    .setExpirationTime(env.AUTH_SESSION_TTL)
    .sign(secret);
}

/**
 * Returns null rather than throwing for any invalid token — expired, tampered,
 * wrong issuer. Callers treat null as "not signed in".
 */
export async function verifySession(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: [ALG],
      issuer: "pocket-signal-lab",
      audience: "pocket-signal-lab",
    });

    if (!payload.sub) return null;

    return {
      sub: payload.sub,
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      role: (payload.role as Role) ?? "VIEWER",
    };
  } catch {
    return null;
  }
}

function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!match) return 60 * 60 * 24 * 7;

  const value = Number(match[1]);
  const unit = match[2];
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit] ?? 1;

  return value * multiplier;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();

  store.set(SESSION_COOKIE, token, {
    httpOnly: true, // not readable from JS, so XSS can't lift the session
    sameSite: "lax", // blocks cross-site form posts while keeping normal navigation
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: ttlToSeconds(env.AUTH_SESSION_TTL),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Reads and verifies the session from the incoming request's cookies. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}
