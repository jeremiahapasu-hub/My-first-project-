import clsx from "clsx";
import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar } from "@/components/layout/FilterBar";
import {
  Badge,
  Disclaimer,
  EmptyState,
  Meter,
  Panel,
  PanelHeader,
  StatTile,
} from "@/components/ui/primitives";
import { requireUser } from "@/lib/auth/guard";
import { filterOptions, filterSchema } from "@/lib/queries";
import { buildInsights } from "@/lib/services/analytics";
import type { Insight } from "@/lib/types";

export const metadata: Metadata = { title: "AI insights" };
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<Insight["kind"], string> = {
  trend: "Trend",
  risk: "Risk",
  pattern: "Pattern",
  sentiment: "Sentiment",
  recommendation: "Next step",
};

const SEVERITY_STYLE: Record<
  Insight["severity"],
  { rail: string; badge: "win" | "loss" | "pending" | "neutral" }
> = {
  good: { rail: "bg-win", badge: "win" },
  warning: { rail: "bg-pending", badge: "pending" },
  critical: { rail: "bg-loss", badge: "loss" },
  info: { rail: "bg-line", badge: "neutral" },
};

const RISK_TONE = {
  low: { text: "text-win", label: "Low" },
  moderate: { text: "text-accent-bright", label: "Moderate" },
  elevated: { text: "text-pending", label: "Elevated" },
  high: { text: "text-loss", label: "High" },
} as const;

export default async function InsightsPage({
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

  const [payload, options] = await Promise.all([
    buildInsights(session.sub, filters),
    filterOptions(session.sub),
  ]);

  const risk = RISK_TONE[payload.riskAssessment.level];

  // Recommendations are separated out — they answer a different question from
  // the observations above them.
  const observations = payload.insights.filter(
    (insight) => insight.kind !== "recommendation",
  );
  const recommendations = payload.insights.filter(
    (insight) => insight.kind === "recommendation",
  );

  const hasAnything = payload.insights.length > 0;

  return (
    <>
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">AI insights</h1>
        <p className="mt-1 text-sm text-ink-dim">
          Findings derived from your imported data, each with the sample size
          that backs it.
        </p>
      </header>

      <FilterBar options={options} />

      {!hasAnything ? (
        <Panel>
          <EmptyState
            title="Nothing to report yet"
            detail="Insights are computed from imported signals and chat. Once there is data in scope, this page explains what the numbers actually show."
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
          <div className="grid gap-3 md:grid-cols-3">
            <StatTile
              label="Analysis confidence"
              value={`${Math.round(payload.confidenceScore * 100)}%`}
              hint="based on sample size and how much of it settled"
              tone={payload.confidenceScore >= 0.6 ? "accent" : "warn"}
            />
            <StatTile
              label="Risk level"
              value={risk.label}
              hint={`${payload.riskAssessment.score}/100 composite score`}
              tone={
                payload.riskAssessment.level === "low"
                  ? "good"
                  : payload.riskAssessment.level === "high"
                    ? "bad"
                    : "warn"
              }
            />
            <StatTile
              label="Findings"
              value={String(observations.length)}
              hint={`engine: ${payload.engine}`}
            />
          </div>

          <Panel>
            <PanelHeader
              title="Summary"
              subtitle={
                payload.engine === "heuristic"
                  ? "Written by the built-in analyser. Set OPENAI_API_KEY for prose summaries."
                  : `Written by ${payload.engine} from locally-computed figures`
              }
            />
            <p className="px-5 py-4 text-sm leading-relaxed text-ink-dim">
              {payload.summary}
            </p>
          </Panel>

          <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
            <Panel>
              <PanelHeader
                title="Findings"
                subtitle="Each describes something that already happened in your data"
              />

              <ul className="divide-y divide-line-soft">
                {observations.map((insight) => {
                  const style = SEVERITY_STYLE[insight.severity];

                  return (
                    <li key={insight.id} className="flex gap-3 px-5 py-4">
                      {/* The rail encodes severity, so a scan down the list
                          surfaces the critical items without reading. */}
                      <span
                        aria-hidden
                        className={clsx("mt-0.5 w-0.5 shrink-0 rounded-full", style.rail)}
                      />

                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <Badge tone={style.badge}>{KIND_LABEL[insight.kind]}</Badge>
                          <h3 className="text-sm font-medium text-ink">
                            {insight.title}
                          </h3>
                        </div>

                        <p className="text-xs leading-relaxed text-ink-dim">
                          {insight.detail}
                        </p>

                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[10px] uppercase tracking-wider text-ink-faint">
                            Confidence
                          </span>
                          <div className="w-20">
                            <Meter value={insight.confidence} />
                          </div>
                          <span className="text-[10px] text-ink-faint tnum">
                            {Math.round(insight.confidence * 100)}%
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>

            <div className="flex flex-col gap-5">
              <Panel>
                <PanelHeader
                  title="Risk assessment"
                  subtitle="What makes this data harder to trust"
                />

                <div className="px-5 py-4">
                  <div className="mb-3 flex items-baseline gap-2">
                    <span className={clsx("text-2xl font-semibold", risk.text)}>
                      {risk.label}
                    </span>
                    <span className="text-xs text-ink-faint tnum">
                      {payload.riskAssessment.score}/100
                    </span>
                  </div>

                  <Meter
                    value={payload.riskAssessment.score / 100}
                    tone={payload.riskAssessment.score >= 45 ? "bad" : "accent"}
                  />

                  <ul className="mt-4 space-y-2">
                    {payload.riskAssessment.factors.map((factor) => (
                      <li
                        key={factor}
                        className="flex items-start gap-2 text-xs leading-relaxed text-ink-dim"
                      >
                        <span
                          aria-hidden
                          className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-pending"
                        />
                        {factor}
                      </li>
                    ))}
                  </ul>
                </div>
              </Panel>

              <Panel>
                <PanelHeader
                  title="Suggested next steps"
                  subtitle="About your data, not about trades"
                />

                <ul className="space-y-3 px-5 py-4">
                  {recommendations.map((insight) => (
                    <li
                      key={insight.id}
                      className="flex items-start gap-2 text-xs leading-relaxed text-ink-dim"
                    >
                      <span
                        aria-hidden
                        className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent"
                      />
                      {insight.detail}
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          </div>

          <Panel className="border-pending/25 bg-pending/5">
            <div className="px-5 py-4">
              <h2 className="mb-1.5 text-xs font-semibold text-pending">
                Read this before acting on anything above
              </h2>
              <p className="text-[11px] leading-relaxed text-ink-dim">
                These findings describe the historical rows you imported and
                nothing else. They are not financial advice, not a recommendation
                to place any trade, and not a forecast. A pattern that held over
                past data has no obligation to continue, and every figure inherits
                whatever errors exist in the source export. Binary options carry a
                substantial risk of losing your capital.
              </p>
            </div>
          </Panel>

          <Disclaimer className="pb-2" />
        </div>
      )}
    </>
  );
}
