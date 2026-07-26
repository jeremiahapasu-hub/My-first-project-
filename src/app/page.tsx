import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

/** Entry point — routes to the dashboard or the sign-in screen. */
export default async function Home() {
  const session = await getSession();
  redirect(session ? "/dashboard" : "/login");
}
