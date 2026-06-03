'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Card } from '@/components/ui/Card';
import { api, ApiError } from '@/lib/api';
import { StripeCardForm } from '@/components/billing/StripeCardForm';

type BillingConfig = {
  enabled: boolean;
  publishableKey: string | null;
  monthlyPriceCents: number;
  currency: string;
  trialDays: number;
};
type SignupResp = {
  clientSecret: string;
  publishableKey: string | null;
  inviteUrl: string;
  trialEndsAt: string;
};

function priceLabel(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

export default function SignupPage() {
  const [cfg, setCfg] = useState<BillingConfig | null>(null);
  const [step, setStep] = useState<'details' | 'card'>('details');
  const [email, setEmail] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [intent, setIntent] = useState<SignupResp | null>(null);

  useEffect(() => {
    api
      .get<BillingConfig>('/billing/config')
      .then(setCfg)
      .catch(() => setCfg({ enabled: false, publishableKey: null, monthlyPriceCents: 0, currency: 'usd', trialDays: 30 }));
  }, []);

  const onDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await api.post<SignupResp>('/billing/signup', {
        email: email.trim(),
        workspaceName: workspaceName.trim(),
        ownerName: ownerName.trim() || undefined,
      });
      if (!(r.publishableKey ?? cfg?.publishableKey)) throw new Error('Card payments are not configured.');
      setIntent(r);
      setStep('card');
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) setError('Sign-ups aren’t open yet. Check back soon.');
      else if (err instanceof ApiError && err.status === 409) setError('An account with that email already exists.');
      else setError(err instanceof Error ? err.message : 'Sign-up failed. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const trialDays = cfg?.trialDays ?? 30;
  const price = cfg && cfg.monthlyPriceCents > 0 ? `${priceLabel(cfg.monthlyPriceCents, cfg.currency)}/mo` : '';

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-purple-900 via-purple-800 to-purple-700 p-6">
      <Card className="w-full max-w-md p-7 space-y-5">
        <div className="text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-purple-600 grid place-items-center text-white text-xl font-bold shadow-md">
            H
          </div>
          <h1 className="mt-3 text-xl font-bold text-gray-900">Start your free trial</h1>
          <p className="text-sm text-gray-500">
            {trialDays} days free{price ? `, then ${price}` : ''}. Cancel anytime.
          </p>
        </div>

        {cfg && !cfg.enabled ? (
          <div className="text-sm text-gray-500 text-center">
            Sign-ups aren’t available on this instance.{' '}
            <a href="/login" className="text-brand-700 font-semibold hover:underline">
              Sign in
            </a>
            .
          </div>
        ) : step === 'details' ? (
          <form onSubmit={onDetails} className="space-y-4">
            {error && <div className="text-sm text-red-600 text-center">{error}</div>}
            <Field label="Workspace name">
              <Input
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="Acme Inc"
                required
                autoFocus
              />
            </Field>
            <Field label="Your name">
              <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Dana Owner" />
            </Field>
            <Field label="Work email">
              <Input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@acme.com"
                required
              />
            </Field>
            <Button type="submit" variant="primary" size="lg" disabled={submitting} className="w-full">
              {submitting ? 'Setting up…' : 'Continue to payment'}
            </Button>
            <p className="text-[11px] text-gray-400 text-center">
              No charge today. We collect a card so your trial continues seamlessly.
            </p>
            <div className="text-center text-xs text-gray-500">
              Already have an account?{' '}
              <a href="/login" className="text-brand-700 font-semibold hover:underline">
                Sign in
              </a>
            </div>
          </form>
        ) : (
          intent && (
            <div className="space-y-4">
              <div className="rounded-lg bg-purple-50 border border-purple-100 p-3 text-sm text-purple-800 text-center">
                {trialDays}-day free trial — you won’t be charged until{' '}
                {new Date(intent.trialEndsAt).toLocaleDateString()}.
              </div>
              <StripeCardForm
                publishableKey={(intent.publishableKey ?? cfg?.publishableKey)!}
                clientSecret={intent.clientSecret}
                submitLabel="Start free trial"
                returnUrl={intent.inviteUrl}
                onComplete={() => window.location.assign(intent.inviteUrl)}
              />
              <p className="text-[11px] text-gray-400 text-center">
                After saving your card you’ll set a password and land in your workspace.
              </p>
            </div>
          )
        )}
      </Card>
    </div>
  );
}
