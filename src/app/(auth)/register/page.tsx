import type { Metadata } from "next";
import { AuthForm } from "../AuthForm";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-ink">
        Create an account
      </h1>
      <p className="mt-1.5 mb-7 text-sm text-ink-dim">
        Your data stays scoped to your account. Nothing is shared between users.
      </p>

      <AuthForm mode="register" />
    </>
  );
}
