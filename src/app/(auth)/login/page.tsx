import type { Metadata } from "next";
import { AuthForm } from "../AuthForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-ink">Sign in</h1>
      <p className="mt-1.5 mb-7 text-sm text-ink-dim">
        Welcome back. Pick up where your last import left off.
      </p>

      <AuthForm mode="login" next={next} />

      <div className="mt-8 rounded-lg border border-line bg-panel/60 px-4 py-3">
        <p className="label-eyebrow mb-1.5">Demo accounts</p>
        <dl className="space-y-1 text-[11px] text-ink-faint">
          <div className="flex justify-between gap-3">
            <dt>analyst@example.com</dt>
            <dd className="font-mono text-ink-dim">analyst12345</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>viewer@example.com</dt>
            <dd className="font-mono text-ink-dim">viewer12345</dd>
          </div>
        </dl>
        <p className="mt-2 text-[11px] text-ink-faint">
          The analyst account is seeded with the sample dataset. The viewer
          account is read-only.
        </p>
      </div>
    </>
  );
}
