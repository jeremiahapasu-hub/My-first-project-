import type { Metadata } from "next";
import Link from "next/link";
import {
  BucketBarChart,
  FrequencyChart,
  Heatmap,
  HourlyChart,
  PnlChart,
  WinRateChart,
} from "@/components/charts/charts";
import { FilterBar } from "@/components/layout/FilterBar";
import {
  Disclaimer,
  EmptyState,
  Meter,
  Panel,
  PanelHeader,
  StatTile,
} from "@/components/ui/primitives";
import { requireUser } from "@/lib/auth/guard";
import { filterOptions, filterSchema } from "@/lib/queries";
import { buildHeatmap, buildOverview } from "@/lib/services/analytics";
import type { Bucket } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

// Every figure is derived from user data that can change on any import.
export const dynamic = "force-dynamic";

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const money = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireUser();
  const raw = await searchParams;

  const filters = filterSchema.parse(
    Object.fromEntries(
      Object.entries(raw)
        .filter(([, value]) => typeof value === "string" && value !== "")
        .map(([key, value]) => [key, value as string]),
    ),
  );

  const [overview, heat, options] = await Promise.all([
    buildOverview(session.sub, filters),
    buildHeatmap(session.sub, filters),
    filterOptions(session.sub),
  ]);

  const { stats } = overview;
  const hasData = stats.total > 0;

  return (
    <>
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-dim">
          {hasData
            ? `${stats.total.toLocaleString()} signals in scope, ${stats.settled.toLocaleString()} settled.`
            : "No signals match the current view."}
        </p>
      </header>

      <FilterBar options={options} />

      {!hasData ? (
        <Panel>
          <EmptyState
            title="Nothing to analyse yet"
            detail="Import a signal export to populate this dashboard. CSV, JSON and plain-text formats all work, and the importer tells you exactly which rows it could not read."
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
          {/* Headline figures. Each carries the denominator it was computed on,
              because a bare percentage invites the wrong reading. */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile
              label="Win rate"
              value={pct(stats.winRate)}
              hint={`${stats.wins}W / ${stats.losses}L, draws excluded`}
              tone={stats.winRate >= 0.5 ? "good" : "bad"}
            />
            <StatTile
              label="Accuracy"
              value={pct(stats.accuracy)}
              hint={`over ${stats.settled} settled`}
            />
            <StatTile
              label="Net P/L"
              value={money(stats.netPnl)}
              hint={`avg ${money(stats.avgPnl)} per signal`}
              tone={stats.netPnl >= 0 ? "good" : "bad"}
            />
            <StatTile
              label="Profit factor"
              value={stats.profitFactor === null ? "—" : stats.profitFactor.toFixed(2)}
              hint={
                stats.profitFactor === null
                  ? "no losses recorded"
                  : stats.profitFactor >= 1
                    ? "gains exceed losses"
                    : "losses exceed gains"
              }
              tone={
                stats.profitFactor === null
                  ? "neutral"
                  : stats.profitFactor >= 1
                    ? "good"
                    : "bad"
              }
            />
            <StatTile
              label="Best run"
              value={String(stats.bestStreak)}
              hint="consecutive wins"
              tone="accent"
            />
            <StatTile
              label="Worst run"
              value={String(stats.worstStreak)}
              hint="consecutive losses"
              tone={stats.worstStreak >= 5 ? "warn" : "neutral"}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel>
              <PanelHeader
                title="Cumulative profit & loss"
                subtitle="Running total across the filtered period"
              />
              <div className="px-2 pb-3 pt-4">
                <PnlChart data={overview.series} />
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                title="Win rate & accuracy"
                subtitle="Daily, against the 50% break-even line"
              />
              <div className="px-2 pb-3 pt-4">
                <WinRateChart data={overview.series} />
              </div>
            </Panel>
          </div>

          {/* The chart spans full width and the two rankings sit side by side
              beneath it. Stacking them in a column beside the chart leaves a
              tall band of dead space, because the rankings run roughly twice
              the chart's height. */}
          <Panel>
            <PanelHeader
              title="Performance by asset"
              subtitle="Faded bars have fewer than 8 settled signals"
            />
            <div className="px-2 pb-3 pt-4">
              <BucketBarChart
                data={overview.assets}
                height={Math.max(220, overview.assets.length * 32)}
              />
            </div>
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2">
            <RankPanel
              title="Strongest assets"
              subtitle="Minimum 8 settled signals"
              buckets={overview.assetRanking.best}
              tone="good"
              excluded={overview.assetRanking.excluded}
            />
            <RankPanel
              title="Weakest assets"
              subtitle="Same threshold, worst first"
              buckets={overview.assetRanking.worst}
              tone="bad"
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel>
              <PanelHeader
                title="Performance by hour"
                subtitle="Bar opacity shows how many signals fell in that hour (UTC)"
              />
              <div className="px-2 pb-3 pt-4">
                <HourlyChart data={overview.hourly} />
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                title="Signal frequency"
                subtitle="Signals per day"
              />
              <div className="px-2 pb-3 pt-4">
                <FrequencyChart data={overview.frequency} />
              </div>
            </Panel>
          </div>

          <Panel>
            <PanelHeader
              title="Weekly heat map"
              subtitle="Win rate by weekday and hour — green above 50%, red below"
            />
            <div className="pt-4">
              <Heatmap cells={heat.cells} />
            </div>
          </Panel>

          {overview.providers.length > 1 ? (
            <Panel>
              <PanelHeader
                title="Performance by provider"
                subtitle="Where your signals came from"
              />
              <div className="px-2 pb-3 pt-4">
                <BucketBarChart
                  data={overview.providers}
                  height={Math.max(180, overview.providers.length * 36)}
                  // Provider names are free text and run far longer than symbols.
                  labelWidth={190}
                />
              </div>
            </Panel>
          ) : null}

          <Disclaimer className="pb-2" />
        </div>
      )}
    </>
  );
}

function RankPanel({
  title,
  subtitle,
  buckets,
  tone,
  excluded,
}: {
  title: string;
  subtitle: string;
  buckets: Bucket[];
  tone: "good" | "bad";
  excluded?: number;
}) {
  return (
    <Panel className="flex-1">
      <PanelHeader title={title} subtitle={subtitle} />

      {buckets.length === 0 ? (
        <p className="px-5 py-6 text-xs text-ink-faint">
          No asset has enough settled signals to rank yet.
        </p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {buckets.map((bucket) => (
            <li key={bucket.key} className="px-5 py-3">
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="truncate text-xs font-medium text-ink">
                  {bucket.label}
                </span>
                <span
                  className={`text-xs font-semibold tnum ${
                    bucket.winRate >= 0.5 ? "text-win" : "text-loss"
                  }`}
                >
                  {pct(bucket.winRate)}
                </span>
              </div>

              <Meter value={bucket.winRate} tone={tone} />

              <div className="mt-1.5 flex justify-between text-[11px] text-ink-faint tnum">
                <span>{bucket.settled} settled</span>
                <span className={bucket.netPnl >= 0 ? "text-win/70" : "text-loss/70"}>
                  {money(bucket.netPnl)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {excluded && excluded > 0 ? (
        <p className="border-t border-line-soft px-5 py-2.5 text-[11px] text-ink-faint">
          {excluded} asset{excluded === 1 ? "" : "s"} hidden for having too few
          results to rank fairly.
        </p>
      ) : null}
    </Panel>
  );
}
