"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { formatTimeframe } from "@/lib/analysis/performance";

export type FilterOptions = {
  assets: string[];
  providers: string[];
  channels: string[];
  timeframes: number[];
};

/**
 * Filters live in the URL rather than component state, so a filtered view is
 * shareable, survives a refresh, and can be handed straight to the export
 * endpoints as a query string.
 */
export function FilterBar({
  options,
  showSignalFilters = true,
  showChatFilters = false,
}: {
  options: FilterOptions;
  showSignalFilters?: boolean;
  showChatFilters?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const current = useMemo(
    () => Object.fromEntries(searchParams.entries()),
    [searchParams],
  );

  const activeCount = Object.keys(current).filter(
    (key) => key !== "page" && current[key],
  ).length;

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());

    if (value) params.set(key, value);
    else params.delete(key);

    // Any filter change invalidates the current page offset.
    params.delete("page");

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  function reset() {
    startTransition(() => router.push(pathname, { scroll: false }));
  }

  const exportQuery = searchParams.toString();

  return (
    <div className="panel mb-5">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-xs font-medium text-ink-dim transition hover:text-ink sm:hidden"
        >
          Filters
          {activeCount > 0 ? (
            <span className="rounded bg-accent/20 px-1.5 text-[10px] text-accent-bright">
              {activeCount}
            </span>
          ) : null}
        </button>

        <div
          className={`${open ? "flex" : "hidden"} w-full flex-wrap items-end gap-2 sm:flex sm:w-auto`}
        >
          <DateField
            label="From"
            value={current.from ?? ""}
            onChange={(value) => update("from", value)}
          />
          <DateField
            label="To"
            value={current.to ?? ""}
            onChange={(value) => update("to", value)}
          />

          <SelectField
            label="Asset"
            value={current.asset ?? ""}
            onChange={(value) => update("asset", value)}
            options={options.assets.map((asset) => ({ value: asset, label: asset }))}
          />

          {showSignalFilters ? (
            <>
              <SelectField
                label="Provider"
                value={current.provider ?? ""}
                onChange={(value) => update("provider", value)}
                options={options.providers.map((name) => ({
                  value: name,
                  label: name,
                }))}
              />
              <SelectField
                label="Result"
                value={current.result ?? ""}
                onChange={(value) => update("result", value)}
                options={["WIN", "LOSS", "DRAW", "PENDING"].map((value) => ({
                  value,
                  label: value,
                }))}
              />
              <SelectField
                label="Direction"
                value={current.direction ?? ""}
                onChange={(value) => update("direction", value)}
                options={["BUY", "SELL"].map((value) => ({ value, label: value }))}
              />
              <SelectField
                label="Timeframe"
                value={current.timeframe ?? ""}
                onChange={(value) => update("timeframe", value)}
                options={options.timeframes.map((seconds) => ({
                  value: String(seconds),
                  label: formatTimeframe(seconds),
                }))}
              />
            </>
          ) : null}

          {showChatFilters ? (
            <>
              <SelectField
                label="Channel"
                value={current.channel ?? ""}
                onChange={(value) => update("channel", value)}
                options={options.channels.map((name) => ({
                  value: name,
                  label: name,
                }))}
              />
              <SelectField
                label="Sentiment"
                value={current.sentiment ?? ""}
                onChange={(value) => update("sentiment", value)}
                options={["BULLISH", "BEARISH", "NEUTRAL"].map((value) => ({
                  value,
                  label: value,
                }))}
              />
              <label className="flex items-center gap-2 rounded-lg border border-line bg-void px-3 py-2 text-xs text-ink-dim">
                <input
                  type="checkbox"
                  checked={current.includeSpam === "true"}
                  onChange={(event) =>
                    update("includeSpam", event.target.checked ? "true" : "")
                  }
                  className="h-3.5 w-3.5 accent-[#1e9e8a]"
                />
                Include promotional
              </label>
            </>
          ) : null}

          {activeCount > 0 ? (
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-line px-3 py-2 text-xs text-ink-dim transition hover:border-loss/40 hover:text-loss"
            >
              Clear
            </button>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {isPending ? (
            <span className="text-[11px] text-ink-faint">Updating…</span>
          ) : null}
          <ExportMenu query={exportQuery} />
        </div>
      </div>
    </div>
  );
}

function ExportMenu({ query }: { query: string }) {
  const suffix = query ? `?${query}` : "";

  return (
    <div className="flex items-center gap-1 rounded-lg border border-line bg-panel-2 p-1">
      <span className="px-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        Export
      </span>
      {(
        [
          ["csv", "CSV"],
          ["xlsx", "Excel"],
          ["pdf", "PDF"],
        ] as const
      ).map(([format, label]) => (
        <a
          key={format}
          href={`/api/export/${format}${suffix}`}
          // `download` keeps the browser from navigating away from the dashboard.
          download
          className="rounded px-2 py-1 text-[11px] font-medium text-ink-dim transition hover:bg-accent/15 hover:text-accent-bright"
        >
          {label}
        </a>
      ))}
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label-eyebrow">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-line bg-void px-2.5 py-1.5 text-xs text-ink outline-none transition focus:border-accent"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label-eyebrow">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-[7.5rem] rounded-lg border border-line bg-void px-2.5 py-1.5 text-xs text-ink outline-none transition focus:border-accent"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
