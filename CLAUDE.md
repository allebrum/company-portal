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
- **Self-host / OSS:** no `BILLING_ENFORCED` / `PROVISIONING_SECRET` → single
  default workspace, ungated, no Stripe; `docker compose up` (Dockerfile +
  compose serve the whole app).
- **SaaS:** set `PROVISIONING_SECRET` + `MARKETING_ORIGIN` + `BILLING_ENFORCED`
  → multi-tenant + subscription gating + the identity contract the marketing
  billing service calls (billing itself lives in `company-portal-saas`).

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
- Subscriptions: **billing is split.** The **marketing service**
  (`company-portal-saas`) is the billing engine — it owns Stripe (customer,
  SetupIntent, the off-session recurring-charge cron, the webhook) and the
  subscription STATE, which it writes into the `tenants` billing columns of THIS
  database (it connects directly to the shared `allebrum-portal-db` via `pg`).
  The **portal has NO Stripe** — it keeps the columns + reads `billing_status`
  to gate (`tenantIsActive()` in `services/subscriptions.ts`, on env
  `BILLING_ENFORCED`) and exposes an HMAC identity contract
  (`routes/provisioning.ts`: `/provisioning/account` + `/handoff` +
  `/billing-ref/validate`, shared `PROVISIONING_SECRET`) the marketing service
  calls. Signup runs on the marketing `/signup`; it ends in a single-use
  `/auth/handoff` auto-login. **Trial access requires a card on file.**
  Self-host (`BILLING_ENFORCED` unset) → columns null → ungated, no Stripe.
  `billing_exempt` tenants always pass. See `STRIPE_BILLING_REWORK.md`.

## Reference docs
- `STRIPE_BILLING_REWORK.md` — **BUILT** (current billing design): **billing is
  split** — the marketing service (`company-portal-saas`/`billing-engine`) owns
  Stripe + the recurring-charge cron + the subscription state, writing the
  `tenants` billing columns directly in the shared `allebrum-portal-db`; the
  portal (`company-portal`/`billing-split`) has NO Stripe and only reads those
  columns to gate (`BILLING_ENFORCED`) + exposes the HMAC identity contract
  (`PROVISIONING_SECRET`). SetupIntent (no charge) + 30-day card-required trial +
  recurring charge from env `MONTHLY_PRICE_CENTS`; no Stripe
  Prices/Products/Subscriptions. Inert until env is set, so safe to merge before
  going live. Cross-service contract, key files, and "To go live" (needs the
  user's Stripe account) live there.
