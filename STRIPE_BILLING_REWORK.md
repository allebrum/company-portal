# Stripe billing — portal-owned engine, marketing-site signup BFF, auto-login

**Status:** BUILT. Portal billing engine on branch `stripe-billing` (off `main`);
the signup flow lives on the marketing site (`company-portal-saas`, branch
`main`, commit `c7c2b6f`). Env-gated + dormant until Stripe keys + the shared
secret are set, so it's safe to merge to `main` before going live.
**Remaining:** real Stripe (test) keys + the DO env + an end-to-end test (needs
the user's Stripe account); see "To go live" below.

## Model
Custom billing with **no Stripe Prices / Products / Subscriptions**. Stripe only
stores the card and runs the charges; **the portal owns the schedule + amount**:
1. **Signup** (on the marketing site) collects **email + password**, then a card
   captured without charging — a **SetupIntent** (`usage:'off_session'`),
   confirmed client-side with Stripe Elements.
2. **30-day trial** tracked in the portal DB (not Stripe).
3. After the trial, the portal charges **off-session** every **30 days** for
   `MONTHLY_PRICE_CENTS` via its daily cron (`services/billingJob.ts`).
4. Stripe webhooks reconcile outcomes.

## Where it lives — DECISION (current)
**Split: the marketing site fronts signup; the portal owns billing.**
- **Marketing site** (`company-portal-saas`) is a **stateless BFF** — no DB, no
  Stripe key. It serves the landing page + the `/signup` UI and **proxies** to
  the portal's `/billing` endpoints server-to-server (shared `X-Signup-Key`).
- **Portal** (`company-portal`/`main`) is the **system of record**: its DB holds
  the per-workspace billing state, it owns the Stripe key + customer/SetupIntent
  + the off-session charge cron + the webhook, and it **gates access by reading
  its own `tenant.billingStatus`** (local `tenantIsActive`, no remote call).
- After the card validates, the portal mints a **single-use auto-login handoff**
  and the browser is redirected into the portal — **no second login**.

The earlier "marketing owns billing" path (the HMAC `provisioning` webhook +
remote `MARKETING_API_*` subscription client) is **vestigial** in this model;
those stay dormant unless their env is set. See `HOPPA_MARKETING_CONTRACT.md`.

## Data — on the `tenants` table (a workspace IS the billing account)
Migration `0021_custom_stripe_billing` (additive, safe on prod): adds
`stripe_payment_method_id`, `billing_status` (`trialing|active|past_due|canceled`,
null = not billing-managed), `trial_ends_at`, `next_bill_at`, `failed_attempts`,
`last_payment_error` (+ a `next_bill_at` index). `billing_external_id` (already
present, unique) is the Stripe customer id and the join key the BFF reference is
keyed by; `billing_exempt` (the internal/self-host workspace) bypasses gating.

## Flow + key files

**Browser (marketing `/signup`) → BFF → portal → Stripe; then redirect home.**

- `company-portal-saas` (marketing BFF, no DB / no Stripe key):
  - `src/server.js` — `GET /api/config`, `POST /api/signup/start`,
    `POST /api/signup/complete`, `GET /api/subscriptions/:ref`; each forwards to
    the portal with the `X-Signup-Key` shared secret + an in-memory signup
    rate-limit. Serves `public/signup.html` + `public/hoppa/signup.js` (two-step
    Stripe Elements `confirmSetup`, no charge).
- `company-portal` (portal billing engine), `routes/billing.ts` (mounted at
  `/billing`, gate-exempt; signup endpoints require `X-Signup-Key` when set):
  - `GET  /billing/config` (public) — publishable key, price, trial days.
  - `POST /billing/signup` — Stripe customer + `provisionTenant` + `startTrial` +
    SetupIntent + **set the owner's password (argon2, status=active)**; idempotent
    on retry (reuse an owned billing tenant). Returns
    `{ clientSecret, publishableKey, signupRef, trialEndsAt }`. **No handoff yet.**
  - `POST /billing/complete` — retrieve the SetupIntent, require `succeeded`
    ("validate payment intent"), store the card, mint a single-use `'portal-login'`
    token → `{ handoffUrl }`.
  - `GET  /billing/status-by-ref/:ref` — the BFF's "check the db / validate
    subscription" read.
  - `POST /billing/stripe/webhook` (public, `req.rawBody` + `STRIPE_WEBHOOK_SECRET`)
    — `setup_intent.succeeded` (store+default card), `payment_intent.succeeded`
    (markPaid), `payment_intent.payment_failed` (past_due backstop).
  - `GET /billing/status` + `POST /billing/update-card` + `POST /billing/retry`
    (session) — the in-app fix-a-failing-card flow.
- `routes/auth.ts` → `GET /auth/handoff` — consumes the single-use token, runs the
  2FA gate, establishes a **first-party** portal session → `/dashboard`.
- `auth/tokens.ts` → `'portal-login'` kind + `HANDOFF_TTL_MS` (10 min).
- `services/billing.ts` — Stripe client + customer/SetupIntent/charge/webhook +
  `getSetupIntent` (server-side validation) + tenant state mutations
  (`startTrial`/`storePaymentMethod`/`markPaid`(idempotent)/`markPastDue`/`markCanceled`).
- `services/tenants.ts` → `findOwnedBillingTenant` (retry dedupe) + `getOwnerUserId`.
- `services/subscriptions.ts` → `tenantIsActive(tenant)` reads **local**
  `tenant.billingStatus`: exempt + self-host + active/trialing pass;
  **past_due/canceled blocked immediately**. `requireActiveSubscription` reads this.
- `services/billingJob.ts` + in-process `node-cron` in `index.ts` (daily 02:00,
  gated on `billingConfigured`): off-session recurring charges.
- The portal ships **no `/signup` web page** (it lives on the marketing site).

## Env
**Portal** (`apps/api`, all optional — dormant when `STRIPE_SECRET_KEY` unset):
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`,
`MONTHLY_PRICE_CENTS`, `BILLING_CURRENCY` (usd), `TRIAL_DAYS` (30),
`BILLING_INTERVAL_DAYS` (30), `BILLING_MAX_RETRIES` (4), `SIGNUP_BFF_SECRET`
(shared with the BFF; gates the signup endpoints to it).
**Marketing BFF**: `PORTAL_API_URL` (e.g. `https://rc.allebrum.com/api`),
`SIGNUP_BFF_SECRET` (same value), `APP_URL`/`PORTAL_WEB_ORIGIN`. No DB, no Stripe.

## To go live (needs the user)
1. Stripe account → test keys (`sk_test_…`, `pk_test_…`). Add a webhook endpoint
   → `https://rc.allebrum.com/api/billing/stripe/webhook` for
   `setup_intent.succeeded`, `payment_intent.succeeded`,
   `payment_intent.payment_failed`; copy its signing secret → `STRIPE_WEBHOOK_SECRET`.
2. Pick a `SIGNUP_BFF_SECRET`; set the Stripe env + this secret as SECRETs on the
   `allebrum-portal` DO app. Merge `stripe-billing` → `main` (auto-deploys; runs 0021).
3. Convert the `hoppa-marketing` DO app from a static site to the **service** spec
   (`.do/app.yaml`), set `PORTAL_API_URL` + the same `SIGNUP_BFF_SECRET`, deploy.
4. Test at the marketing `/signup`: `4242 4242 4242 4242` (success →
   trial → auto-login into `/dashboard`), `4000 0025 0000 3155` (SCA),
   `4000 0000 0000 0002` (decline). Force the daily job / `/billing/retry`.
5. Flip Stripe to live + the live webhook secret once verified.

## Deferred / known limitations
- In-process cron + the BFF rate-limiter assume `instance_count:1`.
- Partial-signup / existing-email-collision edge cases: the webhook+signup never
  overwrite an existing active user's password; `provisionTenant` is deduped on
  retry by owned `billing_external_id`. A teammate buying a new workspace logs in
  with their existing credential. (See the plan's Risks.)
- No seat metering by default (flat price); `tenant.seatLimit` still enforced if set.
- The HMAC `provisioning` webhook + `HOPPA_MARKETING_CONTRACT.md` + the remote
  `MARKETING_API_*` client are vestigial (kept, dormant); remove in a later cleanup.
