# Installation

## Requirements

| Requirement | Version | Notes                                             |
| ----------- | ------- | ------------------------------------------------- |
| Node.js     | 20+     | 22 LTS recommended                                |
| PostgreSQL  | 16+     | 14 and 15 work; the schema uses no 16-only syntax |
| npm         | 10+     | pnpm and yarn are fine too                        |

---

## 1. Install dependencies

```bash
npm install
```

This also runs `prisma generate`, which writes the typed client into
`node_modules/@prisma/client`.

## 2. Provision a database

**With Docker** (simplest):

```bash
docker compose up -d db
```

That starts PostgreSQL 16 on `localhost:5432` with database `pocket_analytics`,
user `postgres`, password `postgres`, and a named volume so data survives
restarts.

**With a local PostgreSQL install:**

```bash
createdb pocket_analytics
```

**With a hosted provider** (Neon, Supabase, RDS): create a database and copy its
connection string. Append `?sslmode=require` if the provider mandates TLS.

## 3. Configure the environment

```bash
cp .env.example .env
```

Then edit `.env`:

| Variable              | Required | Purpose                                                       |
| --------------------- | -------- | ------------------------------------------------------------- |
| `DATABASE_URL`        | ✅       | PostgreSQL connection string                                   |
| `AUTH_SECRET`         | ✅       | Signs session JWTs. **Minimum 32 characters.**                 |
| `AUTH_SESSION_TTL`    |          | Session lifetime — `7d`, `12h`, `30m`. Default `7d`.           |
| `NEXT_PUBLIC_APP_URL` |          | Public origin. Default `http://localhost:3000`.                |
| `OPENAI_API_KEY`      |          | Enables written summaries. Leave empty to use the local analyser. |
| `OPENAI_MODEL`        |          | Default `gpt-4o-mini`.                                         |
| `SEED_*`              |          | Credentials for the seeded demo accounts.                      |

Generate a secret:

```bash
openssl rand -base64 48
```

`src/lib/env.ts` validates all of this at startup. A missing or too-short
`AUTH_SECRET` fails immediately with a readable message rather than throwing
somewhere inside a request later.

## 4. Create the schema

```bash
npm run db:migrate
```

Applies everything in `prisma/migrations/`. On a fresh database that is the
single `init` migration.

## 5. Load the sample dataset (optional but recommended)

```bash
npm run samples    # writes samples/ — deterministic, fixed seed
npm run db:seed    # creates demo users and imports samples/
```

Seeding creates three accounts:

| Email                  | Password       | Role      |
| ---------------------- | -------------- | --------- |
| `admin@example.com`    | `admin12345`   | `ADMIN`   |
| `analyst@example.com`  | `analyst12345` | `ANALYST` |
| `viewer@example.com`   | `viewer12345`  | `VIEWER`  |

Only the analyst account gets data. The seed is re-runnable — it clears that
account's rows before re-importing.

**Change these passwords before exposing the app to a network.** Better still,
skip seeding in production entirely: the first account to register through
`/register` is automatically made `ADMIN`, so no default credentials need to
exist at all.

## 6. Run

```bash
npm run dev          # development, http://localhost:3000
```

```bash
npm run build        # production build
npm start
```

---

## Verifying the install

```bash
npm run typecheck    # should print nothing
```

Then sign in and confirm the dashboard shows ~639 signals and a 53.6% win rate.
If the sample data loaded correctly, the **Import** page's history table will
show `signals.csv` with 639 imported and 3 rejected — those three rejections are
intentional and demonstrate the importer's error reporting.

---

## Troubleshooting

**`Invalid environment configuration: AUTH_SECRET must be at least 32 characters`**
Generate a real secret with `openssl rand -base64 48`.

**`Can't reach database server at localhost:5432`**
PostgreSQL isn't running, or `DATABASE_URL` points elsewhere. With Docker:
`docker compose ps` then `docker compose up -d db`.

**`The datasource property 'url' is no longer supported in schema files`**
You are on Prisma 7, which moved the connection URL out of `schema.prisma` into
`prisma.config.ts`. This repo is already set up that way — the error means
`prisma.config.ts` is missing or your CLI isn't finding it.

**`TypeScript 7.x does not provide the compiler API required by Next.js`**
Handled by `experimental.useTypeScriptCli: true` in `next.config.ts`. If you
removed it, either put it back or downgrade to TypeScript 6.

**Charts render blank**
Recharts needs a measurable parent. If you have wrapped a chart in a new
container, make sure it has a real width — a `display: none` or zero-width
ancestor produces an empty SVG.

**Import says "0 rows found"**
Check the file actually has a header row (CSV) or a recognisable timestamp
format (chat). The parser reports per-row reasons in the import summary; those
messages say exactly which field it could not read.
