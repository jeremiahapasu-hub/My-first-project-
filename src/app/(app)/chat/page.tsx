import type { Metadata } from "next";
import Link from "next/link";
import { SentimentChart } from "@/components/charts/charts";
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
import { prisma } from "@/lib/prisma";
import { filterOptions, filterSchema, messageWhere } from "@/lib/queries";
import { buildChatAnalysis } from "@/lib/services/analytics";

export const metadata: Metadata = { title: "Chat analysis" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

export default async function ChatPage({
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

  const where = messageWhere(session.sub, filters);

  const [analysis, options, messages, total] = await Promise.all([
    buildChatAnalysis(session.sub, filters),
    filterOptions(session.sub),
    prisma.chatMessage.findMany({
      where,
      orderBy: { postedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.chatMessage.count({ where }),
  ]);

  const { totals } = analysis;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageHref = (target: number) => {
    const params = new URLSearchParams(Object.fromEntries(entries));
    params.set("page", String(target));
    return `/chat?${params.toString()}`;
  };

  const maxAssetCount = analysis.topAssets[0]?.count ?? 1;
  const maxStrategyCount = analysis.topStrategies[0]?.count ?? 1;

  return (
    <>
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Chat analysis</h1>
        <p className="mt-1 text-sm text-ink-dim">
          Sentiment, assets and strategy talk extracted from imported messages.
        </p>
      </header>

      <FilterBar options={options} showSignalFilters={false} showChatFilters />

      {totals.all === 0 ? (
        <Panel>
          <EmptyState
            title="No messages to analyse"
            detail="Import a chat export — a plain-text log, a CSV, or a Telegram JSON export — and every message gets scored for sentiment, tagged with the assets it mentions, and checked for promotional content."
            action={
              <Link
                href="/import"
                className="mt-1 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-abyss transition hover:bg-accent-bright"
              >
                Import chat
              </Link>
            }
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <StatTile
              label="Messages analysed"
              value={totals.analysed.toLocaleString()}
              hint={`of ${totals.all.toLocaleString()} imported`}
            />
            <StatTile
              label="Bullish"
              value={totals.bullish.toLocaleString()}
              hint={`${((totals.bullish / Math.max(totals.analysed, 1)) * 100).toFixed(0)}% of analysed`}
              tone="good"
            />
            <StatTile
              label="Bearish"
              value={totals.bearish.toLocaleString()}
              hint={`${((totals.bearish / Math.max(totals.analysed, 1)) * 100).toFixed(0)}% of analysed`}
              tone="bad"
            />
            <StatTile
              label="Promotional"
              value={totals.spam.toLocaleString()}
              hint={`${(totals.spamRatio * 100).toFixed(1)}% of the room`}
              tone={totals.spamRatio > 0.2 ? "warn" : "neutral"}
            />
            <StatTile
              label="Duplicates"
              value={totals.duplicates.toLocaleString()}
              hint="repeated message bodies"
            />
          </div>

          <Panel>
            <PanelHeader
              title="Discussion summary"
              subtitle={
                analysis.summary.engine === "heuristic"
                  ? "Generated locally — set OPENAI_API_KEY for a written summary"
                  : `Written by ${analysis.summary.engine}`
              }
            />
            <p className="px-5 py-4 text-sm leading-relaxed text-ink-dim">
              {analysis.summary.text}
            </p>
          </Panel>

          <Panel>
            <PanelHeader
              title="Sentiment over time"
              subtitle="Daily message counts by tone. Promotional messages are excluded unless you include them above."
            />
            <div className="px-2 pb-3 pt-4">
              <SentimentChart data={analysis.series} />
            </div>
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2">
            <TallyPanel
              title="Most-discussed assets"
              subtitle="Detected from message text, not from your signal log"
              rows={analysis.topAssets}
              max={maxAssetCount}
            />
            <TallyPanel
              title="Strategy vocabulary"
              subtitle="Mentions, not trades taken"
              rows={analysis.topStrategies}
              max={maxStrategyCount}
            />
          </div>

          <Panel>
            <PanelHeader
              title="Messages"
              subtitle={`${total.toLocaleString()} matching, newest first. Times are UTC.`}
            />

            <ul className="divide-y divide-line-soft">
              {messages.map((message) => (
                <li key={message.id} className="px-5 py-3.5">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="font-medium text-ink">{message.author}</span>
                    <span className="text-ink-faint">
                      {message.postedAt.toISOString().replace("T", " ").slice(0, 16)}
                    </span>
                    <span className="text-ink-faint">· {message.channel}</span>

                    <Badge
                      tone={
                        message.sentiment === "BULLISH"
                          ? "win"
                          : message.sentiment === "BEARISH"
                            ? "loss"
                            : "draw"
                      }
                    >
                      {message.sentiment} {message.sentimentScore >= 0 ? "+" : ""}
                      {message.sentimentScore.toFixed(2)}
                    </Badge>

                    {message.isSpam ? (
                      <Badge tone="pending">promotional · {message.spamReason}</Badge>
                    ) : null}
                    {message.isDuplicate ? <Badge tone="neutral">duplicate</Badge> : null}
                  </div>

                  <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-dim">
                    {message.content}
                  </p>

                  {message.assets.length > 0 || message.strategies.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {message.assets.map((asset) => (
                        <Badge key={asset} tone="accent">
                          {asset}
                        </Badge>
                      ))}
                      {message.strategies.map((strategy) => (
                        <Badge key={strategy} tone="neutral">
                          {strategy}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

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

function TallyPanel({
  title,
  subtitle,
  rows,
  max,
}: {
  title: string;
  subtitle: string;
  rows: { name: string; count: number }[];
  max: number;
}) {
  return (
    <Panel>
      <PanelHeader title={title} subtitle={subtitle} />

      {rows.length === 0 ? (
        <p className="px-5 py-6 text-xs text-ink-faint">
          Nothing detected in the messages that match these filters.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5 px-5 py-4">
          {rows.map((row) => (
            <li key={row.name}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate text-ink">{row.name}</span>
                <span className="tnum text-ink-faint">{row.count}</span>
              </div>
              <Meter value={row.count / max} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
