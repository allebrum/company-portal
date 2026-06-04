'use client';

import { useEffect } from 'react';
import { MARKETING_SIGNUP_URL } from '@/lib/env';

/**
 * Signup moved to the marketing site. This route is a thin redirect so old
 * bookmarks / inbound links to the portal's `/signup` don't 404. Falls back to
 * `/login` when no marketing URL is configured (self-host).
 */
export default function SignupRedirect() {
  const dest = MARKETING_SIGNUP_URL || '/login';
  useEffect(() => {
    window.location.replace(dest);
  }, [dest]);

  return (
    <div className="min-h-screen grid place-items-center bg-gray-50 text-sm text-gray-500">
      <p>
        Redirecting to sign-up…{' '}
        <a href={dest} className="text-brand-700 font-semibold hover:underline">
          Continue
        </a>
      </p>
    </div>
  );
}
