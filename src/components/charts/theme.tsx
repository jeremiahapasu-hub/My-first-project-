"use client";

import type { ReactNode } from "react";

/**
 * Shared chart language.
 *
 * Colours are read from the CSS custom properties rather than duplicated as hex
 * literals, so the palette in `globals.css` stays the single source of truth.
 * Recharts needs concrete values at render time, so they are resolved once on the
 * client and cached.
 */

const FALLBACK: Record<string, string> = {
  "--color-accent": "#1e9e8a",
  "--color-accent-bright": "#2dd4a7",
  "--color-win": "#2dd4a7",
  "--color-loss": "#f0556b",
  "--color-draw": "#7c8db5",
  "--color-pending": "#e0a33e",
  "--color-line": "#1f2a3d",
  "--color-ink-dim": "#9aa8c0",
  "--color-ink-faint": "#64748b",
};

let cache: Record<string, string> | null = null;

export function token(name: keyof typeof FALLBACK): string {
  if (typeof window === "undefined") return FALLBACK[name];

  if (!cache) {
    const styles = getComputedStyle(document.documentElement);
    cache = {};

    for (const key of Object.keys(FALLBACK)) {
      cache[key] = styles.getPropertyValue(key).trim() || FALLBACK[key];
    }
  }

  return cache[name] ?? FALLBACK[name];
}

export const AXIS = {
  stroke: "transparent",
  tick: { fill: FALLBACK["--color-ink-faint"], fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

export const GRID = {
  stroke: FALLBACK["--color-line"],
  strokeDasharray: "2 4",
  vertical: false,
} as const;

/** Consistent tooltip chrome for every chart. */
export function TooltipShell({
  label,
  children,
}: {
  label?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-void/95 px-3 py-2 shadow-xl backdrop-blur">
      {label ? (
        <p className="mb-1 text-[11px] font-semibold text-ink-dim">{label}</p>
      ) : null}
      <div className="space-y-0.5 text-xs tnum">{children}</div>
    </div>
  );
}

export function TooltipRow({
  name,
  value,
  color,
}: {
  name: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-ink-faint">
        {color ? (
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: color }}
          />
        ) : null}
        {name}
      </span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}

export const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
export const money = (value: number) =>
  `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;

/** `2026-07-14` → `14 Jul`. Keeps dense axes readable. */
export const shortDate = (iso: string) => {
  const [, month, day] = iso.split("-");
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${Number(day)} ${months[Number(month) - 1] ?? ""}`;
};
