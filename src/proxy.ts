import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Edge-level routing guard (Next.js `proxy` convention).
 *
 * This only checks whether a session cookie is *present* — it deliberately does
 * not verify the signature. This runs on every request including static
 * assets, and the real check happens in `requireUser`/`requireRole` inside each
 * route and page. Treating this as the security boundary would be a mistake; it
 * exists to avoid rendering an authenticated shell for an obviously signed-out
 * visitor.
 */

const PUBLIC_PATHS = ["/login", "/register"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!hasCookie && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve where they were headed so login can send them back.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (hasCookie && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   - /api      (routes guard themselves and must return JSON, not a redirect)
     *   - Next.js internals and static files
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
