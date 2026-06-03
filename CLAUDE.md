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
- Subscriptions: billing is **consolidated in-app** (custom Stripe, no Stripe
  Prices/Subscriptions). Per-workspace billing state lives on the `tenants` row
  (`billing_status`, `trial_ends_at`, `next_bill_at`, …); `tenantIsActive()`
  (`services/subscriptions.ts`) + `requireActiveSubscription` gate business
  routes. Dormant unless `STRIPE_SECRET_KEY` is set (self-host = no billing);
  `billing_exempt` tenants always pass. See `STRIPE_BILLING_REWORK.md`.

## Reference docs
- `HOPPA_MARKETING_CONTRACT.md` — the marketing ⇄ Hoppa API contract
  (provisioning webhook, `GET /subscriptions/:id`, `POST /billing-portal`).
- `STRIPE_BILLING_REWORK.md` — **BUILT** on branch `stripe-billing` (off
  `main`): custom Stripe billing (SetupIntent + self-owned 30-day trial +
  off-session recurring charge from env `MONTHLY_PRICE_CENTS`; no Stripe
  Prices/Products/Subscriptions), **consolidated in-app** (not the marketing
  site). Env-gated + dormant until Stripe keys are set, so safe to merge before
  going live. Data model, flow, key files, and the "To go live" steps (needs the
  user's Stripe account) live there.
