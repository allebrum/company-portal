# Billing split — marketing owns Stripe, portal owns identity + the gate

**Status:** BUILT. Portal slim-down on branch `billing-split` (off `main`, off
`stripe-billing`); marketing billing engine on `company-portal-saas` branch
`billing-engine`. Inert until env is set, so safe to merge before going live.
**Remaining:** Stripe (test) keys + the shared secret + attaching the DB +
flipping `BILLING_ENFORCED` (needs the user's Stripe account); see "To go live".

## Who owns what
- **Marketing service** (`company-portal-saas`) — the **billing engine**. Owns
  Stripe (customer, SetupIntent/card capture, the off-session recurring-charge
  cron, the webhook) and the subscription STATE. It connects **directly to the
  shared portal Postgres** (`allebrum-portal-db`) and writes the `tenants`
  billing columns (`pg` + raw SQL — no Drizzle/TS). It serves the `/signup` +
  `/billing` (fix-card) UI.
- **Portal** (`company-portal`) — **identity + the gate**. Owns accounts,
  workspaces, passwords, login, sessions, and the auto-login handoff. Has **no
  Stripe** at all. It keeps the `tenants` billing COLUMNS (+ migration 0021) and
  **reads** `tenant.billing_status` to gate (`tenantIsActive`), and exposes a
  small HMAC identity contract the marketing service calls. Self-host
  (`BILLING_ENFORCED` unset) → columns null → ungated → OSS stays clean.

## Model
No Stripe Prices/Products/Subscriptions. SetupIntent saves the card (no charge);
a self-owned 30-day trial; off-session charge every 30 days for
`MONTHLY_PRICE_CENTS`. **Trial access requires a card on file** — `trialing`
without a stored payment method is gated. Webhooks reconcile.

## Cross-service contract
Shared `PROVISIONING_SECRET` (HMAC-SHA256 over the raw body). Marketing→portal,
server-to-server. The browser only ever does top-level redirects (no CORS).
- **C1 `POST {portal}/provisioning/account`** — `{email,password,workspaceName,
  ownerName?,billingExternalId}` → portal advisory-lock tx creates tenant+owner,
  argon2 password, records the Stripe customer id, marks `trialing` →
  `{tenantId,ownerUserId,billingExternalId,kind}` | `409 account_exists`.
- **C2 `POST {portal}/provisioning/handoff`** — `{tenantId}` → single-use
  `portal-login` token → `{handoffUrl}` (= `WEB_ORIGIN/auth/handoff?token=…`).
- **C3 `POST {portal}/provisioning/billing-ref/validate`** — `{manageRef}` →
  validate the portal-signed fix-card ref → `{tenantId,billingExternalId,billingStatus}`.
- Gate reads the **local DB** — no subscription-read call either direction.

## Flow + key files
**Signup (marketing `/signup` → engine → portal identity → auto-login):**
- `company-portal-saas`: `src/db.js` (pg + the `tenants` billing writers +
  `assertSchema`), `src/billing.js` (Stripe ops + `signSignupRef`/`verifySignupRef`),
  `src/billingJob.js` (cron: `runDailyBilling`+`sweepAbandonedTrials`+`chargeTenantNow`),
  `src/provisioning.js` (HMAC client), `src/server.js`:
  - `GET /api/config`, `POST /api/signup/start` (createCustomer → **C1** → SetupIntent
    → `startTrial`), `POST /api/signup/complete` (validate SetupIntent → store card
    → **C2** → handoff), `POST /api/stripe/webhook` (raw body), daily `node-cron`.
  - Fix-card: `public/billing.html`+`hoppa/billing.js`, `POST /api/billing/validate`
    (**C3** + SetupIntent), `POST /api/billing/save-card` (store card; charge if past_due).
- `company-portal`: `routes/provisioning.ts` (C1/C2/C3, HMAC), `auth/manageRef.ts`
  (portal-signed fix-card ref), `routes/auth.ts` `/auth/handoff`, `auth/tokens.ts`
  `portal-login` kind, `services/tenants.ts` `provisionAccount`,
  `services/subscriptions.ts` `tenantIsActive` (gate on `BILLING_ENFORCED`),
  `routes/billing.ts` = a single session-gated `POST /billing/manage-link`
  (mints the marketing fix-card URL), `AuthGate` `SubscriptionRequired` redirects there.

## Env
- **Marketing**: `DATABASE_URL` (shared cluster), `STRIPE_SECRET_KEY/_WEBHOOK_SECRET/
  _PUBLISHABLE_KEY`, `MONTHLY_PRICE_CENTS`/`BILLING_CURRENCY`/`TRIAL_DAYS`/
  `BILLING_INTERVAL_DAYS`/`BILLING_MAX_RETRIES`, `PROVISIONING_SECRET`,
  `PORTAL_API_URL`, `PORTAL_WEB_ORIGIN`.
- **Portal**: `PROVISIONING_SECRET` (mounts the contract), `MARKETING_ORIGIN`
  (fix-card link), `BILLING_ENFORCED=true` (turns the gate on). **No Stripe.**

## To go live (needs the user)
1. Stripe test keys; add a webhook → `https://<marketing-app>/api/stripe/webhook`
   (`setup_intent.succeeded`, `payment_intent.succeeded`, `payment_intent.payment_failed`).
2. Pick a `PROVISIONING_SECRET`. On the **marketing** DO app: attach the
   `allebrum-portal-db` cluster (`.do/app.yaml` `databases:`), set the Stripe env +
   `PROVISIONING_SECRET` + `PORTAL_API_URL` (test mode). Merge `billing-engine`→`main`.
3. On the **portal** DO app: set `PROVISIONING_SECRET` (same) + `MARKETING_ORIGIN`,
   leave `BILLING_ENFORCED` off. Merge `billing-split`→`main` (keeps migration 0021).
4. E2E test at the marketing `/signup`: `4242…` (trial+card → auto-login),
   `4000 0025 0000 3155` (SCA), `4000…0002` (decline); abandon-card → login → 402 →
   fix-card; force the cron for recurring/past_due/canceled.
5. Flip Stripe live + the live webhook secret + portal `BILLING_ENFORCED=true`.

## Notes / limitations
- Marketing depends on the portal's `tenants` billing columns (cross-service
  contract; `assertSchema` catches drift). Only marketing writes them; portal reads.
- `instance_count:1` (cron + in-memory rate-limiter). Self-host = no marketing
  service → no billing, columns null, ungated.
- Deferred (recommended pre-public-launch): bot protection (Turnstile) on signup;
  email verification; tighter CSP.
