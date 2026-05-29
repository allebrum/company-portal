'use client';

import posthog from 'posthog-js';

/**
 * PostHog wiring — product analytics, session replay, error tracking,
 * heatmaps. Singleton init, idempotent, safe to call when the env vars
 * aren't set (becomes a no-op).
 *
 * Env vars (BUILD_TIME on DigitalOcean — `NEXT_PUBLIC_*` are inlined at
 * build time for the static export):
 *   - NEXT_PUBLIC_POSTHOG_KEY  · Public project key from the PostHog
 *                                project settings. Required to enable.
 *   - NEXT_PUBLIC_POSTHOG_HOST · Optional; defaults to PostHog Cloud US
 *                                (`https://us.i.posthog.com`). Use the
 *                                EU host or a self-hosted URL here if
 *                                that's where the project lives.
 *
 * Privacy posture:
 *   - Autocapture is on (standard PostHog default).
 *   - Session replay is on with the default input masking — password,
 *     email, and credit-card inputs are masked automatically. We don't
 *     opt into recording extra surface area.
 *   - JS exception capture is on — `capture_exceptions: true` wires the
 *     browser's unhandled error / promise-rejection handlers into the
 *     SDK so the Errors tab populates without per-call `captureException`.
 */

export const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '';
export const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';
export const posthogConfigured = posthogKey.length > 0;

let initialized = false;

/**
 * Init the PostHog SDK. Safe to call repeatedly — guarded so reloads in
 * dev (hot module replacement) don't double-initialize. No-ops when the
 * key isn't configured so dev builds stay quiet.
 */
export function initPostHog(): void {
  if (initialized || !posthogConfigured) return;
  // The SDK runs only in the browser; guard for any accidental SSR call.
  if (typeof window === 'undefined') return;
  posthog.init(posthogKey, {
    api_host: posthogHost,
    // Identified ahead of capture by the auth-watcher below, so don't
    // race-fire an anonymous identify on page load.
    person_profiles: 'identified_only',
    // PostHog's default capture-pageview only fires on hard navigation;
    // SPA route changes need our own `$pageview` calls. Turn off the
    // built-in to avoid duplicates from the watcher in PostHogBindings.
    capture_pageview: false,
    // Pageleave events let PostHog compute time-on-page accurately;
    // they're cheap, keep them.
    capture_pageleave: true,
    // Session replay default config — input masking is on, sensitive
    // attribute scrubbing is on. We don't override these.
    session_recording: {},
    // Browser-level JS exception capture for the Errors tab.
    capture_exceptions: true,
  });
  initialized = true;
}

export { posthog };
