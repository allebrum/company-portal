# Project memory — Allebrum portal / Hoppa SaaS

## What this is
A pnpm monorepo: an internal company portal (`rc.allebrum.com`) that was
extended into **Hoppa**, a multi-tenant SaaS, plus a separate marketing site.

- `apps/api` — Express + Socket.IO + Drizzle + Postgres (TypeScript, ESM)
- `apps/web` — Next.js App Router, **static export** (`output: 'export'`)
- `packages/shared` — zod + TS types shared by api/web

## Repos, branches, deploys
| Repo | Branch | Deploys to | DO app |
|---|---|---|---|
| `allebrum/company-portal` | `main` (a.k.a. `sedale`) | **prod** `rc.allebrum.com` — now the unified Hoppa SaaS + OSS codebase | `allebrum-portal` (`9522bf4d-…`) |
| `allebrum/company-portal` | `hoppa` | frozen safety-net / staging (pre-convergence state) | `hoppa-portal` (`8ed5d573-…`, https://hoppa-portal-pntj8.ondigitalocean.app) |
| `allebrum/company-portal-saas` | `main` | marketing site | `hoppa-marketing` (`0d666e99-…`, https://hoppa-marketing-s7y49.ondigitalocean.app) — local clone at `../hoppa-marketing` |

DO operator: `doctl` authed as `sedale@allebrum.com` (token never held by Claude).
Managed clusters for Hoppa: `hoppa-db` (Postgres 16), `hoppa-redis` (Valkey).

## Convergence (current model)
`hoppa` has been **merged into `main`** (deliberately — the old "never merge"
guardrail is retired). `main` is now ONE codebase serving two realities from
config alone:
- **Self-host / OSS:** no `MARKETING_API_*` → single default workspace, no
  billing; `docker compose up` (Dockerfile + compose serve the whole app).
- **SaaS:** set `MARKETING_API_URL` + `MARKETING_API_KEY` + `PROVISIONING_SECRET`
  → multi-tenant + subscription gating + provisioning webhook.

The prod app (`allebrum-portal`, watches `main`) was converted **in place**: on
the convergence deploy, migrations `0017–0019` (hoppa's tenant work, renumbered
above `main`'s `0016_solid_chimera`) + `0020` backfill the existing data into the
default workspace. That workspace is `billing_exempt`, so the internal team is
never gated. `hoppa` is kept as a frozen safety-net / staging branch
(`hoppa-portal` still deploys from it).

## Guardrails (hard rules)
- Never commit secrets; `.env*` are gitignored. doctl token stays out of the repo.
- Never force-push shared branches; make new commits, not amends (on pushed work).
- PostHog key `phc_qyMzoCWnurQANtxirtBKExMc5XWxw4N7eMhCHjjinTfW` is a deliberate
  public client key, not a secret.
- The prod DB is now multi-tenant. Any new migration must be safe on populated
  prod data (idempotent / backfilled), and tenant-owned tables must carry
  `tenant_id` and be scoped via `tenantEq()` / `stampTenant()`.

## Key conventions
- DB: Drizzle schema in `apps/api/src/db/schema.ts`; `drizzle-kit generate` to
  author migrations; they run at container startup (`db:migrate && db:init && start`).
- Multi-tenancy (Hoppa): row-level `tenant_id`, AsyncLocalStorage request
  context (`tenancy/context.ts`), `tenantEq()`/`stampTenant()` helpers
  (`tenancy/scope.ts`). `tenants` + `tenant_members` tables.
- Subscriptions: the **portal owns billing** (custom Stripe, no Stripe
  Prices/Subscriptions) — DB state on the `tenants` row (`billing_status`,
  `trial_ends_at`, `next_bill_at`, …), the Stripe key, the off-session charge
  cron, and the webhook. Gating reads **local** `tenantIsActive()`
  (`services/subscriptions.ts`) + `requireActiveSubscription`. **Signup runs on
  the marketing site** (`company-portal-saas`), a stateless BFF that proxies to
  the portal's `/billing` endpoints (shared `SIGNUP_BFF_SECRET` → `X-Signup-Key`)
  and ends in a single-use `/auth/handoff` auto-login. Dormant unless
  `STRIPE_SECRET_KEY` is set; `billing_exempt` tenants always pass. See
  `STRIPE_BILLING_REWORK.md`.

## Reference docs
- `STRIPE_BILLING_REWORK.md` — **BUILT** (current billing design): portal owns
  the billing engine (DB state + Stripe key + off-session charge cron + webhook +
  **local** subscription gating) on branch `stripe-billing`; **signup runs on the
  marketing site** as a stateless BFF (`company-portal-saas`/`main`) that proxies
  to `/billing/signup` + `/billing/complete` (shared `SIGNUP_BFF_SECRET`) and ends
  in a single-use `/auth/handoff` auto-login. SetupIntent (no charge) + self-owned
  30-day trial + recurring charge from env `MONTHLY_PRICE_CENTS`; no Stripe
  Prices/Products/Subscriptions. Env-gated + dormant until Stripe keys + the
  shared secret are set, so safe to merge before going live. Flow, key files, and
  "To go live" (needs the user's Stripe account) live there.
- `HOPPA_MARKETING_CONTRACT.md` — **VESTIGIAL.** An earlier "marketing owns
  billing" contract (HMAC provisioning webhook, remote `MARKETING_API_*`
  subscription client, `POST /billing-portal`). Superseded by the model above
  (portal owns billing locally; the BFF only drives signup). Kept dormant —
  nothing is wired to it unless `PROVISIONING_SECRET`/`MARKETING_API_*` are set.
