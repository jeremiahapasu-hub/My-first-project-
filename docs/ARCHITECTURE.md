# Architecture

## Shape of the app

One Next.js application serves both tiers. Route handlers under `src/app/api`
are the Node backend; server components render the pages. Both call the same
service modules, so a number shown on a page and the same number pulled from the
API cannot drift apart.

```
Browser
  │
  ├── Server components ──┐
  │                       ├──► src/lib/services ──► src/lib/analysis ──► Prisma ──► PostgreSQL
  └── fetch → /api/… ─────┘                    └──► src/lib/parsers
```

Server components call services directly rather than fetching their own API —
that avoids an HTTP round trip to the same process just to render a page.

---

## Folder layout

```
prisma/
  schema.prisma            Data model
  migrations/              Generated SQL
  seed.ts                  Demo users + sample import (uses the real importer)
prisma.config.ts           Prisma 7 config — connection URL lives here, not in the schema

scripts/
  generate-samples.ts      Deterministic sample-data generator

samples/                   Generated fixtures (committed)

src/
  app/
    (auth)/                Sign-in and registration
      layout.tsx           Split marketing/form layout
      AuthForm.tsx         Client form, shared by both routes
    (app)/                 Authenticated area
      layout.tsx           Verifies the session, renders the shell
      dashboard/           Overview + charts
      signals/             Filterable signal log
      chat/                Sentiment and message browser
      insights/            Findings, risk, recommendations
      import/              Upload UI + format documentation
    api/
      auth/                register · login · logout · me
      signals/             Paginated signal list
      analytics/           overview · heatmap
      chat/                messages · analysis
      insights/            Findings, optionally persisted
      import/              The only write path for signal/chat rows
      export/[format]/     csv · xlsx · pdf
      filters/             Distinct values for the filter bar
    globals.css            Design tokens and base styles
    layout.tsx             Root layout
  components/
    charts/                Recharts wrappers + shared chart language
    layout/                App shell, filter bar
    ui/                    Panel, StatTile, Badge, Meter, EmptyState
  lib/
    analysis/              Pure analysis — no I/O, unit-testable
      lexicon.ts           Trading-specific sentiment vocabulary
      sentiment.ts         Scoring with negation and intensifiers
      assets.ts            Symbol normalisation and detection
      spam.ts              Promotional detection, duplicate hashing
      performance.ts       Win rate, accuracy, buckets, streaks, heat map
      insights.ts          Findings, risk scoring, recommendations
    parsers/               File → typed rows. Never throws on a bad row.
    services/              Composition layer over analysis + Prisma
    export/                report.ts (shared model) → csv · xlsx · pdf
    ai/summarize.ts        Optional OpenAI narration
    auth/                  password · session · guard
    prisma.ts              Client + pg adapter, cached across dev reloads
    queries.ts             Filter parsing and `where` builders
    env.ts                 Validated environment
    types.ts               Shared unions used by both server and client
    http.ts                Error envelope and route wrapper
  proxy.ts                 Edge routing guard (Next 16 `proxy` convention)
```

---

## Data model

```
User ─┬─< Signal >── Provider
      ├─< ChatMessage
      ├─< ImportBatch ──< Signal, ChatMessage
      ├─< InsightReport
      └─< AuditLog
```

Everything hangs off `User`. Rows only ever enter through `ImportBatch`, which is
created from a file the user uploaded or text they pasted — the schema has no
other ingestion path.

**`Signal`** — asset, direction, `entryAt`, `expiresAt`, `timeframeSec`, result,
optional stake/payout/pnl/confidence, and `rawText` retaining the original line
for traceability. Indexed on `(userId, entryAt)`, `(userId, asset)` and
`(userId, result)`, which covers the dashboard's access patterns.

**`ChatMessage`** — content plus everything derived at import time: sentiment
enum and score, detected `assets[]` and `strategies[]`, spam and duplicate flags,
and `contentHash`. Analysis runs once on import rather than on every page view.

**`ImportBatch`** — provenance. Row counts and per-row rejection reasons are kept
so an import can be audited after the fact.

**`InsightReport`** — a frozen snapshot of an analysis run with the filters it
was generated against, so a saved report reopens as it was rather than being
silently recomputed against newer data.

**`AuditLog`** — logins, failed logins, imports, exports, registrations.

---

## How the analysis works

Everything in `src/lib/analysis/` is pure: it takes plain objects and returns
plain objects, with no database or network access. That makes it directly
testable and keeps the statistics independent of how data was fetched.

### Sentiment

A domain lexicon, not a general-purpose one — "call" and "put" are directional
here, "green" and "red" describe candles, and "in the money" is strongly positive
in a trading room and meaningless elsewhere.

Scoring walks the tokens, looks back up to three tokens for a negator or
intensifier, then squashes the raw sum with `x / (x + 4)` rather than dividing by
token count. A long message with one strong term shouldn't be diluted to
neutral, but ten strong terms shouldn't score ten times as extreme either.
Negated terms are flipped *and* damped — "not great" is mildly negative, not
strongly negative.

### Win rate vs. accuracy

Deliberately both, because traders mean different things by "hit rate":

- `winRate = wins / (wins + losses)` — the conventional figure, draws excluded.
- `accuracy = wins / settled` — draws counted against, since a refunded trade
  still means the call didn't land.

Pending signals are in neither. `profitFactor` is `null` rather than `Infinity`
when there are no losses, so the UI can show `—` instead of a number that looks
like a real ratio.

### Sample-size discipline

This runs through the whole analysis layer:

- `rankBuckets` only ranks buckets with at least 8 settled signals and reports
  how many it excluded, so a 100% win rate over two trades never appears as a
  "best asset".
- Findings carry a `confidence` derived from `√(n / 200)`.
- The overall win-rate finding computes a 95% confidence interval and states
  plainly whether it clears 50% — over the sample dataset it does not, and the
  app says so.
- Differences between buckets are only reported when the gap exceeds the
  combined sampling noise of both estimates.
- The composite confidence score is capped below 100%: a retrospective read of
  one person's imported rows is never grounds for claiming certainty.
- Charts fade thin buckets rather than hiding them, so a small sample reads as
  "not much data" instead of vanishing.

### The optional AI layer

`src/lib/ai/summarize.ts` is the only place that talks to OpenAI, and it is
never given the raw data — only statistics that have already been computed. The
system prompt forbids inventing or recomputing numbers, giving advice, and
predicting prices. Without a key, or if the call fails or exceeds its 20-second
timeout, the deterministic summary is returned unchanged. `engine` in the
response says which path ran.

---

## Import pipeline

```
file/text → parse* → validate per row → enrich → persist
                          │
                          └─► rejected rows collected with reasons, never thrown
```

Parsers are format-tolerant by design. Header matching ignores case, spaces,
underscores and dots. Dates handle ISO 8601, unix seconds and milliseconds, and
day-first `DD/MM/YYYY` (what these exports use). Timeframes accept `M1`, `5m`,
`300`, `00:05:00` and `30 sec`. Expiry can arrive as an absolute time, a
duration, or both — whichever is missing is derived.

Format dispatch parses rather than sniffs the first byte: a plain-text chat log
opens with `[2026-07-14 09:15] alice: …`, which looks like the start of a JSON
array but is not one.

Duplicate detection normalises a message down to its semantic core — lowercased,
URLs and digits collapsed, punctuation stripped — then hashes it, and compares
against the user's entire history rather than just the current file, so
re-uploading an overlapping export doesn't inflate the counts.

---

## Security

| Concern              | Handling                                                            |
| -------------------- | ------------------------------------------------------------------- |
| Password storage     | bcrypt, cost 12                                                     |
| Sessions             | HS256 JWT in an `httpOnly`, `sameSite=lax` cookie; `secure` in production |
| User enumeration     | Login returns one message and burns comparable time either way       |
| Authorisation        | `requireUser` / `requireRole` in every route; `proxy.ts` is a UX redirect, **not** the security boundary |
| Tenant isolation     | Every query builder takes `userId` first; no cross-account query is constructible |
| Injection            | Parameterised through Prisma; no raw SQL                             |
| CSV/Excel injection  | Values starting `=`, `+`, `-`, `@` are apostrophe-guarded in both writers |
| Upload abuse         | 8 MB cap, checked before the body is read                            |
| Pagination abuse     | `pageSize` capped at 200                                             |
| Error leakage        | Unexpected errors are logged server-side; clients get a generic message |
| Headers              | `nosniff`, `DENY` framing, strict referrer policy, restrictive permissions policy |
| Audit                | Logins, failures, imports and exports recorded                       |

---

## Design system

A single dark treatment, chosen rather than defaulted to: this is a monitoring
surface people keep open for long sessions, and the charts are built around
luminous marks on a dark ground.

The neutrals are not grey — they carry a blue bias (hue ≈ 220) pulling toward the
teal accent, so panels read as one palette rather than as default chrome sitting
behind coloured data. Teal was picked over the usual dashboard blue specifically
so the accent never collides with the semantic win/loss pair, which is reserved
for outcomes and never reused for emphasis.

Tokens live in `@theme` in `globals.css` and are read by the charts through
`components/charts/theme.tsx`, so the palette has one source of truth. Digits are
tabular everywhere, since every figure is read in a column against other figures.

Two conventions run through every chart: 50% is drawn as a reference line on any
win-rate axis, because "better than a coin flip" is the only threshold that
matters for a binary outcome; and thin buckets are faded rather than dropped.
