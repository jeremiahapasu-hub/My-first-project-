import clsx from "clsx";
import type { ReactNode } from "react";

/** Shared presentational building blocks. Server-safe — no client hooks here. */

export function Panel({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return <Tag className={clsx("panel", className)}>{children}</Tag>;
}

export function PanelHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-ink-faint">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

/**
 * A headline figure.
 *
 * `tone` colours the value semantically; `hint` carries the context that stops a
 * bare percentage from being misread (sample size, what the denominator is).
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  trend,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "good" | "bad" | "warn" | "accent";
  trend?: { value: string; direction: "up" | "down" | "flat" };
}) {
  const toneClass = {
    neutral: "text-ink",
    good: "text-win",
    bad: "text-loss",
    warn: "text-pending",
    accent: "text-accent-bright",
  }[tone];

  return (
    <div className="panel flex flex-col gap-1 px-4 py-3.5">
      <span className="label-eyebrow">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className={clsx("stat-value text-2xl font-semibold tracking-tight", toneClass)}>
          {value}
        </span>
        {trend ? (
          <span
            className={clsx(
              "text-xs font-medium tnum",
              trend.direction === "up"
                ? "text-win"
                : trend.direction === "down"
                  ? "text-loss"
                  : "text-ink-faint",
            )}
          >
            {trend.direction === "up" ? "▲" : trend.direction === "down" ? "▼" : "—"}{" "}
            {trend.value}
          </span>
        ) : null}
      </div>
      {hint ? <span className="text-xs text-ink-faint">{hint}</span> : null}
    </div>
  );
}

const BADGE_TONES = {
  win: "bg-win/12 text-win ring-win/25",
  loss: "bg-loss/12 text-loss ring-loss/25",
  draw: "bg-draw/12 text-draw ring-draw/25",
  pending: "bg-pending/12 text-pending ring-pending/25",
  accent: "bg-accent/12 text-accent-bright ring-accent/25",
  neutral: "bg-line/60 text-ink-dim ring-line",
  buy: "bg-win/12 text-win ring-win/25",
  sell: "bg-loss/12 text-loss ring-loss/25",
} as const;

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONES;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Maps a result to its badge, so the mapping lives in exactly one place. */
export function ResultBadge({ result }: { result: string }) {
  const tone =
    result === "WIN"
      ? "win"
      : result === "LOSS"
        ? "loss"
        : result === "DRAW"
          ? "draw"
          : "pending";

  return <Badge tone={tone}>{result}</Badge>;
}

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div
        aria-hidden
        className="grid h-11 w-11 place-items-center rounded-full border border-line bg-panel-2 text-ink-faint"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 17.5 9 11l4 4 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="max-w-md text-xs leading-relaxed text-ink-faint">{detail}</p>
      {action}
    </div>
  );
}

/**
 * Horizontal proportion bar used in the ranking lists.
 * `value` is 0..1; the track is always drawn so rows stay aligned at 0.
 */
export function Meter({
  value,
  tone = "accent",
}: {
  value: number;
  tone?: "accent" | "good" | "bad";
}) {
  const width = `${Math.max(0, Math.min(1, value)) * 100}%`;

  const fill = {
    accent: "bg-accent",
    good: "bg-win",
    bad: "bg-loss",
  }[tone];

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line-soft">
      <div className={clsx("h-full rounded-full", fill)} style={{ width }} />
    </div>
  );
}

export function Disclaimer({ className }: { className?: string }) {
  return (
    <p className={clsx("text-[11px] leading-relaxed text-ink-faint", className)}>
      Every figure here is computed from data you imported. This is analysis of
      past results, not financial advice, and not a prediction of what any signal
      will do next.
    </p>
  );
}
