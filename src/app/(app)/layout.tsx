import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Shell } from "@/components/layout/Shell";
import { getSession } from "@/lib/auth/session";

/**
 * Authenticated shell.
 *
 * Middleware already redirects cookie-less visitors, but it does not verify the
 * signature — this is where a forged or expired cookie is actually caught.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  if (!session) redirect("/login");

  return (
    <Shell
      user={{ name: session.name, email: session.email, role: session.role }}
    >
      {children}
    </Shell>
  );
}
