'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { initPostHog, posthog, posthogConfigured } from '@/lib/posthog';

/**
 * Top-of-tree component that wires PostHog into the app: initializes the
 * SDK, identifies the logged-in user (and resets on logout), emits
 * `$pageview` events on SPA route changes, and manages the Support chat
 * widget (identity verification + where it's allowed to appear).
 *
 * Mounted inside `AuthProvider` so it has access to `useAuth().me`, and
 * inside `QueryClientProvider` so it can sit alongside the other
 * cross-cutting bindings (LiveEventBindings) without re-rendering the
 * whole tree on auth changes.
 *
 * Renders nothing — pure side-effects. Returns `null` to keep React
 * happy. When `NEXT_PUBLIC_POSTHOG_KEY` isn't set, every branch becomes
 * a no-op so dev builds stay quiet.
 */
export function PostHogBindings(): null {
  const { me } = useAuth();
  const pathname = usePathname();
  const lastIdRef = useRef<string | null>(null);

  // Init once on mount. Idempotent in `initPostHog`.
  useEffect(() => {
    initPostHog();
  }, []);

  // Identify on login, reset on logout. Track the last identified user
  // id in a ref so re-renders of `me` (e.g. permission refresh) don't
  // re-fire identify needlessly.
  useEffect(() => {
    if (!posthogConfigured) return;
    if (me) {
      if (lastIdRef.current === me.id) return;
      lastIdRef.current = me.id;
      posthog.identify(me.id, {
        email: me.email,
        name: me.name,
        // Pass groups along so reports can segment by access level.
        groups: me.groupIds,
      });
      // Support widget identity verification: the server HMAC-signs the same
      // distinct id with the PostHog secret_api_token so tickets follow the
      // user across browsers/devices. Null hash (secret not configured) →
      // skip; the widget falls back to browser-session tickets. Best-effort:
      // a failed fetch must never break the app.
      api
        .get<{ distinctId: string; identityHash: string | null }>('/auth/posthog-identity')
        .then((r) => {
          if (r.identityHash) posthog.setIdentity(r.distinctId, r.identityHash);
        })
        .catch(() => {});
    } else if (lastIdRef.current) {
      // Was logged in, now isn't — clear the distinct id so the next
      // session doesn't get attributed to the previous user.
      lastIdRef.current = null;
      try {
        posthog.clearIdentity();
      } catch {
        /* conversations module not loaded — nothing to clear */
      }
      posthog.reset();
    }
  }, [me]);

  // Support widget visibility. The widget is for HOPPA's users (staff in the
  // app) — never for their clients: the public client portal (/portal/*) is
  // an agency-branded surface where Hoppa support chat would be confusing,
  // and pre-login pages shouldn't carry it either. PostHog renders the
  // widget automatically when it's enabled in Support settings, so this
  // actively hides it everywhere except the authenticated app.
  useEffect(() => {
    if (!posthogConfigured) return;
    const onClientPortal = pathname?.startsWith('/portal') ?? false;
    try {
      if (me && !onClientPortal) posthog.conversations.show();
      else posthog.conversations.hide();
    } catch {
      /* conversations disabled for the project or module not loaded yet */
    }
  }, [me, pathname]);

  // SPA pageview tracking. The Next.js App Router only fires the native
  // `navigation` event on hard reloads, so capture the route change
  // ourselves whenever `pathname` flips. We read query params off
  // `window.location.search` directly instead of `useSearchParams()` to
  // dodge that hook's CSR-bailout requirement in the static export.
  useEffect(() => {
    if (!posthogConfigured) return;
    if (typeof window === 'undefined') return;
    const url = window.location.origin + pathname + window.location.search;
    posthog.capture('$pageview', { $current_url: url });
  }, [pathname]);

  return null;
}
