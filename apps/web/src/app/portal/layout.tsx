'use client';

import { Suspense, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuthConfig } from '@/hooks/useResources';

/**
 * F23 — portal route layout. Renders a plain background + a single
 * footer with the workspace's Terms/Privacy URLs (F8). The branded
 * header lives inside individual pages so unauthenticated pages
 * (login / check-email / access) can render their own simpler hero
 * without the post-login nav.
 *
 * Static export note: portal URLs use `?slug=` query params rather
 * than a `[slug]` dynamic segment. `output: export` requires every
 * dynamic segment to have a `generateStaticParams()` enumerated at
 * build time — slugs aren't known then, so query params keep the
 * routes statically exportable with no hosting gymnastics.
 */
function LayoutInner({ children }: { children: ReactNode }) {
  const search = useSearchParams();
  const slug = search?.get('slug') ?? '';
  const { data: cfg } = useAuthConfig();
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <main className="flex-1">{children}</main>
      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3 text-[12px] text-gray-500">
          <div>
            Hosted on the {cfg?.portalName ?? 'Allebrum'} portal
            {slug ? ` · ${slug}` : ''}
          </div>
          <div className="flex items-center gap-3">
            {cfg?.termsUrl && (
              <a href={cfg.termsUrl} target="_blank" rel="noreferrer" className="hover:underline">
                Terms
              </a>
            )}
            {cfg?.privacyUrl && (
              <a href={cfg.privacyUrl} target="_blank" rel="noreferrer" className="hover:underline">
                Privacy
              </a>
            )}
            <Link href="/login" className="hover:underline">
              Staff sign-in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <LayoutInner>{children}</LayoutInner>
    </Suspense>
  );
}
