import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar } from "@/components/layout/FilterBar";
import {
  Badge,
  Disclaimer,
  EmptyState,
  Panel,
  PanelHeader,
  ResultBadge,
  StatTile,
} from "@/components/ui/primitives";
import { formatTimeframe } from "@/lib/analysis/performance";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import { filterOptions, filterSchema, signalSelect, signalWhere } from "@/lib/queries";
import { buildOverview } from "@/lib/services/analytics";

export const metadata: Metadata = { title: "Signals" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const money = (value: number | null) =>
  value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;

const formatUtc = (date: Date) =>
  date.toISOString().replace("T", " ").slice(0, 16);

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireUser();
  const raw = await searchParams;

  const entries = Object.entries(raw)
    .filter(([, value]) => typeof value === "string" && value !== "")
    .map(([key, value]) => [key, value as string]);

  const filters = filterSchema.parse(Object.fromEntries(entries));
  const page = Math.max(1, Number(raw.page ?? 1) || 1);

  const where = signalWhere(session.sub, filters);

  const [total, rows, options, overview] = await Promise.all([
    prisma.signal.count({ where }),
    prisma.signal.findMany({
      where,
      select: signalSelect,
      orderBy: { entryAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    filterOptions(session.sub),
    buildOverview(session.sub, filters),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const { stats } = overview;

  // Preserve every active filter when paging.
  const pageHref = (target: number) => {
    const params = new URLSearchParams(Object.fromEntries(entries));
    params.set("page", String(target));
    return `/signals?${params.toString()}`;
  };

  return (
    <>
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Signals</h1>
        <p className="mt-1 text-sm text-ink-dim">
          Every imported signal, with the outcome recorded in your source data.
        </p>
      </header>

      <FilterBar options={options} />

      {total === 0 ? (
        <Panel>
          <EmptyState
            title="No signals match these filters"
            detail="Try widening the date range or clearing a filter. If you have not imported anything yet, start there."
            action={
              <Link
                href="/import"
                className="mt-1 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-abyss transition hover:bg-accent-bright"
              >
                Import data
              </Link>
            }
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Matching signals" value={total.toLocaleString()} />
            <StatTile
              label="Win rate"
              value={pct(stats.winRate)}
              hint={`${stats.wins}W / ${stats.losses}L`}
              tone={stats.winRate >= 0.5 ? "good" : "bad"}
            />
            <StatTile
              label="Net P/L"
              value={money(stats.netPnl)}
              tone={stats.netPnl >= 0 ? "good" : "bad"}
            />
            <StatTile
              label="Still pending"
              value={String(stats.pending)}
              hint="no outcome recorded"
              tone={stats.pending > 0 ? "warn" : "neutral"}
            />
          </div>

          <Panel>
            <PanelHeader
              title="Signal log"
              subtitle={`Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total.toLocaleString()}, newest first. Times are UTC.`}
            />

            {/* The table scrolls inside its own container so the page body never
                scrolls sideways on a narrow screen. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-xs">
                <thead>
                  <tr className="border-b border-line-soft text-ink-faint">
                    <Th>Entry</Th>
                    <Th>Asset</Th>
                    <Th>Direction</Th>
                    <Th>Expiry</Th>
                    <Th>Result</Th>
                    <Th align="right">Stake</Th>
                    <Th align="right">P/L</Th>
                    <Th align="right">Confidence</Th>
                    <Th>Provider</Th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-line-soft">
                  {rows.map((signal) => (
                    <tr key={signal.id} className="transition hover:bg-panel-2/60">
                      <Td className="whitespace-nowrap font-mono text-[11px] text-ink-dim">
                        {formatUtc(signal.entryAt)}
                      </Td>
                      <Td className="font-medium text-ink">{signal.asset}</Td>
                      <Td>
                        <Badge tone={signal.direction === "BUY" ? "buy" : "sell"}>
                          {signal.direction}
                        </Badge>
                      </Td>
                      <Td className="text-ink-dim">
                        {formatTimeframe(signal.timeframeSec)}
                      </Td>
                      <Td>
                        <ResultBadge result={signal.result} />
                      </Td>
                      <Td align="right" className="tnum text-ink-dim">
                        {signal.stake === null ? "—" : signal.stake.toFixed(2)}
                      </Td>
                      <Td
                        align="right"
                        className={`tnum font-medium ${
                          signal.pnl === null
                            ? "text-ink-faint"
                            : signal.pnl >= 0
                              ? "text-win"
                              : "text-loss"
                        }`}
                      >
                        {money(signal.pnl)}
                      </Td>
                      <Td align="right" className="tnum text-ink-dim">
                        {signal.confidence === null
                          ? "—"
                          : `${Math.round(signal.confidence * 100)}%`}
                      </Td>
                      <Td className="truncate text-ink-dim">
                        {signal.provider?.name ?? "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pageCount > 1 ? (
              <nav
                aria-label="Pagination"
                className="flex items-center justify-between border-t border-line-soft px-5 py-3 text-xs"
              >
                <span className="text-ink-faint">
                  Page {page} of {pageCount}
                </span>

                <div className="flex gap-2">
                  {page > 1 ? (
                    <Link
                      href={pageHref(page - 1)}
                      className="rounded-lg border border-line px-3 py-1.5 text-ink-dim transition hover:border-accent/40 hover:text-accent-bright"
                    >
                      Previous
                    </Link>
                  ) : null}

                  {page < pageCount ? (
                    <Link
                      href={pageHref(page + 1)}
                      className="rounded-lg border border-line px-3 py-1.5 text-ink-dim transition hover:border-accent/40 hover:text-accent-bright"
                    >
                      Next
                    </Link>
                  ) : null}
                </div>
              </nav>
            ) : null}
          </Panel>

          <Disclaimer className="pb-2" />
        </div>
      )}
    </>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
  align = "left",
}: {
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right";
}) {
  return (
    <td
      className={`px-4 py-2.5 ${align === "right" ? "text-right" : ""} ${className}`}
    >
      {children}
    </td>
  );
}
