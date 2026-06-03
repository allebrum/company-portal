# Allebrum Company Portal

Dashboard (more screenshots below)
![Dashboard](https://public-internal-allebrum.sfo3.cdn.digitaloceanspaces.com/dashboard.jpg)

Internal team-management and time-tracking portal for Allebrum, LLC. Static Next.js frontend, Express + Socket.IO backend, PostgreSQL via Drizzle, Redis for sessions + pub/sub.

## Stack

- **Frontend** — Next.js (App Router, fully static export), Tailwind, TypeScript, TanStack Query, Socket.IO client.
- **Backend** — Express + Socket.IO (same HTTP server), `@socket.io/redis-adapter` for horizontal scaling.
- **DB** — PostgreSQL via Drizzle ORM and the `postgres` driver.
- **Cache / session / pub-sub** — Redis via `ioredis` (3 clients: session, pub, sub).
- **Auth** — `express-session` + `connect-redis`, argon2 password hashing. Same session middleware powers Socket.IO handshake.
- **Workspace** — pnpm with `apps/web`, `apps/api`, `packages/shared`.

## Quickstart

```pwsh
# 1. Provision local services
docker compose up -d

# 2. Install deps
pnpm install
 * if it doesn't install use `npm install -g pnpm`

# 3. Configure env
copy .env.example .env
# Generate a fresh SESSION_SECRET (PowerShell):
# [Convert]::ToHexString((New-Object byte[] 32 | % { (New-Object Random).NextBytes($_); $_ })) | Out-Null
# or just use: SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# 4. Migrate + seed
pnpm db:push
pnpm db:seed
# Watch the console — it prints the default password for all seeded users.

# 5. Run
pnpm dev
# API on :8080, Web on :3000

# 6. Open
# http://localhost:3000
```

## Self-hosting (one command)

Hoppa ships as a single container that bundles the web UI + API and runs
database migrations on startup. The included `docker-compose.yml` brings up
Postgres + Redis alongside it:

```bash
cp .env.example .env
# Set SESSION_SECRET (openssl rand -hex 32), ADMIN_EMAIL, ADMIN_PASSWORD.
docker compose up --build
# → http://localhost:8080  (log in with ADMIN_EMAIL / ADMIN_PASSWORD)
```

The app applies all migrations, seeds the default workspace + your admin user,
and serves the whole product (API + UI) on **one origin** at
`http://localhost:8080` — no CORS or cookie-domain setup.

- **Bring your own infra:** point `DATABASE_URL` / `REDIS_URL` at your managed
  Postgres + Redis and run the image directly. All config is via environment
  variables — see [`.env.example`](.env.example) and `apps/api/src/env.ts`.
- **Optional integrations** (Google sign-in, Drive, Gmail, passkeys, analytics)
  stay dormant until you set their env vars; the core app works without them.
- **SaaS / multi-tenant mode is opt-in:** setting `MARKETING_API_URL` +
  `MARKETING_API_KEY` + `PROVISIONING_SECRET` turns on subscription gating and
  the provisioning webhook (see `HOPPA_MARKETING_CONTRACT.md`). Leave them unset
  to run as a single self-hosted workspace.

Default seed users (password printed on `db:seed`):

| Email | Role |
|---|---|
| senica@allebrum.com | Owner |
| marcus@allebrum.com | Member |
| priya@allebrum.com | Member |
| jordan@allebrum.com | Member |
| avery@allebrum.com | Member |
| sam@allebrum.com | Member |

## Project layout

```
apps/web        Next.js static-export frontend
apps/api        Express + Socket.IO backend
packages/shared Zod schemas + enum constants used by both
```

## Billing (optional SaaS mode)

Hoppa ships an optional custom Stripe billing flow — **no Stripe
Prices/Products/Subscriptions**: a SetupIntent saves the card, we track a
30-day trial ourselves, then charge off-session every 30 days for an env-set
price. It's **dormant unless `STRIPE_SECRET_KEY` is set**, so self-host is
unaffected. To enable, set the `STRIPE_*` / `MONTHLY_PRICE_CENTS` / `TRIAL_DAYS`
vars (see `.env.example`), add a Stripe webhook → `/api/billing/stripe/webhook`
(`setup_intent.succeeded`, `payment_intent.succeeded`,
`payment_intent.payment_failed`), then visit `/signup`.

Test cards (Stripe test mode): `4242 4242 4242 4242` (success),
`4000 0025 0000 3155` (SCA-required), `4000 0000 0000 0002` (decline). Full
detail + the data model live in `STRIPE_BILLING_REWORK.md`.

## Manual end-to-end test

Log in as Senica in one browser window and Marcus in another, then exercise the live update flow: have Marcus start a timer / log time, submit it, and watch it appear in Senica's Approvals tab in real time. Approve it and confirm Marcus's view updates without a refresh. Private to-dos created by one user must not appear for another.

## Deploy

`app.spec.yaml` at the repo root defines a DigitalOcean App Platform spec:

- One **service** component (`apps/api`) — Express + Socket.IO.
- One **static_site** component (`apps/web`) — pre-built `out/` directory.
- Managed Postgres + Managed Caching (Valkey/Redis) attached.
- Ingress routes `/api/*` and `/socket.io/*` to the API service; everything else to the static site. Same-origin in prod = no CORS surprises.

# Screenshots

Dashboard
![Dashboard](https://public-internal-allebrum.sfo3.cdn.digitaloceanspaces.com/dashboard.jpg)

Time Tracking
![Time Tracking](https://public-internal-allebrum.sfo3.cdn.digitaloceanspaces.com/time-tracking.jpg)

Approvals
![Approvals](https://public-internal-allebrum.sfo3.cdn.digitaloceanspaces.com/time-approvals.jpg)

Roadmap
![Roadmap](https://public-internal-allebrum.sfo3.cdn.digitaloceanspaces.com/roadmap.jpg)

Reporting
![Reporting](https://public-internal-allebrum.sfo3.cdn.digitaloceanspaces.com/reporting.jpg)


# Boring stuff our lawyers make us put here

## License

This project is free and open-source software licensed under the GNU Affero General Public License v3.0.

You are free to use, study, modify, and redistribute the software under the terms of the AGPLv3.

We also offer a hosted version for teams that do not want to manage their own infrastructure.

## Hosted Version

This repository contains the free, self-hosted version of the platform.

For teams that do not want to install, host, secure, back up, monitor, or maintain their own deployment, we offer a paid hosted version with managed infrastructure, updates, support, backups, and optional enterprise services.

## Trademark

The software code is licensed under the AGPLv3, but the project name, company name, logos, and branding are not licensed for unrestricted commercial use.

You may not use our trademarks, logos, or confusingly similar branding to market a competing hosted service without written permission.