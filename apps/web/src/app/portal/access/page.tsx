'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuthConfig } from '@/hooks/useResources';
import { useExchangePortalToken } from '@/hooks/usePortal';

function Inner() {
  const search = useSearchParams();
  const slug = search?.get('slug') ?? '';
  const token = search?.get('token');
  const router = useRouter();
  const exchange = useExchangePortalToken();
  const { data: cfg } = useAuthConfig();
  const brandColor = cfg?.brandPrimaryColor ?? '#9333ea';
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token || !slug || done) return;
    let cancelled = false;
    (async () => {
      try {
        await exchange.mutateAsync({ slug, token });
        if (!cancelled) {
          setDone(true);
          router.replace(`/portal?slug=${encodeURIComponent(slug)}`);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'invalid_token');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, token]);

  if (!token || !slug) {
    return (
      <div className="max-w-md mx-auto pt-16 px-4 text-center">
        <h1 className="text-xl font-bold text-gray-900">Missing access token</h1>
        <p className="text-sm text-gray-500 mt-2">
          This link didn&apos;t carry a sign-in token. Try opening the link from your invite
          email again, or{' '}
          <Link
            href={`/portal/login?slug=${encodeURIComponent(slug)}`}
            className="hover:underline"
            style={{ color: brandColor }}
          >
            request a fresh one
          </Link>
          .
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto pt-16 px-4 text-center">
        <h1 className="text-xl font-bold text-gray-900">Sign-in link expired</h1>
        <p className="text-sm text-gray-500 mt-2">
          This link is no longer valid. They&apos;re single-use and expire 30 days after
          they&apos;re issued.
        </p>
        <Link
          href={`/portal/login?slug=${encodeURIComponent(slug)}`}
          className="inline-block mt-4 text-sm font-semibold hover:underline"
          style={{ color: brandColor }}
        >
          Request a new link →
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto pt-16 px-4 text-center text-gray-500 text-sm">
      <Loader2 className="w-5 h-5 mx-auto animate-spin mb-2" />
      Signing you in…
    </div>
  );
}

export default function PortalAccessPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-400 p-8 text-center">Loading…</div>}>
      <Inner />
    </Suspense>
  );
}
