'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { MailCheck } from 'lucide-react';
import { useAuthConfig } from '@/hooks/useResources';

function Inner() {
  const params = useParams<{ slug: string }>();
  const search = useSearchParams();
  const email = search?.get('email');
  const { data: cfg } = useAuthConfig();
  const brandColor = cfg?.brandPrimaryColor ?? '#9333ea';
  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 pt-16 pb-12 text-center">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
        <div
          className="w-12 h-12 rounded-full mx-auto mb-3 grid place-items-center text-white"
          style={{ backgroundColor: brandColor }}
        >
          <MailCheck className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Check your email</h1>
        <p className="text-sm text-gray-600 mt-2">
          If <span className="font-semibold text-gray-900">{email ?? 'that address'}</span> is on
          the invite list, a one-time sign-in link is on the way. It expires in 30 days.
        </p>
        <p className="text-[12px] text-gray-500 mt-3">
          Didn&apos;t get it? Check spam, or{' '}
          <Link
            href={`/portal/${params.slug}/login`}
            className="hover:underline"
            style={{ color: brandColor }}
          >
            request another
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

export default function CheckEmailPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-400 p-8 text-center">Loading…</div>}>
      <Inner />
    </Suspense>
  );
}
