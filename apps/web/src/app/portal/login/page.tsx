'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthConfig } from '@/hooks/useResources';
import { usePortalLookup, useRequestPortalAccess } from '@/hooks/usePortal';
import { Mail } from 'lucide-react';

function Inner() {
  const search = useSearchParams();
  const slug = search?.get('slug') ?? '';
  const router = useRouter();
  const { data: cfg } = useAuthConfig();
  const lookup = usePortalLookup(slug || null);
  const request = useRequestPortalAccess();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const brandColor = cfg?.brandPrimaryColor ?? '#9333ea';

  if (!slug) {
    return (
      <div className="max-w-md mx-auto p-8 mt-16 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Missing portal</h1>
        <p className="text-sm text-gray-500">
          Open the link from your invite email. The URL should include a portal name.
        </p>
      </div>
    );
  }

  if (lookup.isLoading) {
    return <div className="grid place-items-center min-h-[60vh] text-sm text-gray-400">Loading…</div>;
  }
  if (lookup.error || !lookup.data) {
    return (
      <div className="max-w-md mx-auto p-8 mt-16 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Portal not found</h1>
        <p className="text-sm text-gray-500">
          This portal URL isn&apos;t recognised. Double-check the link from your invite email or
          ask your contact at {cfg?.portalName ?? 'Allebrum'} for the correct one.
        </p>
        <Link href="/login" className="inline-block mt-4 text-sm hover:underline" style={{ color: brandColor }}>
          Staff sign-in →
        </Link>
      </div>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) return;
    try {
      await request.mutateAsync({ slug, email: email.trim() });
      router.push(
        `/portal/check-email?slug=${encodeURIComponent(slug)}&email=${encodeURIComponent(email.trim())}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send sign-in link.');
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 pt-16 pb-12">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
        <div className="flex items-center gap-3 mb-6">
          <span
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-base font-bold"
            style={{ backgroundColor: lookup.data.color }}
          >
            {lookup.data.name.charAt(0).toUpperCase()}
          </span>
          <div>
            <div className="eyebrow">Sign in to</div>
            <h1 className="text-xl font-bold text-gray-900 leading-tight">
              {lookup.data.name} portal
            </h1>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-5">
          Enter the email your contact at {cfg?.portalName ?? 'Allebrum'} invited. We&apos;ll
          send you a one-time sign-in link.
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="text-[11px] uppercase tracking-widest font-bold text-gray-500">
              Email
            </span>
            <input
              autoFocus
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </label>
          {error && <div className="text-[12px] text-red-600">{error}</div>}
          <button
            type="submit"
            disabled={request.isPending || !email.trim()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-white font-semibold shadow-md disabled:opacity-60"
            style={{ backgroundColor: brandColor }}
          >
            <Mail className="w-4 h-4" />
            {request.isPending ? 'Sending…' : 'Send sign-in link'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function PortalLoginPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-400 p-8 text-center">Loading…</div>}>
      <Inner />
    </Suspense>
  );
}
