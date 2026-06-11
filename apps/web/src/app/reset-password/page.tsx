'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Card } from '@/components/ui/Card';
import { HoppaMark } from '@/components/ui/HoppaMark';
import { useAuthConfig } from '@/hooks/useResources';
import { api, ApiError } from '@/lib/api';

export default function ResetPasswordPage() {
  const router = useRouter();
  const { data: cfg } = useAuthConfig();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token') ?? '');
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      // Bounce to the login page so the user re-enters their new password.
      router.replace('/login?reset=1');
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError('This reset link is invalid or has expired. Request a new one.');
      } else if (err instanceof ApiError && err.status === 403) {
        setError('Password sign-in is disabled for this workspace. Ask an admin.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not reset your password.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const missingToken = !token;

  // Workspace branding — same resolution + fallbacks as the login page.
  const portalName = cfg?.portalName ?? 'Hoppa';
  const brandColor = cfg?.brandPrimaryColor ?? '#9333ea';
  const logoDataUrl = cfg?.brandLogoDataUrl ?? null;

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-brand-900 via-brand-800 to-brand-700 p-6">
      <Card className="w-full max-w-sm p-6 space-y-5">
        <div className="text-center">
          <div
            className="mx-auto w-12 h-12 rounded-2xl flex items-center justify-center text-white text-xl font-bold shadow-md overflow-hidden"
            style={{ backgroundColor: brandColor }}
          >
            {logoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoDataUrl} alt={`${portalName} logo`} className="w-full h-full object-contain" />
            ) : portalName === 'Hoppa' ? (
              <HoppaMark className="w-7 h-7" />
            ) : (
              portalName.charAt(0).toUpperCase() || 'H'
            )}
          </div>
          <h1 className="mt-3 text-xl font-bold text-gray-900">Choose a new password</h1>
          <p className="text-sm text-gray-500">Pick something strong — at least 8 characters.</p>
        </div>

        {missingToken ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
              This page needs a reset link. Request a new one from the forgot-password screen.
            </div>
            <a href="/forgot-password" className="block">
              <Button type="button" variant="primary" size="lg" className="w-full">
                Request a reset link
              </Button>
            </a>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            {error && <div className="text-sm text-red-600 text-center">{error}</div>}
            <Field label="New password">
              <Input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                minLength={8}
              />
            </Field>
            <Field label="Confirm new password">
              <Input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
              />
            </Field>
            <Button type="submit" variant="primary" size="lg" disabled={submitting || !password || !confirm} className="w-full">
              {submitting ? 'Updating…' : 'Update password'}
            </Button>
            <div className="text-center">
              <a href="/login" className="text-xs text-gray-500 hover:text-brand-700">
                Back to sign in
              </a>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
