'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/hooks/useAuth';
import { useAuthConfig } from '@/hooks/useResources';
import { ApiError } from '@/lib/api';

// `?error=` codes a reset/recovery redirect may land here with.
const REDIRECT_ERRORS: Record<string, string> = {
  reset_failed: 'That password reset link is invalid or expired. Request a new one.',
};

export default function LoginPage() {
  const { me, login, loading } = useAuth();
  const router = useRouter();
  const { data: cfg } = useAuthConfig();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get('error');
    if (e) setError(REDIRECT_ERRORS[e] ?? 'Sign-in failed. Try again.');
  }, []);

  useEffect(() => {
    if (!loading && me) router.replace('/dashboard');
  }, [loading, me, router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      router.replace('/dashboard');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError('Invalid email or password.');
      else setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const portalName = cfg?.portalName ?? 'Modern Zen';
  const brandColor = cfg?.brandPrimaryColor ?? '#9333ea';
  const logoDataUrl = cfg?.brandLogoDataUrl ?? null;

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-700 p-6">
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
          <h1 className="mt-3 text-xl font-bold text-gray-900">{portalName}</h1>
          <p className="text-sm text-gray-500">Sign in to continue</p>
        </div>

        {error && <div className="text-sm text-red-600 text-center">{error}</div>}

        <form onSubmit={onSubmit} className="space-y-4">
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
          <Field label="Password">
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" variant="primary" size="lg" disabled={submitting || !email.trim() || !password} className="w-full">
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
          <div className="text-center">
            <a href="/forgot-password" className="text-xs text-gray-500 hover:text-brand-700">
              Forgot your password?
            </a>
          </div>
        </form>

        {(cfg?.termsUrl || cfg?.privacyUrl) && (
          <div className="pt-2 text-center text-[11px] text-gray-500 space-x-2">
            {cfg?.termsUrl && (
              <a href={cfg.termsUrl} target="_blank" rel="noreferrer" className="hover:text-brand-700">Terms of Service</a>
            )}
            {cfg?.termsUrl && cfg?.privacyUrl && <span>·</span>}
            {cfg?.privacyUrl && (
              <a href={cfg.privacyUrl} target="_blank" rel="noreferrer" className="hover:text-brand-700">Privacy Policy</a>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
