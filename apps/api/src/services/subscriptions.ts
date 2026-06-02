import { eq } from 'drizzle-orm';
import { redisSession } from '../redis.js';
import { env, subscriptionsConfigured } from '../env.js';
import { db } from '../db/client.js';
import { tenants } from '../db/schema.js';

/**
 * Hoppa Phase 3 — subscription status client.
 *
 * The marketing site (separate repo, Stripe) is the source of truth for
 * subscriptions. This client asks it "is workspace {billingExternalId}
 * active, and what's its seat limit / plan?" and caches the answer in Redis
 * so the gating middleware doesn't hit the upstream on every request.
 *
 * Mirrors `services/ipGeo.ts`: Redis cache (short TTL) + AbortController
 * timeout + graceful degradation. The crucial difference is the
 * fail-open/closed policy below.
 *
 * Config: when MARKETING_API_URL / MARKETING_API_KEY are unset
 * (`subscriptionsConfigured === false`), this returns a synthetic ACTIVE
 * status so Hoppa runs as a single self-hosted workspace with no billing —
 * the app must work before the marketing site exists.
 */

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';

export type Subscription = {
  status: SubscriptionStatus;
  plan: string | null;
  seats: number | null;
  currentPeriodEnd: string | null;
};

const HIT_TTL_SECONDS = 5 * 60; // 5 min — subscriptions change rarely
const MISS_TTL_SECONDS = 60;
const FETCH_TIMEOUT_MS = 2500;

/** When billing isn't configured, every workspace is treated as active. */
export function unconfiguredSubscription(): Subscription {
  return { status: 'active', plan: 'self-hosted', seats: null, currentPeriodEnd: null };
}

export function isActive(s: Subscription | null): boolean {
  return !!s && (s.status === 'active' || s.status === 'trialing');
}

/**
 * Look up a workspace's subscription by its Stripe customer id. Returns null
 * only when billing IS configured but the lookup failed/404'd — callers treat
 * null as "inactive" (fail closed) for a configured marketplace. When billing
 * is unconfigured, returns the synthetic active record (fail open).
 */
export async function getSubscription(billingExternalId: string | null): Promise<Subscription | null> {
  if (!subscriptionsConfigured) return unconfiguredSubscription();
  // A configured marketplace with no billing id on the tenant = not subscribed.
  if (!billingExternalId) return null;

  const cacheKey = `subs:${billingExternalId}`;
  try {
    const cached = await redisSession.get(cacheKey);
    if (cached === 'MISS') return null;
    if (cached) {
      try {
        return JSON.parse(cached) as Subscription;
      } catch {
        /* corrupted row — refetch */
      }
    }
  } catch {
    /* redis blip — try upstream */
  }

  let sub: Subscription | null = null;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(
      `${env.MARKETING_API_URL}/subscriptions/${encodeURIComponent(billingExternalId)}`,
      {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${env.MARKETING_API_KEY}` },
      },
    );
    clearTimeout(t);
    if (res.ok) {
      const body = (await res.json()) as Partial<Subscription>;
      if (body.status) {
        sub = {
          status: body.status as SubscriptionStatus,
          plan: body.plan ?? null,
          seats: typeof body.seats === 'number' ? body.seats : null,
          currentPeriodEnd: body.currentPeriodEnd ?? null,
        };
      }
    }
    // 404 (and any non-ok) → sub stays null = not subscribed.
  } catch {
    // Network/timeout — leave sub null. The middleware decides whether a
    // transient upstream failure should hard-block; see requireActiveSubscription.
  }

  try {
    if (sub) {
      await redisSession.set(cacheKey, JSON.stringify(sub), 'EX', HIT_TTL_SECONDS);
    } else {
      await redisSession.set(cacheKey, 'MISS', 'EX', MISS_TTL_SECONDS);
    }
  } catch {
    /* cache write best-effort */
  }

  // Opportunistically refresh the cached mirror columns on the tenant row so
  // admin UIs can show plan/seat info without another round-trip.
  if (sub) void refreshTenantMirror(billingExternalId, sub);

  return sub;
}

async function refreshTenantMirror(billingExternalId: string, sub: Subscription): Promise<void> {
  try {
    await db
      .update(tenants)
      .set({ plan: sub.plan, seatLimit: sub.seats, status: sub.status, updatedAt: new Date().toISOString() })
      .where(eq(tenants.billingExternalId, billingExternalId));
  } catch {
    /* best-effort */
  }
}

/**
 * Ask the marketing site for a Stripe billing-portal deep link so a workspace
 * owner can manage / fix their subscription. Returns null when unconfigured or
 * on any failure (the web shows a fallback message).
 */
export async function billingPortalUrl(billingExternalId: string | null, returnUrl: string): Promise<string | null> {
  if (!subscriptionsConfigured || !billingExternalId) return null;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`${env.MARKETING_API_URL}/billing-portal`, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${env.MARKETING_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ billingExternalId, returnUrl }),
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const body = (await res.json()) as { url?: string };
    return body.url ?? null;
  } catch {
    return null;
  }
}
