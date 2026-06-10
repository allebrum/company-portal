'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Card } from '@/components/ui/Card';
import { HoppaMark } from '@/components/ui/HoppaMark';
import { api, ApiError } from '@/lib/api';

export default function AcceptInvitePage() {
  const router = useRouter();
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
      await api.post('/auth/accept-invite', { token, password });
      router.replace('/login?invited=1');
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError("This invite link is invalid or has expired. Ask the person who invited you to resend it.");
      } else if (err instanceof ApiError && err.status === 403) {
        setError('Password sign-in is disabled for this workspace. Ask an admin.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not finish setting up your account.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const missingToken = !token;

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-brand-900 via-brand-800 to-brand-700 p-6">
      <Card className="w-full max-w-sm p-6 space-y-5">
        <div className="text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-600 to-brand-700 flex items-center justify-center text-white shadow-md">
            <HoppaMark className="w-7 h-7" />
          </div>
          <h1 className="mt-3 text-xl font-bold text-gray-900">Welcome to Hoppa</h1>
          <p className="text-sm text-gray-500">Set a password to finish signing in. You can also use Google sign-in afterwards.</p>
        </div>

        {missingToken ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
              This page needs an invite link. Ask whoever invited you to resend it.
            </div>
            <a href="/login" className="block">
              <Button type="button" variant="outline" size="lg" className="w-full">
                Back to sign in
              </Button>
            </a>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            {error && <div className="text-sm text-red-600 text-center">{error}</div>}
            <Field label="Create a password">
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
            <Field label="Confirm password">
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
              {submitting ? 'Activating…' : 'Activate account'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
