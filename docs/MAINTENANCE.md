# Maintenance

## Where to change what

| To change…                                | Edit                                    |
| ----------------------------------------- | --------------------------------------- |
| Sentiment vocabulary or weights           | `src/lib/analysis/lexicon.ts`           |
| How sentiment is scored                   | `src/lib/analysis/sentiment.ts`         |
| Which strategies are detected             | `STRATEGY_PATTERNS` in `lexicon.ts`     |
| Recognised assets / symbol normalisation  | `src/lib/analysis/assets.ts`            |
| Spam rules                                | `SPAM_PATTERNS` in `lexicon.ts`         |
| Statistics and bucketing                  | `src/lib/analysis/performance.ts`       |
| Which findings are produced               | `src/lib/analysis/insights.ts`          |
| Accepted import column names              | `COLUMNS` in `src/lib/parsers/*.ts`     |
| Report layout in any export format        | `src/lib/export/report.ts` (shared model) |
| Colours, spacing, type                    | `@theme` in `src/app/globals.css`       |

---

## Adding a new statistic

1. Add the field to `PerformanceStats` in `src/lib/types.ts`.
2. Compute it in `computeStats` in `src/lib/analysis/performance.ts`. It is a
   pure function — no database access — so it stays directly testable.
3. Surface it: a `StatTile` on the dashboard, a row in
   `buildReportModel`, or both.

Because every exporter renders the same `ReportModel`, adding it to the model
puts it in the CSV, the spreadsheet and the PDF at once.

## Adding a new insight

Add a `push({ … })` call in `generateInsights`. Follow the conventions already
there:

- State the sample size the finding rests on, in the `detail` text.
- Set `confidence` from `sampleConfidence(n)` rather than hardcoding it.
- Only report a difference between groups when it exceeds the combined sampling
  noise of both estimates — there is a worked example in the hour-of-day block.
- Describe what happened. Never predict, never advise.

## Supporting another import format

Add a parser to `src/lib/parsers/`, returning `ParseResult<T>`. The contract is
that it never throws on a bad row: collect the reason, skip the row, keep going.
Then wire it into the `parseSignals` / `parseChat` dispatcher. Note that format
detection parses rather than sniffs the first byte, because a chat transcript
opens with `[` without being JSON.

## Adding a role

Roles are ranked in `RANK` in `src/lib/auth/guard.ts`; higher roles inherit
everything below. Add the value to the `Role` enum in `prisma/schema.prisma` and
to the union in `src/lib/types.ts`, then migrate.

---

## Database

**Change the schema:**

```bash
# edit prisma/schema.prisma
npm run db:migrate -- --name what_changed
```

**Deploy migrations** (no prompts, safe for CI):

```bash
npm run db:deploy
```

**Start over locally:**

```bash
npm run db:reset      # drops, re-migrates, re-seeds
```

Note that the connection URL lives in `prisma.config.ts`, not in
`schema.prisma` — Prisma 7 moved it, and the runtime client gets it through the
pg adapter in `src/lib/prisma.ts`.

### Growth

`signals` and `chat_messages` grow with imports; everything else stays small.
Both are indexed on `(userId, <time>)`, which is what every dashboard query
filters on. Retention is worth adding if imports are frequent:

```sql
DELETE FROM chat_messages WHERE "postedAt" < now() - interval '2 years';
DELETE FROM audit_logs    WHERE "createdAt" < now() - interval '1 year';
```

`insight_reports` accumulates only when `?save=true` is used.

---

## Dependency upkeep

```bash
npm outdated
npm audit
```

Three upgrades need care:

- **Prisma** — 7 removed `url` from the datasource block and requires a driver
  adapter. A future major may move it again; check the release notes before
  bumping.
- **Next.js** — 16 renamed the `middleware` convention to `proxy`. This repo uses
  `src/proxy.ts`.
- **TypeScript** — 7 dropped the compiler API Next reaches for by default;
  `experimental.useTypeScriptCli` in `next.config.ts` handles it. Remove that
  flag only if you also downgrade.

---

## Operational checks

**The app is healthy** if `/login` returns 200 — that is what the container
healthcheck uses.

**Analysis is behaving** if the seeded dataset still reports ~53.6% win rate over
634 settled signals, and `signals.csv` still imports 639 rows with exactly 3
rejections. Those three rejections are intentional fixtures; if they stop being
reported, the importer's error path has regressed.

**Regenerate the samples** with `npm run samples`. It is seeded, so the output is
byte-identical unless the generator changed.

---

## Known limitations

- Sentiment is lexicon-based. It handles negation and intensifiers but not
  sarcasm or extended context, and the vocabulary is English-only.
- Asset detection works from a currency list plus aliases. An unusual symbol will
  pass through as raw uppercase text rather than being normalised.
- Timestamps are treated as UTC throughout. An export in local time will shift
  the hourly and heat-map views.
- Ambiguous `MM/DD` vs `DD/MM` dates resolve day-first.
- The PDF export uses the standard PDF fonts, so characters outside WinAnsi
  (including emoji in a provider name) are folded to ASCII equivalents.
- There is no background job runner; imports are processed in the request.
  An 8 MB file is fine; much larger would want a queue.
