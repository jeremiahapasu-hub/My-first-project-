"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type Mode = "login" | "register";

type FieldErrors = Record<string, string>;

export function AuthForm({ mode, next }: { mode: Mode; next?: string }) {
  const router = useRouter();

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const isRegister = mode === "register";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setPending(true);
    setError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        // 422 carries per-field messages; anything else is a single banner.
        if (Array.isArray(body.details)) {
          const errors: FieldErrors = {};
          for (const detail of body.details) {
            if (detail?.path) errors[detail.path] = detail.message;
          }
          setFieldErrors(errors);
        }

        setError(body.error ?? "Something went wrong. Try again.");
        setPending(false);
        return;
      }

      // Refresh so the server components pick up the new session cookie.
      router.replace(next && next.startsWith("/") ? next : "/dashboard");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-loss/30 bg-loss/10 px-3.5 py-2.5 text-xs text-loss"
        >
          {error}
        </div>
      ) : null}

      {isRegister ? (
        <Field
          label="Name"
          name="name"
          type="text"
          autoComplete="name"
          error={fieldErrors.name}
          required
        />
      ) : null}

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        error={fieldErrors.email}
        required
      />

      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete={isRegister ? "new-password" : "current-password"}
        error={fieldErrors.password}
        hint={isRegister ? "At least 10 characters, with a letter and a number." : undefined}
        required
      />

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-abyss transition hover:bg-accent-bright disabled:cursor-not-allowed disabled:opacity-55"
      >
        {pending
          ? isRegister
            ? "Creating account…"
            : "Signing in…"
          : isRegister
            ? "Create account"
            : "Sign in"}
      </button>

      <p className="text-center text-xs text-ink-faint">
        {isRegister ? "Already have an account? " : "No account yet? "}
        <Link
          href={isRegister ? "/login" : "/register"}
          className="font-medium text-accent-bright hover:underline"
        >
          {isRegister ? "Sign in" : "Create one"}
        </Link>
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  type,
  autoComplete,
  error,
  hint,
  required,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete?: string;
  error?: string;
  hint?: string;
  required?: boolean;
}) {
  const describedBy = error ? `${name}-error` : hint ? `${name}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-xs font-medium text-ink-dim">
        {label}
      </label>

      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`rounded-lg border bg-void px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-accent ${
          error ? "border-loss/60" : "border-line"
        }`}
      />

      {error ? (
        <p id={`${name}-error`} className="text-[11px] text-loss">
          {error}
        </p>
      ) : hint ? (
        <p id={`${name}-hint`} className="text-[11px] text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
