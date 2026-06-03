# Stripe billing — custom SetupIntent + self-owned schedule (CONSOLIDATED IN-APP)

**Status:** BUILT on branch `stripe-billing` (off `main`). Env-gated + dormant
until Stripe keys are set, so it's safe to merge to `main` before going live.
**Remaining:** deploy with real Stripe (test) keys + end-to-end test (needs the
user's Stripe account); see "To go live" below.

## Model
Custom billing with **no Stripe Prices / Products / Subscriptions**. Stripe only
stores the card and runs the charges; **we own the schedule + amount**:
1. **Signup** captures the card without charging — a **SetupIntent**
   (`usage:'off_session'`), confirmed client-side with Stripe Elements.
2. **30-day trial** tracked in our DB (not Stripe).
3. After the trial, charge **off-session** every **30 days** for
   `MONTHLY_PRICE_CENTS` (a single env-driven amount).
4. Webhooks reconcile outcomes.

## Where it lives — DECISION (changed from the original plan)
**Consolidated into the Hoppa app (`company-portal`/`main`), not the marketing
site.** The marketing repo (`company-portal-saas`) stays a static landing page
whose "Start free trial" CTAs link to the app's `/signup`. Rationale (user
choice): one app, one DB (`allebrum-portal-db`), one deploy; no cross-service
contract. The Phase-3 "marketing owns billing" path (`provisioning` webhook,
`subscriptions.ts` marketing client, `HOPPA_MARKETING_CONTRACT.md`) is retired
as the billing path — `subscriptions.ts` now reads local tenant state; the
provisioning webhook stays dormant (only mounts if `PROVISIONING_SECRET` set).

## Data — on the `tenants` table (a workspace IS the billing account)
Migration `0021_custom_stripe_billing` (additive, safe on prod): adds
`stripe_payment_method_id`, `billing_status` (`trialing|active|past_due|canceled`,
null = not billing-managed), `trial_ends_at`, `next_bill_at`, `failed_attempts`,
`last_payment_error` (+ a `next_bill_at` index). `billing_external_id` (already
present) is the Stripe customer id; `billing_exempt` (the internal/self-host
workspace) bypasses gating.

## Flow + key files
- `services/billing.ts` — Stripe client + createStripeCustomer, createSetupIntent
  (off_session), setDefaultPaymentMethod, chargeOffSession (idempotency-keyed),
  constructWebhookEvent; tenant state mutations startTrial / storePaymentMethod /
  markPaid (idempotent — guards double-advance) / markPastDue / markCanceled.
- `routes/billing.ts` (mounted at `/billing`, gate-exempt):
  - `GET  /billing/config` (public) — publishable key, price, trial days.
  - `POST /billing/signup` (public) — Stripe customer + `provisionTenant` +
    startTrial + SetupIntent + owner invite token → `{ clientSecret, inviteUrl }`.
  - `POST /billing/stripe/webhook` (public, `req.rawBody` + `STRIPE_WEBHOOK_SECRET`)
    — `setup_intent.succeeded` (store+default card), `payment_intent.succeeded`
    (markPaid), `payment_intent.payment_failed` (past_due backstop).
  - `GET  /billing/status` + `POST /billing/update-card` + `POST /billing/retry`
    (session) — the in-app billing screen + fix-a-failing-card + immediate charge.
- `services/subscriptions.ts` → `tenantIsActive(tenant)`: exempt + self-host +
  active/trialing pass; **past_due/canceled blocked immediately**.
  `requireActiveSubscription` reads this; seat checks read `tenant.seatLimit`.
- `services/billingJob.ts` + **in-process `node-cron`** in `index.ts` (daily
  02:00, gated on `billingConfigured`): charges tenants past `next_bill_at`
  off-session; paid→active+advance; fail→past_due+retry (next day); after
  `BILLING_MAX_RETRIES`→canceled; SCA(`authentication_required`)→past_due (email
  **stubbed/logged** — TODO real email via the F4 system sender).
- Web: `app/signup/page.tsx` (two-step details→card via Elements),
  `components/billing/StripeCardForm.tsx` (reusable), `AuthGate`
  `SubscriptionRequired` rewired to the update-card + retry flow; `/signup` added
  to public routes. Marketing CTAs → `${appUrl}/signup`.

## Env (apps/api, all optional — dormant when STRIPE_SECRET_KEY unset)
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`,
`MONTHLY_PRICE_CENTS` (e.g. 2999), `BILLING_CURRENCY` (usd), `TRIAL_DAYS` (30),
`BILLING_INTERVAL_DAYS` (30), `BILLING_MAX_RETRIES` (4).

## To go live (needs the user)
1. Stripe account → test keys (`sk_test_…`, `pk_test_…`). Add a webhook endpoint
   → `https://<app>/api/billing/stripe/webhook` for `setup_intent.succeeded`,
   `payment_intent.succeeded`, `payment_intent.payment_failed`; copy its signing
   secret → `STRIPE_WEBHOOK_SECRET`.
2. Set the env vars (above) as SECRETs on the `allebrum-portal` DO app.
3. Merge `stripe-billing` → `main` (auto-deploys; runs migration 0021).
4. Test: `/signup` with `4242 4242 4242 4242` (success), `4000 0025 0000 3155`
   (SCA-required), `4000 0000 0000 0002` (decline). Force the daily job /
   `/billing/retry` to exercise charges.

## Deferred / known limitations
- SCA "confirm your payment" email is stubbed (logged) — wire via system sender.
- In-process cron runs on the single instance (fine at instance_count:1).
- No seat metering by default (flat price); `tenant.seatLimit` still enforced if set.
- `provisioning` webhook + `HOPPA_MARKETING_CONTRACT.md` are vestigial (kept,
  dormant); remove in a later cleanup if desired.
