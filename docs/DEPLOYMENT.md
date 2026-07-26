# Deployment

## Before you deploy

Non-negotiable:

- [ ] `AUTH_SECRET` is a fresh random value, ≥ 32 chars (`openssl rand -base64 48`)
- [ ] `DATABASE_URL` points at production, with TLS if the provider requires it
- [ ] `NODE_ENV=production` — this is what makes the session cookie `secure`
- [ ] `NEXT_PUBLIC_APP_URL` is the real public origin
- [ ] **Do not run `npm run db:seed`.** It creates accounts with published
      passwords. The first account registered through `/register` is
      automatically `ADMIN`, so no default credentials need to exist.
- [ ] The app is served over HTTPS

Rotating `AUTH_SECRET` invalidates every existing session, which is the intended
behaviour if you suspect one has leaked.

---

## Vercel

The app is a standard Next.js App Router project and deploys as-is.

1. Import the repository in Vercel.
2. Add the environment variables from the checklist above.
3. Deploy.

No build-command configuration is needed: Vercel runs the `vercel-build`
script when one exists, and this repo's runs
`prisma generate && prisma migrate deploy && next build`. `migrate deploy`
applies pending migrations without prompting, so the schema is created on the
first deploy.

(`npm run build` stays migration-free for local and Docker builds, where the
database may not be reachable at build time.)

**Database.** Vercel's runtime is serverless, so use a Postgres provider that
handles pooled connections — Neon, Supabase, or PlanetScale-style poolers. Point
`DATABASE_URL` at the **pooled** connection string; a direct connection will
exhaust the server's connection limit under any real traffic.

**Export timeouts.** `/api/export/[format]` sets `maxDuration = 60`. Hobby-tier
functions cap below that, so large PDF exports may time out. Either upgrade the
plan or lower the PDF row cap in `ROW_LIMIT` in that route.

---

## Docker

```bash
# Build
docker build -t pocket-signal-lab .

# Run against an existing database
docker run -d --name psl \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/pocket_analytics" \
  -e AUTH_SECRET="$(openssl rand -base64 48)" \
  -e NEXT_PUBLIC_APP_URL="https://analytics.example.com" \
  -e NODE_ENV=production \
  pocket-signal-lab
```

The image is a multi-stage build producing Next's standalone output, runs as a
non-root user, and has a healthcheck against `/login`.

### Full stack with compose

```bash
echo "AUTH_SECRET=$(openssl rand -base64 48)" > .env
docker compose --profile app up -d
```

Then apply migrations once the container is up:

```bash
docker compose exec app npx prisma migrate deploy
```

Without `--profile app`, only PostgreSQL starts — which is what you want during
local development with `npm run dev`.

---

## Self-hosted (systemd + nginx)

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
```

`/etc/systemd/system/pocket-signal-lab.service`:

```ini
[Unit]
Description=Pocket Signal Lab
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/srv/pocket-signal-lab
EnvironmentFile=/srv/pocket-signal-lab/.env
ExecStart=/usr/bin/node .next/standalone/server.js
Restart=on-failure
RestartSec=5

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/pocket-signal-lab

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now pocket-signal-lab
```

nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name analytics.example.com;

    ssl_certificate     /etc/letsencrypt/live/analytics.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/analytics.example.com/privkey.pem;

    # Imports are capped at 8 MB in the app; keep nginx from rejecting first.
    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # PDF generation over a large range can be slow.
        proxy_read_timeout 90s;
    }
}

server {
    listen 80;
    server_name analytics.example.com;
    return 301 https://$host$request_uri;
}
```

`X-Forwarded-For` matters — the audit log records it on login attempts.

---

## Migrations on release

Always `migrate deploy`, never `migrate dev`, outside development:

```bash
npx prisma migrate deploy
```

For a zero-downtime release, apply migrations before rolling out new instances,
and keep each migration backwards-compatible with the currently-running version
(add columns before writing to them; drop them a release later).

---

## Backups

```bash
pg_dump "$DATABASE_URL" --format=custom --file=psl-$(date +%F).dump
pg_restore --dbname="$DATABASE_URL" --clean --if-exists psl-2026-07-26.dump
```

Imported rows are the only irreplaceable state — everything else is derived.

---

## After deploying

1. Visit `/register` and create the first account. It becomes `ADMIN`.
2. Confirm the redirect: signed out, `/dashboard` should 307 to
   `/login?next=%2Fdashboard`.
3. Import a small file and confirm the summary reports accepted and rejected
   counts.
4. Pull one export of each format and open them.
5. Check `audit_logs` has the registration and login rows.

---

## Monitoring

- **Liveness:** `GET /login` returns 200 without a database connection, so it
  proves the process is up.
- **Readiness:** any authenticated page exercises the database; failures surface
  as 500s.
- **Logs:** unexpected errors are logged as `[api] unhandled error:` with the
  stack, while clients only ever receive a generic message.
- **Audit trail:** `audit_logs` records logins, failed logins, registrations,
  imports and exports. Repeated `auth.login.failed` rows from one IP is the
  signal worth alerting on.
