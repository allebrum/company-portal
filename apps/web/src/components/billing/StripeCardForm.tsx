'use client';

import { useState } from 'react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Button } from '@/components/ui/Button';

// loadStripe must be called once per publishable key — cache the promise.
const stripeCache = new Map<string, Promise<Stripe | null>>();
function getStripe(pk: string): Promise<Stripe | null> {
  let p = stripeCache.get(pk);
  if (!p) {
    p = loadStripe(pk);
    stripeCache.set(pk, p);
  }
  return p;
}

function InnerForm({
  submitLabel,
  returnUrl,
  onComplete,
}: {
  submitLabel: string;
  returnUrl: string;
  onComplete: (setupIntentId?: string) => void | Promise<void>;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    // Save the card off-session (SetupIntent). redirect:'if_required' keeps the
    // common card flow inline; only redirects to return_url if 3-D Secure needs it.
    const { error: err, setupIntent } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: 'if_required',
    });
    if (err) {
      setError(err.message ?? 'We couldn’t save your card. Check the details and try again.');
      setSubmitting(false);
      return;
    }
    await onComplete(setupIntent?.id);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <PaymentElement />
      {error && <div className="text-sm text-red-600">{error}</div>}
      <Button type="submit" variant="primary" size="lg" disabled={!stripe || submitting} className="w-full">
        {submitting ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}

/**
 * Stripe Elements card capture for a SetupIntent (off-session save, no charge).
 * Reused by signup and the fix-payment screen.
 */
export function StripeCardForm({
  publishableKey,
  clientSecret,
  submitLabel,
  returnUrl,
  onComplete,
}: {
  publishableKey: string;
  clientSecret: string;
  submitLabel: string;
  returnUrl: string;
  onComplete: (setupIntentId?: string) => void | Promise<void>;
}) {
  return (
    <Elements
      stripe={getStripe(publishableKey)}
      options={{
        clientSecret,
        appearance: { theme: 'stripe', variables: { colorPrimary: '#9333ea', borderRadius: '8px' } },
      }}
    >
      <InnerForm submitLabel={submitLabel} returnUrl={returnUrl} onComplete={onComplete} />
    </Elements>
  );
}
