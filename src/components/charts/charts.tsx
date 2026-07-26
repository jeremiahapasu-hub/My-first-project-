"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AXIS,
  GRID,
  TooltipRow,
  TooltipShell,
  money,
  pct,
  shortDate,
  token,
} from "@/components/charts/theme";
import type { Bucket, HeatCell, SentimentPoint, SeriesPoint } from "@/lib/types";

/**
 * Chart set for the dashboard.
 *
 * Two conventions run through all of them:
 *   - 50% is drawn as a reference line on any win-rate axis, because "better than
 *     a coin flip" is the only threshold that matters for a binary outcome.
 *   - Buckets below a usable sample size are dimmed rather than hidden, so a thin
 *     bar reads as "not much data" instead of vanishing.
 */

const CHART_HEIGHT = 260;

/** Percentage axes need room for "100%"; anything narrower clips the leading 1. */
const PCT_AXIS_WIDTH = 52;

type Point = Record<string, unknown>;

function isThin(settled: number) {
  return settled < 8;
}

/** Equity curve — cumulative P/L over time. */
export function PnlChart({ data }: { data: SeriesPoint[] }) {
  const accent = token("--color-accent-bright");
  const loss = token("--color-loss");
  const ending = data.at(-1)?.cumulativePnl ?? 0;
  const stroke = ending >= 0 ? accent : loss;

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid {...GRID} />
        <XAxis dataKey="date" {...AXIS} tickFormatter={shortDate} minTickGap={28} />
        <YAxis {...AXIS} width={56} />
        <ReferenceLine y={0} stroke={token("--color-line")} strokeWidth={1} />

        <Tooltip
          cursor={{ stroke: token("--color-line"), strokeWidth: 1 }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0].payload as SeriesPoint;

            return (
              <TooltipShell label={String(label)}>
                <TooltipRow name="Cumulative" value={money(point.cumulativePnl)} color={stroke} />
                <TooltipRow name="That day" value={money(point.pnl)} />
                <TooltipRow name="Signals" value={String(point.count)} />
              </TooltipShell>
            );
          }}
        />

        <Area
          type="monotone"
          dataKey="cumulativePnl"
          stroke={stroke}
          strokeWidth={2}
          fill="url(#pnlFill)"
          // Individual dots turn an 85-point series into noise.
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Win rate and accuracy over time, against the 50% line. */
export function WinRateChart({ data }: { data: SeriesPoint[] }) {
  const accent = token("--color-accent-bright");
  const dim = token("--color-ink-dim");

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="date" {...AXIS} tickFormatter={shortDate} minTickGap={28} />
        {/* Wide enough for "100%" — a narrower axis silently clips it to "00%". */}
        <YAxis
          {...AXIS}
          width={PCT_AXIS_WIDTH}
          domain={[0, 1]}
          tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
        />

        <ReferenceLine
          y={0.5}
          stroke={token("--color-pending")}
          strokeDasharray="4 4"
          strokeOpacity={0.55}
          label={{
            value: "coin flip",
            position: "insideTopRight",
            fill: token("--color-ink-faint"),
            fontSize: 10,
          }}
        />

        <Tooltip
          cursor={{ stroke: token("--color-line"), strokeWidth: 1 }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0].payload as SeriesPoint;

            return (
              <TooltipShell label={String(label)}>
                <TooltipRow name="Win rate" value={pct(point.winRate)} color={accent} />
                <TooltipRow name="Accuracy" value={pct(point.accuracy)} color={dim} />
                <TooltipRow name="Signals" value={String(point.count)} />
              </TooltipShell>
            );
          }}
        />

        <Line
          type="monotone"
          dataKey="winRate"
          stroke={accent}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
        <Line
          type="monotone"
          dataKey="accuracy"
          stroke={dim}
          strokeWidth={1.25}
          strokeDasharray="3 3"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Signals per day. */
export function FrequencyChart({
  data,
}: {
  data: { date: string; count: number }[];
}) {
  const accent = token("--color-accent");

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="date" {...AXIS} tickFormatter={shortDate} minTickGap={28} />
        <YAxis {...AXIS} width={40} allowDecimals={false} />

        <Tooltip
          cursor={{ fill: token("--color-line"), fillOpacity: 0.35 }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;

            return (
              <TooltipShell label={String(label)}>
                <TooltipRow
                  name="Signals"
                  value={String((payload[0].payload as Point).count)}
                  color={accent}
                />
              </TooltipShell>
            );
          }}
        />

        <Bar dataKey="count" fill={accent} radius={[2, 2, 0, 0]} maxBarSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Win rate per bucket, as horizontal bars.
 * Used for assets and providers, where labels are too long to sit on an X axis.
 */
export function BucketBarChart({
  data,
  height = 300,
  labelWidth = 118,
}: {
  data: Bucket[];
  height?: number;
  /** Widen for long category names — provider names run much longer than symbols. */
  labelWidth?: number;
}) {
  const win = token("--color-win");
  const loss = token("--color-loss");
  const draw = token("--color-draw");

  const sorted = [...data].sort((a, b) => b.winRate - a.winRate);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={sorted}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
      >
        <CartesianGrid {...GRID} vertical horizontal={false} />
        <XAxis
          type="number"
          domain={[0, 1]}
          {...AXIS}
          tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
        />
        <YAxis
          type="category"
          dataKey="label"
          {...AXIS}
          width={labelWidth}
          // Recharts wraps a label that overflows its axis, which collides with
          // the neighbouring rows. Truncating keeps one label to one line.
          tickFormatter={(value: string) =>
            value.length > labelWidth / 6.4
              ? `${value.slice(0, Math.floor(labelWidth / 6.4) - 1)}…`
              : value
          }
        />

        <ReferenceLine
          x={0.5}
          stroke={token("--color-pending")}
          strokeDasharray="4 4"
          strokeOpacity={0.5}
        />

        <Tooltip
          cursor={{ fill: token("--color-line"), fillOpacity: 0.3 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const bucket = payload[0].payload as Bucket;

            return (
              <TooltipShell label={bucket.label}>
                <TooltipRow name="Win rate" value={pct(bucket.winRate)} />
                <TooltipRow name="Settled" value={String(bucket.settled)} />
                <TooltipRow name="Net P/L" value={money(bucket.netPnl)} />
                {isThin(bucket.settled) ? (
                  <p className="pt-1 text-[10px] text-pending">
                    Small sample — treat with caution
                  </p>
                ) : null}
              </TooltipShell>
            );
          }}
        />

        <Bar dataKey="winRate" radius={[0, 3, 3, 0]} maxBarSize={18}>
          {sorted.map((bucket) => (
            <Cell
              key={bucket.key}
              fill={bucket.winRate >= 0.5 ? win : bucket.winRate > 0 ? loss : draw}
              // Thin samples are drawn faded rather than dropped.
              fillOpacity={isThin(bucket.settled) ? 0.32 : 1}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Win rate by hour of day, with volume encoded as opacity. */
export function HourlyChart({ data }: { data: Bucket[] }) {
  const win = token("--color-win");
  const loss = token("--color-loss");
  const maxVolume = Math.max(1, ...data.map((bucket) => bucket.total));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" {...AXIS} interval={1} />
        <YAxis
          {...AXIS}
          width={PCT_AXIS_WIDTH}
          domain={[0, 1]}
          tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
        />

        <ReferenceLine
          y={0.5}
          stroke={token("--color-pending")}
          strokeDasharray="4 4"
          strokeOpacity={0.5}
        />

        <Tooltip
          cursor={{ fill: token("--color-line"), fillOpacity: 0.3 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const bucket = payload[0].payload as Bucket;

            return (
              <TooltipShell label={`${bucket.label} UTC`}>
                <TooltipRow name="Win rate" value={pct(bucket.winRate)} />
                <TooltipRow name="Signals" value={String(bucket.total)} />
                <TooltipRow name="Net P/L" value={money(bucket.netPnl)} />
              </TooltipShell>
            );
          }}
        />

        <Bar dataKey="winRate" radius={[2, 2, 0, 0]} maxBarSize={22}>
          {data.map((bucket) => (
            <Cell
              key={bucket.key}
              fill={bucket.winRate >= 0.5 ? win : loss}
              fillOpacity={0.35 + 0.65 * (bucket.total / maxVolume)}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Daily message counts by sentiment, stacked. */
export function SentimentChart({ data }: { data: SentimentPoint[] }) {
  const bull = token("--color-win");
  const bear = token("--color-loss");
  const flat = token("--color-draw");

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="date" {...AXIS} tickFormatter={shortDate} minTickGap={28} />
        <YAxis {...AXIS} width={40} allowDecimals={false} />

        <Tooltip
          cursor={{ fill: token("--color-line"), fillOpacity: 0.3 }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0].payload as SentimentPoint;

            return (
              <TooltipShell label={String(label)}>
                <TooltipRow name="Bullish" value={String(point.bullish)} color={bull} />
                <TooltipRow name="Bearish" value={String(point.bearish)} color={bear} />
                <TooltipRow name="Neutral" value={String(point.neutral)} color={flat} />
                <TooltipRow
                  name="Mean polarity"
                  value={`${point.score >= 0 ? "+" : ""}${point.score.toFixed(3)}`}
                />
              </TooltipShell>
            );
          }}
        />

        <Bar dataKey="bullish" stackId="s" fill={bull} maxBarSize={16} />
        <Bar dataKey="neutral" stackId="s" fill={flat} fillOpacity={0.5} maxBarSize={16} />
        <Bar dataKey="bearish" stackId="s" fill={bear} radius={[2, 2, 0, 0]} maxBarSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Weekday × hour grid, hand-built rather than charted.
 *
 * Colour encodes win rate and opacity encodes volume, so a cell that is bright
 * green because of two lucky trades is visibly faint next to a busy one.
 */
export function Heatmap({ cells }: { cells: HeatCell[] }) {
  const maxCount = Math.max(1, ...cells.map((cell) => cell.count));

  const lookup = new Map(cells.map((cell) => [`${cell.weekday}-${cell.hour}`, cell]));

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px] px-5 pb-5">
        <div className="mb-1.5 flex pl-9">
          {Array.from({ length: 24 }, (_, hour) => (
            <div
              key={hour}
              className="flex-1 text-center text-[9px] text-ink-faint tnum"
            >
              {hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}
            </div>
          ))}
        </div>

        {/* Monday-first ordering: the trading week reads Mon→Sun, not Sun→Sat. */}
        {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
          <div key={weekday} className="mb-1 flex items-center gap-1">
            <div className="w-8 shrink-0 text-[10px] font-medium text-ink-faint">
              {WEEKDAYS[weekday]}
            </div>

            <div className="flex flex-1 gap-[3px]">
              {Array.from({ length: 24 }, (_, hour) => {
                const cell = lookup.get(`${weekday}-${hour}`);
                const count = cell?.count ?? 0;
                const winRate = cell?.winRate ?? 0;

                const intensity = count === 0 ? 0 : 0.2 + 0.8 * (count / maxCount);
                const color = count === 0
                  ? "transparent"
                  : winRate >= 0.5
                    ? `color-mix(in oklab, var(--color-win) ${Math.round(intensity * 100)}%, transparent)`
                    : `color-mix(in oklab, var(--color-loss) ${Math.round(intensity * 100)}%, transparent)`;

                return (
                  <div
                    key={hour}
                    className="h-5 flex-1 rounded-[3px] border border-line-soft transition-transform hover:scale-125 hover:border-ink-dim"
                    style={{ backgroundColor: color }}
                    title={
                      count === 0
                        ? `${WEEKDAYS[weekday]} ${String(hour).padStart(2, "0")}:00 — no signals`
                        : `${WEEKDAYS[weekday]} ${String(hour).padStart(2, "0")}:00 — ${count} signals, ${pct(winRate)} win rate`
                    }
                  />
                );
              })}
            </div>
          </div>
        ))}

        <div className="mt-3 flex items-center gap-4 pl-9 text-[10px] text-ink-faint">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-win" /> above 50%
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-loss" /> below 50%
          </span>
          <span>Opacity shows signal volume. Hours are UTC.</span>
        </div>
      </div>
    </div>
  );
}
