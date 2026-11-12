'use client';

import { useState, Suspense, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { useAuthConfig } from '@/hooks/useResources';
import { useExchangePortalToken, useRequestPortalAccess } from '@/hooks/usePortal';

/**
 * Magic-link landing page. The token is NOT exchanged on load: email
 * link scanners and chat previews often fetch (and some execute) links,
 * which used to burn single-use tokens before the client ever clicked.
 * The exchange only happens on an explicit "Continue" click (POST).
 */

type ErrorCode = 'invalid_token' | 'token_used' | 'token_expired' | 'portal_unpublished' | 'rate_limited' | 'unknown';

const KNOWN: ErrorCode[] = ['invalid_token', 'token_used', 'token_expired', 'portal_unpublished', 'rate_limited'];

const ERROR_COPY: Record<ErrorCode, { title: string; body: string; canRequest: boolean }> = {
  token_expired: {
    title: 'This sign-in link has expired',
    body: 'Sign-in links are valid for 30 days. Enter your email below and we’ll send you a fresh one.',
    canRequest: true,
  },
  token_used: {
    title: 'This sign-in link was already used',
    body: 'Each link works once, and sending a new link replaces older ones. Enter your email below to get a new link.',
    canRequest: true,
  },
  portal_unpublished: {
    title: 'This portal isn’t available yet',
    body: 'Your link is still good — the team hasn’t switched this portal on yet. Please contact your project lead, then try this same link again.',
    canRequest: false,
  },
  invalid_token: {
    title: 'This sign-in link isn’t valid',
    body: 'The link may be incomplete (some email apps break long links) or meant for a different portal. Enter your email below to get a new one.',
    canRequest: true,
  },
  rate_limited: {
    title: 'Too many attempts',
    body: 'Please wait a minute and try again.',
    canRequest: false,
  },
  unknown: {
    title: 'Something went wrong',
    body: 'We couldn’t sign you in. Please try again, or request a new link below.',
    canRequest: true,
  },
};

function toCode(e: unknown): ErrorCode {
  const body = e instanceof ApiError ? (e.body as { error?: unknown } | undefined) : undefined;
  const m = typeof body?.error === 'string' ? body.error : '';
  return (KNOWN as string[]).includes(m) ? (m as ErrorCode) : 'unknown';
}

function RequestLinkForm({ slug, brandColor }: { slug: string; brandColor: string }) {
  const req = useRequestPortalAccess();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await req.mutateAsync({ slug, email: email.trim() });
      setSent(true);
    } catch (e2) {
      setErr(toCode(e2) === 'rate_limited' ? 'Too many requests — please wait a minute.' : 'Could not send right now. Please try again.');
    }
  };

  if (sent) {
    return (
      <p className="mt-5 text-sm text-gray-700 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
        If that email has access to this portal, a new sign-in link is on its way. It can take a minute or two.
      </p>
    );
  }
  return (
    <form onSubmit={onSubmit} className="mt-5 flex gap-2" aria-label="Email me a new link">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={req.isPending || !email.trim()}
        className="rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        style={{ backgroundColor: brandColor }}
      >
        {req.isPending ? 'Sending…' : 'Email me a new link'}
      </button>
      {err && <p className="sr-only" role="alert">{err}</p>}
      {err && <p className="basis-full text-xs text-red-600">{err}</p>}
    </form>
  );
}

function Inner() {
  const search = useSearchParams();
  const slug = search?.get('slug') ?? '';
  const token = search?.get('token');
  const router = useRouter();
  const exchange = useExchangePortalToken();
  const { data: cfg } = useAuthConfig();
  const brandColor = cfg?.brandPrimaryColor ?? '#9333ea';
  const [error, setError] = useState<ErrorCode | null>(null);

  const onContinue = async () => {
    if (!token || !slug) return;
    setError(null);
    try {
      await exchange.mutateAsync({ slug, token });
      router.replace(`/portal?slug=${encodeURIComponent(slug)}`);
    } catch (e) {
      setError(toCode(e));
    }
  };

  if (!slug) {
    return (
      <div className="max-w-md mx-auto pt-16 px-4 text-center">
        <h1 className="text-xl font-bold text-gray-900">Incomplete link</h1>
        <p className="text-sm text-gray-500 mt-2">
          This link is missing part of its address. Open the most recent invite email and click the button
          there, or ask your project lead for your portal link.
        </p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="max-w-md mx-auto pt-16 px-4 text-center">
        <h1 className="text-xl font-bold text-gray-900">Missing sign-in token</h1>
        <p className="text-sm text-gray-500 mt-2">
          This link didn&apos;t include a sign-in token. Enter your email and we&apos;ll send you a new link.
        </p>
        <RequestLinkForm slug={slug} brandColor={brandColor} />
      </div>
    );
  }

  if (error) {
    const copy = ERROR_COPY[error];
    return (
      <div className="max-w-md mx-auto pt-16 px-4 text-center" data-error={error}>
        <h1 className="text-xl font-bold text-gray-900">{copy.title}</h1>
        <p className="text-sm text-gray-500 mt-2">{copy.body}</p>
        {copy.canRequest && <RequestLinkForm slug={slug} brandColor={brandColor} />}
        {!copy.canRequest && (
          <button
            type="button"
            onClick={onContinue}
            className="mt-4 text-sm font-semibold hover:underline"
            style={{ color: brandColor }}
          >
            Try again
          </button>
        )}
        <div className="mt-6">
          <Link href={`/portal/login?slug=${encodeURIComponent(slug)}`} className="text-xs text-gray-400 hover:underline">
            Go to the portal sign-in page
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto pt-16 px-4 text-center">
      <h1 className="text-xl font-bold text-gray-900">Sign in to your client portal</h1>
      <p className="text-sm text-gray-500 mt-2">Click continue to finish signing in. This link works once.</p>
      <button
        type="button"
        onClick={onContinue}
        disabled={exchange.isPending}
        className="mt-6 inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        style={{ backgroundColor: brandColor }}
      >
        {exchange.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        Continue
      </button>
    </div>
  );
}

export default function PortalAccessPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-500 p-8 text-center">Loading…</div>}>
      <Inner />
    </Suspense>
  );
}
