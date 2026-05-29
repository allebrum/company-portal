'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { initPostHog, posthog, posthogConfigured } from '@/lib/posthog';

/**
 * Top-of-tree component that wires PostHog into the app: initializes the
 * SDK, identifies the logged-in user (and resets on logout), and emits
 * `$pageview` events on SPA route changes.
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
    } else if (lastIdRef.current) {
      // Was logged in, now isn't — clear the distinct id so the next
      // session doesn't get attributed to the previous user.
      lastIdRef.current = null;
      posthog.reset();
    }
  }, [me]);

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
