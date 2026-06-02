# Stripe billing rework — custom SetupIntent + self-owned schedule

**Status:** PLANNING / PAUSED. Exploration done; plan drafted; **no code written
yet**. Paused to fix the overall setup first. Open decisions below are
unanswered — confirm them before building.

## Goal (from the user's spec)

Custom billing with **no Stripe Prices / Products / Subscriptions**. Stripe only
stores the card and processes charges; **we own the schedule and amount**.

1. **Signup:** capture the card without charging — a **SetupIntent**
   (`usage:'off_session'`), confirmed client-side with Stripe Elements.
2. **30-day free trial** tracked in **our** DB (not Stripe).
3. After the trial, charge **off-session** on a recurring **30-day** interval.
4. The amount comes from an **env var** (`MONTHLY_PRICE_CENTS`) — a single
   dynamic price, not a Stripe Price ID.

## Where this lives — recommendation (PENDING CONFIRMATION)

**The marketing site (`company-portal-saas`)** owns billing, per the existing
architecture: marketing owns sign-up + card capture + the **subscription source
of truth**; Hoppa only *reads* status and gets *provisioned*. See
`HOPPA_MARKETING_CONTRACT.md`.

The new `billing_status` enum (`trialing|active|past_due|canceled`) maps almost
1:1 onto the `SubscriptionStatus` Hoppa already consumes, and `next_bill_at`
becomes `currentPeriodEnd`. So no contract change is needed — the marketing side
just needs a real backend.

## Exploration findings (2026-06)

### Marketing site — `company-portal-saas`  (local: `../hoppa-marketing`)
- **Express, CommonJS, plain JS**, no build step. `src/server.js` (inline
  routes), `src/env.js` (reads `process.env` directly — **no dotenv**).
- **No database, no ORM, no migrations.** Stateless.
- **No Stripe code** (the Checkout/webhook scaffold was removed at the user's
  request; SDK had been `stripe@^16.8.0`).
- **No signup flow** — static landing page; paid CTAs (`[data-plan]`) just
  scroll to the final CTA. `public/hoppa/hoppa.js` has a dormant
  `startCheckout()` gated on `CFG.checkoutEnabled` (false).
- **No webhook, no cron.**
- **Deploy:** free **static-site** DO App Platform component
  (app `hoppa-marketing`, id `0d666e99-467c-4446-894d-5cf473c91a18`,
  URL https://hoppa-marketing-s7y49.ondigitalocean.app), deploy-on-push from
  `main`.

### Hoppa product app — `company-portal`, branch `hoppa`
- Express + Socket.IO + **TypeScript**, pnpm monorepo (`apps/api`,
  `apps/web`, `packages/shared`). Uses `dotenv`.
- **Postgres + Drizzle**; migrations `apps/api/drizzle/0000–0018`, run at
  startup (`db:migrate && db:init && start`). `drizzle-kit generate` to author.
- **No Stripe SDK** — Hoppa never touches Stripe by design.
  `apps/api/src/services/subscriptions.ts` calls
  `GET {MARKETING_API_URL}/subscriptions/{stripeCustomerId}` →
  `{ status, plan, seats, currentPeriodEnd }`; `isActive = status ∈ {active,
  trialing}`. `requireActiveSubscription` middleware 402s business routes.
  `tenants` table has `billing_external_id` (= Stripe customer id), `plan`,
  `seat_limit`, `status` (cached mirror, refreshed opportunistically).
- **Provisioning:** `POST /api/provisioning/tenant` (HMAC over raw body with
  `PROVISIONING_SECRET`, header `X-Hoppa-Signature`) → `provisionTenant({ name,
  slug, ownerEmail, ownerName, billingExternalId, plan, seatLimit })` →
  `{ tenantId, ownerUserId }`; route returns `{ tenantId, inviteUrl }`.
- **No cron / scheduler anywhere** (only abort/shutdown `setTimeout`s).

## Proposed design (marketing site)

### `accounts` table (new)
`id (uuid)`, `email`, `workspace_name`, `owner_name`,
`stripe_customer_id` (unique — this **is** `billingExternalId`),
`stripe_payment_method_id`,
`billing_status` (`trialing|active|past_due|canceled`),
`trial_ends_at`, `next_bill_at`, `hoppa_tenant_id`,
`failed_attempts (int)`, `last_payment_error (text)`,
`created_at`, `updated_at`.

### Endpoints / flow
1. **`POST /api/signup`** → create Stripe Customer + SetupIntent
   (`usage:'off_session'`); insert account `trialing`,
   `trial_ends_at = next_bill_at = now + TRIAL_DAYS`; **provision the Hoppa
   tenant** via the HMAC webhook (so the trial user gets access immediately);
   return `client_secret`. A `/signup` page (Stripe.js + Elements, vanilla)
   confirms the card. **No charge here.**
2. **`setup_intent.succeeded` webhook** → store `stripe_payment_method_id`, set
   `invoice_settings.default_payment_method` on the customer.
3. **Daily billing job** → select `next_bill_at <= now` and `billing_status ∈
   {trialing(expired), active, past_due}`; off-session `PaymentIntent`
   (`amount: MONTHLY_PRICE_CENTS`, `currency: BILLING_CURRENCY`,
   `customer`, `payment_method`, `off_session:true`, `confirm:true`,
   idempotency key `${accountId}-${YYYY-MM-DD period}`). Success → `active`,
   `next_bill_at += BILLING_INTERVAL_DAYS`. `authentication_required` →
   `past_due` + (stubbed) "confirm your payment" email. Decline/other →
   `past_due`, log, retry cadence.
4. **Webhooks as source of truth**: `payment_intent.succeeded` → `active`;
   `payment_intent.payment_failed` → `past_due`. Signature-verified with
   `STRIPE_WEBHOOK_SECRET` over the **raw** body.
5. **`GET /subscriptions/:stripeCustomerId`** (already in the contract) →
   status derived from `billing_status`; Hoppa's gating just works.
6. **`POST /billing-portal`** (contract §3) — for "no Stripe Subscriptions"
   we may not have a Stripe-hosted portal; TBD whether to build a custom
   "update card" page (another SetupIntent) instead. **Open item.**

### Proposed retry cadence
On decline → `past_due`, `failed_attempts++`, retry **daily**; after **4**
failed attempts → `canceled`. Adjustable.

### Env vars to add (marketing site, document in `.env.example`)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `MONTHLY_PRICE_CENTS` (e.g. `2999`)
- `BILLING_CURRENCY` (e.g. `usd`)
- `TRIAL_DAYS` (default `30`)
- `BILLING_INTERVAL_DAYS` (default `30`)
- `DATABASE_URL` (new — Postgres)
- `HOPPA_API_URL` + `PROVISIONING_SECRET` (provision tenants; must match Hoppa)
- `MARKETING_API_KEY` (Hoppa→marketing bearer for `/subscriptions` reads)
- `PUBLIC_BASE_URL` / `APP_URL` (redirects)
- (add `dotenv` to the marketing site for local dev, matching Hoppa)

## Constraints (from spec)
- Idempotency keys on **all** charge creation.
- Never log full card data or secrets.
- Smallest-currency-unit integers (cents) throughout.
- All Stripe calls server-side; frontend only ever sees the `client_secret`.
- Trial enforced by **our** `next_bill_at`, not Stripe.

## Deliverables (spec)
1. ✅ Exploration summary + plan (this doc).
2. ☐ DB migration.
3. ☐ Signup/SetupIntent endpoint + minimal Elements confirmation snippet.
4. ☐ Webhook handler (`setup_intent.succeeded`, `payment_intent.succeeded`,
   `payment_intent.payment_failed`).
5. ☐ Daily billing job.
6. ☐ Updated `.env.example` + README test section (test cards incl.
   `4000002500003155` SCA-required + a decline card).

## OPEN DECISIONS (confirm before coding)
1. **Where + cost:** marketing site as a paid Node service + DB (off the free
   static tier, ~$5/mo + DB) vs. building in the Hoppa app. *Recommend marketing
   site.*
2. **Database:** a `marketing` DB on the existing **hoppa-db** cluster (no new
   cost) vs. a dedicated small managed Postgres. Either way: `pg`
   (node-postgres) + plain ordered SQL migrations run on boot (lean, matches the
   JS marketing site — avoid Drizzle/TS there).
3. **Job runner:** DO App Platform **Scheduled Job** component (robust,
   isolated) vs. in-process **node-cron** (one component, runs only while the
   web instance is up). Idempotency keys make either safe.
4. **Past-due access:** grace period (keep returning active-like to Hoppa during
   retries, block only on `canceled`) vs. block immediately on `past_due`.

## Other flags
- **Pricing UI mismatch:** the landing page shows 4 tiers, but this model has
  **one** env-driven price. All paid CTAs route to the single-price signup;
  simplify the pricing section later (or treat tiers as marketing-only).
- **Mailer:** the marketing site has no email sender — the "confirm your
  payment" email will be **stubbed** (logged) and flagged. Real provider
  (Resend/Postmark) or calling Hoppa's Gmail mailer is a follow-up.
- **Billing portal:** with no Stripe Subscriptions, the contract's
  `POST /billing-portal` may become a custom "update card" page (new
  SetupIntent) rather than Stripe's hosted portal.
