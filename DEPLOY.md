# Fork & Deploy Guide

This guide takes you from a fresh fork to a running deployment on **Supabase +
Netlify**. It assumes you want a single-workspace instance (one team / agency)
like the reference deployment — multi-tenant SaaS mode is possible but out of
scope here.

Everything below uses **placeholders** like `<your-...>` — never commit real
keys. `.env*` is gitignored; keep it that way.

- [What you're deploying](#what-youre-deploying)
- [Prerequisites](#prerequisites)
- [1. Supabase project](#1-supabase-project)
- [2. Local env files](#2-local-env-files)
- [3. Database: migrate + bootstrap](#3-database-migrate--bootstrap)
- [4. Email (Resend)](#4-email-resend)
- [5. Build locally](#5-build-locally)
- [6. Deploy to Netlify](#6-deploy-to-netlify)
- [7. Realtime, Storage & Connect](#7-realtime-storage--connect)
- [8. First login + onboard a client](#8-first-login--onboard-a-client)
- [Environment variable reference](#environment-variable-reference)
- [Gotchas we hit (so you don't)](#gotchas-we-hit-so-you-dont)

## What you're deploying

```
Browser
 ├─ Static Next.js (output:'export')        → Netlify CDN  (apps/web/out)
 ├─ @supabase/supabase-js → Supabase Auth / Realtime / Storage
 └─ fetch /api/*          → Netlify Function (Express via serverless-http)
                              └─ Drizzle → Supabase Postgres
```

- **Staff app** at `/` — login with Supabase Auth.
- **Client portal** at `/portal?slug=<client>` — clients sign in via a magic
  link (stateless HMAC token, not a Supabase user).
- One Express API, run as a single Netlify Function. No Redis, no standalone
  server, no Socket.IO.

## Prerequisites

- **Node ≥ 20** and **pnpm ≥ 9** (`corepack enable` gets you pnpm).
- A **Supabase** account (free tier is fine to start).
- A **Netlify** account.
- A **Resend** account + a **domain you control** (for transactional email).
- Optional: **Composio** and **Zernio** API keys (the client "Connect your apps"
  feature); leave unset to keep it dormant.

```bash
git clone https://github.com/<you>/company-portal
cd company-portal
pnpm install
```

## 1. Supabase project

1. Create a new project (note the **region**). Set a strong **database
   password** — you'll need it for the connection string.
2. From **Project Settings → API**, copy:
   - **Project URL** → `https://<ref>.supabase.co`
   - **anon public** key
   - **service_role** key (server-only secret)
3. From **Project Settings → Database → Connection string**, you need two
   poolers (the *direct* host is IPv6-only and won't work from most CI/serverless):
   - **Session pooler** (port **5432**) — for running migrations.
   - **Transaction pooler** (port **6543**) — for the serverless function at runtime.

   They look like:
   ```
   postgresql://postgres.<ref>:<db-password>@<region>.pooler.supabase.com:5432/postgres?sslmode=require   # migrations
   postgresql://postgres.<ref>:<db-password>@<region>.pooler.supabase.com:6543/postgres?sslmode=require   # runtime
   ```

## 2. Local env files

Two files, both gitignored. Copy `.env.example` to `.env` and fill it in.

**`.env`** (repo root — the API + scripts read this):

```bash
NODE_ENV=development
# Use the SESSION pooler (:5432) here so `db:migrate` / `db:init` work locally.
DATABASE_URL=postgresql://postgres.<ref>:<db-password>@<region>.pooler.supabase.com:5432/postgres?sslmode=require

SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# The origin the deployed app will live on (used to build invite/portal links).
WEB_ORIGIN=https://<your-site>.netlify.app
APP_URL=https://<your-site>.netlify.app

# Secrets — generate with: openssl rand -hex 32
PORTAL_SESSION_SECRET=<random-hex>
SESSION_SECRET=<random-hex>

# First admin (created by db:init). Use a real address you control.
ADMIN_EMAIL=you@yourdomain.com
ADMIN_PASSWORD=<a-strong-password>
ALLOWED_EMAIL_DOMAINS=yourdomain.com

# Email (see step 4)
RESEND_API_KEY=<resend-key>
MAIL_FROM=Your Brand <no-reply@yourdomain.com>
```

**`apps/web/.env.local`** (web build-time, inlined into the static bundle):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
# Empty = same-origin /api (correct for the Netlify deploy).
NEXT_PUBLIC_API_URL=
# Turn on Supabase Realtime for staff.
NEXT_PUBLIC_REALTIME_ENABLED=true
```

## 3. Database: migrate + bootstrap

```bash
# Apply all migrations (uses DATABASE_URL = session pooler :5432).
pnpm db:migrate

# Idempotent bootstrap: permission catalog, system groups, app settings,
# the break-glass admin (ADMIN_EMAIL/ADMIN_PASSWORD), and the `spaces`
# Storage bucket. Safe to re-run.
pnpm db:init
```

`db:init` prints something like
`[init] done — permissions: 17, groups: 4, admin you@yourdomain.com created`.
Your admin can now log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

> ⚠️ **Never run `pnpm db:seed` against a real database** — it's a destructive
> dev fixture that truncates everything and loads demo data.

## 4. Email (Resend)

Transactional email has two tracks:

**A. App email** (client portal invites, ticket + payroll notifications) — sent
by the API via the Resend HTTP API.
1. In Resend, **add and verify your domain** (add the SPF + DKIM DNS records
   Resend gives you). A `*.netlify.app` domain can't be verified — use your own.
2. Create an **API key**.
3. Set `RESEND_API_KEY` and `MAIL_FROM` (on a verified domain). That's it — when
   both are set the app routes mail through Resend; otherwise it logs and no-ops.

**B. Supabase Auth email** (staff invites + password resets) — sent by Supabase
itself, so it's configured **in the Supabase project**, not in app code:
- **Authentication → Emails → SMTP Settings → Enable custom SMTP**:
  - Host `smtp.resend.com`, Port `465`, Username `resend`, Password = a Resend
    API key, Sender = `no-reply@yourdomain.com` / your brand name.
- **Authentication → URL Configuration**: set **Site URL** to your deployed
  origin (`https://<your-site>.netlify.app`) and add it to **Redirect URLs**
  (e.g. `https://<your-site>.netlify.app/**`). Without this, reset/invite links
  point at `localhost`.

  (You can also do both via the Management API:
  `PATCH /v1/projects/<ref>/config/auth` with `smtp_host`, `smtp_port`,
  `smtp_user`, `smtp_pass`, `smtp_admin_email`, `smtp_sender_name`, `site_url`,
  `uri_allow_list`.)

## 5. Build locally

```bash
pnpm typecheck
pnpm build          # builds shared → api → web; outputs apps/web/out + apps/api/dist
pnpm --filter @modernzen/api test
```

## 6. Deploy to Netlify

`netlify.toml` is already configured: build command `pnpm build`, publish
`apps/web/out`, functions in `netlify/functions` (esbuild), and a redirect
`/api/* → /.netlify/functions/api/:splat`.

### Option A — Git-based (recommended)
1. Push your fork to GitHub.
2. In Netlify, **Add new site → Import from Git**, pick the repo. It reads
   `netlify.toml` and builds on every push.
3. Add the environment variables (below) under **Site configuration → Environment
   variables**. Include the server vars **and** the `NEXT_PUBLIC_*` build vars.
4. Trigger a deploy.

### Option B — Manual CLI deploy (battle-tested)
This is what the reference deployment used. Set env vars via the API (the CLI's
interactive "select project" prompt hangs in a pnpm monorepo), then deploy the
pre-built output:

```bash
export NETLIFY_AUTH_TOKEN=<token>
# Set each env var with: netlify api createEnvVars --data '{"accountId":"...","siteId":"...","body":[{"key":"K","scopes":["builds","functions","runtime"],"values":[{"value":"V","context":"all"}]}]}'

pnpm build
# Work around the monorepo prompt by hiding the workspace file during deploy:
mv pnpm-workspace.yaml pnpm-workspace.yaml.bak
netlify deploy --prod --site <site-id> --dir apps/web/out --functions netlify/functions --no-build
mv pnpm-workspace.yaml.bak pnpm-workspace.yaml
```

## 7. Realtime, Storage & Connect

- **Realtime** is already wired. Build with `NEXT_PUBLIC_REALTIME_ENABLED=true`
  (step 2) and make sure migration `0004_realtime_rls` ran (step 3) — it adds the
  RLS policies that let staff subscribe to their private channels. The client
  portal stays refetch-only by design.
- **Storage**: `db:init` creates the public `spaces` bucket. Uploads work with no
  extra setup. Note many Supabase plans cap uploads (~50MB) — the bucket inherits
  the project's global limit. (Files use unguessable capability URLs; hardening to
  a private bucket + signed URLs is a documented follow-up.)
- **Connect** (optional): set `COMPOSIO_API_KEY`, `ZERNIO_API_KEY`, and `APP_URL`
  (the public base used for OAuth callbacks). Leave unset to hide the feature.

## 8. First login + onboard a client

1. Sign in at `https://<your-site>.netlify.app/login` as your `ADMIN_EMAIL`.
2. Create a **client**, then a **project** under it; mark items "shared with
   client" to surface them in the portal.
3. Open the client's **Space → Portal tab**: set a URL **slug** and **Publish**.
4. **Add a contact** (role *primary* if they should manage Connections). This
   issues a 30-day single-use magic link, emailed via Resend — and shown in the
   UI with a **copy** button.
5. The client clicks the link → lands in their portal.

## Environment variable reference

**Server / API** (`.env` locally; Netlify env in prod):

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Session pooler `:5432` for migrations; **transaction pooler `:6543`** for the deployed function. |
| `SUPABASE_URL` | ✅ | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | ✅ | |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Server-only secret (Realtime broadcast, Storage, Auth admin). |
| `PORTAL_SESSION_SECRET` | ✅ | HMAC secret for the client-portal token. |
| `WEB_ORIGIN` | ✅ | Deployed origin; used to build invite/portal links. |
| `APP_URL` | ✅* | Public base for OAuth callbacks (required if using Connect). |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | ✅ (db:init) | First admin. Consumed by `db:init` only. |
| `ALLOWED_EMAIL_DOMAINS` | – | Comma-separated allow-list. |
| `RESEND_API_KEY` / `MAIL_FROM` | – | Both → app email via Resend; else log-only. |
| `MAIL_REPLY_TO` | – | Optional reply-to. |
| `SESSION_SECRET` | – | Billing manage-ref signing + test suite. |
| `COMPOSIO_API_KEY` / `ZERNIO_API_KEY` | – | Connect feature; dormant when unset. |
| `PASSWORD_LOGIN_ENABLED` | – | Set `false` for SSO-only. Default on. |

**Web build-time** (`apps/web/.env.local`; Netlify env in prod — must be present
at *build*):

| Var | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | |
| `NEXT_PUBLIC_API_URL` | – | Empty = same-origin `/api` (correct for Netlify). |
| `NEXT_PUBLIC_REALTIME_ENABLED` | – | `true` to enable Supabase Realtime for staff. |

## Gotchas we hit (so you don't)

- **Direct DB host is IPv6-only.** Use the poolers. Migrations → session pooler
  `:5432`; the serverless function → transaction pooler `:6543`.
- **Netlify CLI hangs in a pnpm monorepo.** `netlify env:*` / `build` / `deploy`
  stop on an interactive "select project" prompt (and with `CI=true` it becomes a
  hard error). Set env vars via `netlify api createEnvVars`, and for a manual CLI
  deploy temporarily rename `pnpm-workspace.yaml` aside (see step 6B). Git-based
  deploys avoid this entirely.
- **`NEXT_PUBLIC_*` vars are baked in at build time** — set them before building.
  Changing them on Netlify requires a rebuild.
- **Bucket file-size limit.** Don't request a per-bucket limit above the project's
  global cap, or bucket creation 413s. `db:init` creates the bucket without an
  explicit limit so it inherits the project default.
- **Supabase `site_url` defaults to `localhost:3000`.** Fix it (step 4B) or your
  password-reset / invite links point at localhost.
- **Realtime needs both halves:** the build flag *and* the `0004` RLS migration.
  Missing either just means no live updates (the app falls back to refetch — no
  errors).

See `MIGRATION.md` for the full re-platform history and `CLAUDE.md` for the
architecture and operational notes.
