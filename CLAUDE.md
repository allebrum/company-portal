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
| `allebrum/company-portal` | `main` (a.k.a. `sedale`) | **prod** `rc.allebrum.com` | `allebrum-portal` (`9522bf4d-…`) |
| `allebrum/company-portal` | `hoppa` | Hoppa SaaS test | `hoppa-portal` (`8ed5d573-…`, https://hoppa-portal-pntj8.ondigitalocean.app) |
| `allebrum/company-portal-saas` | `main` | marketing site | `hoppa-marketing` (`0d666e99-…`, https://hoppa-marketing-s7y49.ondigitalocean.app) — local clone at `../hoppa-marketing` |

DO operator: `doctl` authed as `sedale@allebrum.com` (token never held by Claude).
Managed clusters for Hoppa: `hoppa-db` (Postgres 16), `hoppa-redis` (Valkey).

## Guardrails (hard rules)
- **NEVER merge `hoppa` → `main`/`sedale`.** The prod app watches `main` with
  deploy-on-push; merging would ship Hoppa's multi-tenant migrations to prod
  data. `hoppa` is a permanent divergent branch.
- Never commit secrets; `.env*` are gitignored. doctl token stays out of the repo.
- Never force-push shared branches; make new commits, not amends (on pushed work).
- PostHog key `phc_qyMzoCWnurQANtxirtBKExMc5XWxw4N7eMhCHjjinTfW` is a deliberate
  public client key, not a secret.
- Migrations 0016–0018 (tenant backfill, singleton re-key) run ONLY on Hoppa's
  own DB; they must never reach prod (guaranteed by the never-merge rule).

## Key conventions
- DB: Drizzle schema in `apps/api/src/db/schema.ts`; `drizzle-kit generate` to
  author migrations; they run at container startup (`db:migrate && db:init && start`).
- Multi-tenancy (Hoppa): row-level `tenant_id`, AsyncLocalStorage request
  context (`tenancy/context.ts`), `tenantEq()`/`stampTenant()` helpers
  (`tenancy/scope.ts`). `tenants` + `tenant_members` tables.
- Subscriptions: Hoppa **reads** status from the marketing site
  (`services/subscriptions.ts`); `requireActiveSubscription` gates business
  routes. Marketing site is the billing source of truth.

## Reference docs
- `HOPPA_MARKETING_CONTRACT.md` — the marketing ⇄ Hoppa API contract
  (provisioning webhook, `GET /subscriptions/:id`, `POST /billing-portal`).
- `STRIPE_BILLING_REWORK.md` — **current initiative (PAUSED):** custom Stripe
  billing (SetupIntent + self-owned 30-day trial + off-session recurring charge
  from an env price; no Stripe Prices/Products/Subscriptions). Full exploration,
  data model, flow, env vars, and **open decisions** live there. Resume from
  that doc. Paused to fix the overall setup first.
