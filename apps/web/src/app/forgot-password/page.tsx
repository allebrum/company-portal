'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Card } from '@/components/ui/Card';
import { useAuthConfig } from '@/hooks/useResources';
import { getSupabase } from '@/lib/supabase';

export default function ForgotPasswordPage() {
  const { data: cfg } = useAuthConfig();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Supabase sends the reset email + handles the token; the link returns to
      // /reset-password where the user sets a new password.
      const { error: err } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (err) throw new Error(err.message);
      setDone(true); // always show the same screen (anti-enumeration)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the email. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const portalName = cfg?.portalName ?? 'Modern Zen';
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
            ) : (
              portalName.charAt(0).toUpperCase() || 'M'
            )}
          </div>
          <h1 className="mt-3 text-xl font-bold text-gray-900">Reset your password</h1>
          <p className="text-sm text-gray-500">
            {done ? 'Check your email for a reset link.' : "We'll send you a link to choose a new password."}
          </p>
        </div>

        {done ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
              If <span className="font-semibold">{email}</span> belongs to a {portalName} account, a reset link is on its way.
            </div>
            <a href="/login" className="block">
              <Button type="button" variant="primary" size="lg" className="w-full">
                Back to sign in
              </Button>
            </a>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            {error && <div className="text-sm text-red-600 text-center">{error}</div>}
            <Field label="Email">
              <Input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </Field>
            <Button type="submit" variant="primary" size="lg" disabled={submitting || !email} className="w-full">
              {submitting ? 'Sending…' : 'Send reset link'}
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
