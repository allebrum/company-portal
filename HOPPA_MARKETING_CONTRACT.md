# Hoppa ⇄ Marketing site — integration contract

The **Hoppa SaaS app** (this repo, `hoppa` branch) and the **marketing site**
(separate repo, Next.js + Stripe) are independent deployments. The marketing
site owns **sign-up + Stripe billing + the subscription source of truth**;
Hoppa runs the product. This document is the API contract both sides implement.

## Environment

**Hoppa** (`apps/api/src/env.ts`, all optional — unset = self-hosted single
workspace, no billing):

| Var | Purpose |
|---|---|
| `MARKETING_API_URL` | Base URL of the marketing API, e.g. `https://hoppa.app/api` |
| `MARKETING_API_KEY` | Bearer token Hoppa sends on subscription/billing reads |
| `PROVISIONING_SECRET` | HMAC-SHA256 shared secret for the inbound provisioning webhook |

The marketing site needs the inverse: the Hoppa API base URL + the same
`PROVISIONING_SECRET` + its own `MARKETING_API_KEY` value to accept.

## 1. Marketing → Hoppa: provisioning webhook

Fired by the marketing site on Stripe `checkout.session.completed`.

```
POST {HOPPA_API}/api/provisioning/tenant
Headers:
  Content-Type: application/json
  X-Hoppa-Signature: hex( HMAC-SHA256(rawBody, PROVISIONING_SECRET) )
Body:
  {
    "billingExternalId": "cus_…",      // Stripe customer id (stable per workspace)
    "workspaceName":     "Acme Inc",
    "ownerEmail":        "owner@acme.com",
    "ownerName":         "Dana Owner",
    "plan":              "team",         // optional
    "seats":             10              // optional
  }
→ 200 { "tenantId": "uuid", "inviteUrl": "https://app.hoppa.app/accept-invite?token=…" }
→ 401 { "error": "bad_signature" }
→ 503 { "error": "provisioning_not_configured" }   // PROVISIONING_SECRET unset
```

Hoppa creates the workspace + system groups + settings, upserts the owner
(global identity by email), enrolls them as owner, and returns a single-use
invite magic-link. The marketing site should redirect the buyer to `inviteUrl`
(or email it) so they set a password and land in their new workspace.

**Signature:** HMAC over the **exact raw request bytes** (Hoppa stashes
`req.rawBody`), hex-encoded, compared with `timingSafeEqual`.

## 2. Hoppa → Marketing: subscription status

Called by Hoppa's `requireActiveSubscription` middleware (Redis-cached 5 min).

```
GET {MARKETING_API}/subscriptions/{billingExternalId}
Headers: Authorization: Bearer {MARKETING_API_KEY}
→ 200 {
    "status": "active" | "trialing" | "past_due" | "canceled" | "incomplete",
    "plan": "team",
    "seats": 10,
    "currentPeriodEnd": "2026-07-01T00:00:00Z"
  }
→ 404                                   // no subscription for that id → treated as inactive
```

Hoppa allows the workspace into the app when `status ∈ {active, trialing}`,
otherwise returns `402 subscription_inactive` on business routes (auth, billing,
and the public/portal surfaces stay reachable). A transient upstream failure
falls back to the tenant's last-known status, so a marketing-site outage doesn't
lock out paying customers.

## 3. Hoppa → Marketing: billing portal deep-link

Backs the in-app "Manage billing" button.

```
POST {MARKETING_API}/billing-portal
Headers: Authorization: Bearer {MARKETING_API_KEY}, Content-Type: application/json
Body: { "billingExternalId": "cus_…", "returnUrl": "https://app.hoppa.app/dashboard" }
→ 200 { "url": "https://billing.stripe.com/p/session/…" }
```

Hoppa redirects the owner to `url` (Stripe's hosted billing portal). On failure
Hoppa returns `503 billing_unavailable` and the web shows a fallback message.

## Seat enforcement

Hoppa enforces the plan's `seats` on invite: when the workspace's active
`tenant_members` count would exceed `seats`, `inviteUser` returns
`402 seat_limit_reached`. The marketing site governs the number via Stripe
quantity; Hoppa reads it from the subscription response (mirrored onto
`tenants.seat_limit`).

## Notes

- All amounts/plans are opaque strings to Hoppa — it never prices anything.
- Hoppa is single-domain (`app.hoppa.app`); a user can belong to multiple
  workspaces and switch in-app. The marketing site provisions one workspace per
  checkout.
- The marketing site is the only writer of subscription state; Hoppa only reads.
