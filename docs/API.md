# API reference

All endpoints live under `/api`. Every response is JSON except the export
routes, which return files.

## Authentication

Sessions are JWTs stored in an `httpOnly`, `sameSite=lax` cookie named
`psl_session`, signed HS256 with `AUTH_SECRET`. The cookie is set by
`/api/auth/login` and `/api/auth/register` and sent automatically by the browser.

For scripted access, keep a cookie jar:

```bash
curl -c jar.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"analyst@example.com","password":"analyst12345"}'

curl -b jar.txt http://localhost:3000/api/analytics/overview
```

### Errors

| Status | Meaning                                              |
| ------ | ---------------------------------------------------- |
| `400`  | Malformed request                                     |
| `401`  | Not signed in, or bad credentials                     |
| `403`  | Signed in, but the role is insufficient               |
| `422`  | Body failed validation — `details[]` carries per-field messages |
| `500`  | Unexpected server error (details are logged, never returned) |

```json
{ "error": "Human-readable message", "details": null }
```

### Roles

| Role      | Can                                             |
| --------- | ----------------------------------------------- |
| `VIEWER`  | Read everything in their own account            |
| `ANALYST` | Everything above, plus import                   |
| `ADMIN`   | Everything above; created for the first account |

All data is scoped per user. Every query builder takes `userId` as its first
argument, so a query that reads across accounts cannot be constructed.

---

## Shared filter parameters

Accepted by `/api/signals`, `/api/chat/*`, `/api/analytics/*`, `/api/insights`
and `/api/export/*`.

| Parameter     | Type                                  | Applies to |
| ------------- | ------------------------------------- | ---------- |
| `from`        | `YYYY-MM-DD`                          | both       |
| `to`          | `YYYY-MM-DD` (inclusive of that day)  | both       |
| `asset`       | e.g. `EUR/USD`, `EUR/USD OTC`         | both       |
| `provider`    | provider name                         | signals    |
| `result`      | `WIN` \| `LOSS` \| `DRAW` \| `PENDING`| signals    |
| `direction`   | `BUY` \| `SELL`                       | signals    |
| `timeframe`   | expiry length in **seconds**          | signals    |
| `channel`     | channel name                          | chat       |
| `sentiment`   | `BULLISH` \| `BEARISH` \| `NEUTRAL`   | chat       |
| `includeSpam` | `true` to include promotional messages (default excluded) | chat |
| `search`      | case-insensitive substring of the body| chat       |

---

## Auth

### `POST /api/auth/register`

The **first** account created is automatically `ADMIN`; every later one is
`ANALYST`.

```json
{ "email": "you@example.com", "name": "Your Name", "password": "atleast10chars1" }
```

Password rules: minimum 10 characters, at least one letter and one digit.

`201` → `{ "user": { "id", "email", "name", "role" } }`

### `POST /api/auth/login`

```json
{ "email": "analyst@example.com", "password": "analyst12345" }
```

`200` → `{ "user": { … } }` · `401` → `{ "error": "Email or password is incorrect" }`

The same message and comparable timing are returned whether or not the account
exists, so the endpoint cannot be used to enumerate users.

### `POST /api/auth/logout`

`200` → `{ "signedOut": true }`

### `GET /api/auth/me`

`200` → `{ "user": { "id", "email", "name", "role" } }`

---

## Signals

### `GET /api/signals`

Additional parameters: `page` (default 1), `pageSize` (default 50, **max 200**),
`sort` (`entryAt` | `asset` | `result` | `pnl`), `order` (`asc` | `desc`).

```json
{
  "rows": [
    {
      "id": "cms1…",
      "asset": "EUR/USD",
      "direction": "BUY",
      "entryAt": "2026-07-14T09:15:00.000Z",
      "expiresAt": "2026-07-14T09:20:00.000Z",
      "timeframeSec": 300,
      "result": "WIN",
      "stake": 10,
      "payout": 0.82,
      "pnl": 8.2,
      "confidence": 0.71,
      "provider": "AlphaPips Room"
    }
  ],
  "page": 1,
  "pageSize": 50,
  "total": 639,
  "pageCount": 13
}
```

---

## Analytics

### `GET /api/analytics/overview`

Everything the dashboard renders:

| Key                                     | Contents                                              |
| --------------------------------------- | ----------------------------------------------------- |
| `stats`                                 | Totals, `winRate`, `accuracy`, `netPnl`, `profitFactor`, streaks |
| `series`                                | Daily points with `cumulativePnl` for the equity curve |
| `daily` / `weekly` / `monthly`          | Buckets by period                                      |
| `assets` / `providers` / `hourly` / `timeframes` | Buckets by dimension                          |
| `assetRanking` / `hourRanking` / `providerRanking` | `{ best, worst, excluded }`, minimum sample applied |
| `frequency`                             | `{ date, count }[]`                                    |

Two hit-rate figures are reported because traders mean different things by them:

- `winRate` = `wins / (wins + losses)` — draws excluded.
- `accuracy` = `wins / settled` — draws counted against.

Pending signals are excluded from both.

Rankings apply a minimum sample size (8 settled) and report how many buckets were
excluded, so a 100% win rate over two trades never surfaces as a "best asset".

### `GET /api/analytics/heatmap`

```json
{ "cells": [{ "weekday": 0, "hour": 0, "count": 0, "winRate": 0 }] }
```

All 168 cells are always returned, including empty ones.

---

## Chat

### `GET /api/chat/messages`

Paginated messages with per-message sentiment, detected assets and strategies,
and spam/duplicate flags.

### `GET /api/chat/analysis`

```json
{
  "totals": { "analysed": 1376, "all": 1450, "spam": 74, "duplicates": 121,
              "spamRatio": 0.051, "bullish": 646, "bearish": 503, "neutral": 227 },
  "series": [{ "date": "2026-07-14", "bullish": 8, "bearish": 3, "neutral": 2, "score": 0.11 }],
  "topAssets": [{ "name": "EUR/USD", "count": 286 }],
  "topStrategies": [{ "name": "Moving Average", "count": 299 }],
  "topAuthors": [{ "name": "marcus_fx", "count": 152 }],
  "summary": { "engine": "heuristic", "text": "…" }
}
```

`spam` and `duplicates` count against **all** messages, while sentiment counts
cover only the visible ones — otherwise "20% of this room is promotional" could
never be reported while also excluding it from the tone read.

---

## Insights

### `GET /api/insights`

Add `?save=true` to persist the run to `insight_reports`, so a report can be
re-opened exactly as generated instead of silently recomputed.

```json
{
  "engine": "heuristic",
  "generatedAt": "2026-07-26T01:00:00.000Z",
  "confidenceScore": 0.95,
  "summary": "639 signals in scope, 634 with a recorded outcome. …",
  "insights": [
    {
      "id": "insight-1",
      "kind": "trend",
      "severity": "info",
      "title": "Win rate 53.6% across 634 settled signals",
      "detail": "The 95% confidence interval (±3.9 pts) still straddles 50%…",
      "confidence": 1
    }
  ],
  "riskAssessment": { "level": "moderate", "score": 35, "factors": ["…"] }
}
```

`kind` is one of `trend`, `risk`, `pattern`, `sentiment`, `recommendation`;
`severity` one of `info`, `good`, `warning`, `critical`.

Every figure is computed locally. When `OPENAI_API_KEY` is set, the model is
given the already-computed statistics and asked only to phrase `summary` — it is
explicitly instructed never to invent or recompute a number. `engine` tells you
which path produced the prose. If the call fails or times out, the local summary
is returned instead.

---

## Import

### `POST /api/import`

Requires `ANALYST` or above. Maximum 8 MB.

**JSON body:**

```json
{ "kind": "SIGNALS", "filename": "export.csv", "content": "<file contents>", "channel": "optional" }
```

**Or `multipart/form-data`:** fields `file`, `kind` (`SIGNALS` | `CHAT`), and
optionally `channel`.

```json
{
  "kind": "SIGNALS",
  "batchId": "cms1…",
  "filename": "signals.csv",
  "seen": 642,
  "accepted": 639,
  "rejected": 3,
  "errors": [{ "row": 14, "reason": "Could not read a BUY/SELL direction from \"SIDEWAYS\"" }],
  "duplicates": 0
}
```

A malformed row never fails the file. Each is skipped with a reason, and the
rest import normally. `duplicates` is chat-only and is detected against the
user's whole history, not just the current upload.

**Recognised formats** — see the in-app Import page, or `src/lib/parsers/`.
Column names are matched case-insensitively and ignoring spaces, underscores and
dashes, so `Entry Time`, `entry_time` and `entrytime` all resolve to the same
field.

---

## Export

### `GET /api/export/{format}`

`format` ∈ `csv` | `xlsx` | `pdf`. Accepts every filter parameter, so the
dashboard's current view exports exactly as shown. Add `signalsOnly=true` (CSV
only) for just the signal rows without the report sections.

Row caps: 50,000 for CSV and Excel, 1,500 for PDF. When truncated, the report's
scope block says so.

| Format | Content-Type                                                        |
| ------ | ------------------------------------------------------------------- |
| `csv`  | `text/csv; charset=utf-8` (UTF-8 BOM, for Excel on Windows)          |
| `xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`  |
| `pdf`  | `application/pdf`                                                    |

All three render the same `ReportModel`, so a spreadsheet and a PDF pulled with
identical filters always agree. Text originating from imported data is escaped
against CSV/Excel formula injection in both the CSV and XLSX writers.

---

## Filters

### `GET /api/filters`

Distinct values for the dashboard's dropdowns.

```json
{ "assets": ["EUR/USD"], "providers": ["AlphaPips Room"], "channels": ["signals-general"], "timeframes": [60, 300] }
```
