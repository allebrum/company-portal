'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, ArrowLeft } from 'lucide-react';
import type { AuthMethods } from '@allebrum/shared';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Card } from '@/components/ui/Card';
import { HoppaMark } from '@/components/ui/HoppaMark';
import { useAuth } from '@/hooks/useAuth';
import { useAuthConfig, fetchAuthMethods } from '@/hooks/useResources';
import { useTwoFactorChallenge, verifyTotpStep, verifyPasskeyStep } from '@/hooks/use2fa';
import { ApiError } from '@/lib/api';
import { API_URL } from '@/lib/env';

// Messages for the `?error=` codes that auth redirects (Google OAuth + the
// signup auto-login handoff) can land on the login page with.
const OAUTH_ERRORS: Record<string, string> = {
  bad_state: 'Sign-in expired or was tampered with. Try again.',
  email_unverified: 'Your Google email is not verified.',
  domain_not_allowed: 'Your email domain is not allowed for this workspace.',
  google_unavailable: 'Google sign-in is not available.',
  oauth_failed: 'Google sign-in failed. Try again.',
  // Signup → portal auto-login handoff fallbacks (the account already exists, so
  // signing in manually always works).
  handoff_expired: 'Your sign-in link expired or was already used — sign in below with the email and password you created at signup.',
  handoff_failed: 'We couldn’t finish automatic sign-in — please sign in below.',
  no_workspace: 'Your account isn’t attached to a workspace yet. Sign in, or contact support.',
};

// A reusable "Continue with Google" button — Google is identity-first, so it
// works from the email step without the user typing anything.
function GoogleButton() {
  return (
    <a href={`${API_URL}/api/auth/google`} className="block">
      <Button type="button" variant="outline" size="lg" className="w-full">
        <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
          <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
        </svg>
        Continue with Google
      </Button>
    </a>
  );
}

function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-gray-500">
      <span className="flex-1 h-px bg-gray-200" /> or <span className="flex-1 h-px bg-gray-200" />
    </div>
  );
}

export default function LoginPage() {
  const { me, login, loading, refresh } = useAuth();
  const router = useRouter();
  const { data: cfg } = useAuthConfig();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  // Two-step login: 'email' collects the address, 'method' shows the methods
  // that account actually supports, '2fa' is the post-password second factor.
  const [stage, setStage] = useState<'email' | 'method' | '2fa'>('email');
  const [methods, setMethods] = useState<AuthMethods | null>(null);
  const [code, setCode] = useState('');

  const { data: challenge } = useTwoFactorChallenge(stage === '2fa');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const e = params.get('error');
    if (e) setOauthError(OAUTH_ERRORS[e] ?? 'Sign-in failed.');
    if (params.get('mfa') === '1') setStage('2fa'); // Google flow needs a second factor
  }, []);

  useEffect(() => {
    if (!loading && me) router.replace('/dashboard');
  }, [loading, me, router]);

  // Step 1 → resolve this email's available methods, then advance to step 2.
  const onContinueEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setOauthError(null);
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      const m = await fetchAuthMethods(email.trim());
      setMethods(m);
      setStage('method');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Step 2 (password) → sign in.
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await login(email, password);
      if (r.mfaRequired) {
        setStage('2fa');
        return;
      }
      router.replace('/dashboard');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError('Invalid email or password.');
      else if (err instanceof ApiError && err.status === 403) setError('Password sign-in is disabled for this workspace.');
      else setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const finish2fa = async (fn: () => Promise<unknown>) => {
    setError(null);
    setSubmitting(true);
    try {
      await fn();
      await refresh();
      router.replace('/dashboard');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError('Incorrect code. Try again or use a recovery code.');
      else setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const backToEmail = () => {
    setStage('email');
    setMethods(null);
    setPassword('');
    setError(null);
  };

  // Step 1 surfaces are instance-level (from /auth/config); step 2 is the
  // resolved account's actual methods (from /auth/methods).
  const cfgPasswordEnabled = cfg ? cfg.passwordLoginEnabled : true;
  const cfgGoogleEnabled = cfg ? cfg.googleLoginEnabled : false;

  // Branding: default (instance) on the email step; the resolved workspace's
  // brand once we know which account is signing in.
  const brand = stage === 'method' && methods ? methods : cfg;
  const portalName = brand?.portalName ?? 'Hoppa';
  const brandColor = brand?.brandPrimaryColor ?? '#9333ea';
  const logoDataUrl = brand?.brandLogoDataUrl ?? null;

  const subtitle =
    stage === '2fa'
      ? 'Two-step verification'
      : stage === 'method'
        ? email
        : 'Sign in to continue';

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
            ) : portalName === 'Hoppa' ? (
              <HoppaMark className="w-7 h-7" />
            ) : (
              portalName.charAt(0).toUpperCase() || 'H'
            )}
          </div>
          <h1 className="mt-3 text-xl font-bold text-gray-900">{portalName} Portal</h1>
          <p className="text-sm text-gray-500 truncate">{subtitle}</p>
        </div>

        {(error || oauthError) && (
          <div className="text-sm text-red-600 text-center">{error ?? oauthError}</div>
        )}

        {stage === '2fa' ? (
          <div className="space-y-4">
            {challenge?.totp !== false && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void finish2fa(() => verifyTotpStep(code.trim()));
                }}
                className="space-y-3"
              >
                <Field label="Authenticator code" hint="6-digit code, or a recovery code">
                  <Input
                    inputMode="text"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                    autoFocus
                  />
                </Field>
                <Button type="submit" variant="primary" size="lg" disabled={submitting || !code.trim()} className="w-full">
                  {submitting ? 'Verifying…' : 'Verify'}
                </Button>
              </form>
            )}

            {challenge?.passkey && (
              <>
                {challenge?.totp && <OrDivider />}
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  disabled={submitting}
                  className="w-full"
                  onClick={() => void finish2fa(verifyPasskeyStep)}
                >
                  <KeyRound className="w-4 h-4" /> Use a passkey
                </Button>
              </>
            )}

            <button
              type="button"
              onClick={() => { setStage('email'); setCode(''); setError(null); }}
              className="w-full text-xs text-gray-500 hover:text-gray-800"
            >
              Back to sign in
            </button>
          </div>
        ) : stage === 'method' ? (
          <>
            {methods?.google && <GoogleButton />}
            {methods?.google && methods?.password && <OrDivider />}

            {methods?.password && (
              <form onSubmit={onSubmit} className="space-y-4">
                <Field label="Password">
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus
                  />
                </Field>
                <Button type="submit" variant="primary" size="lg" disabled={submitting} className="w-full">
                  {submitting ? 'Signing in…' : 'Sign in'}
                </Button>
                <div className="text-center">
                  <a href="/forgot-password" className="text-xs text-gray-500 hover:text-brand-700">
                    Forgot your password?
                  </a>
                </div>
              </form>
            )}

            {methods && !methods.password && methods.google && (
              <p className="text-center text-xs text-gray-500">This account uses Google sign-in.</p>
            )}
            {methods && !methods.password && !methods.google && (
              <div className="text-sm text-gray-500 text-center">
                No sign-in method is available for this account. Contact an administrator.
              </div>
            )}

            <button
              type="button"
              onClick={backToEmail}
              className="w-full flex items-center justify-center gap-1 text-xs text-gray-500 hover:text-gray-800"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Use a different email
            </button>
          </>
        ) : (
          <>
            {cfgGoogleEnabled && <GoogleButton />}
            {cfgGoogleEnabled && cfgPasswordEnabled && <OrDivider />}

            {cfgPasswordEnabled && (
              <form onSubmit={onContinueEmail} className="space-y-4">
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
                <Button type="submit" variant="primary" size="lg" disabled={submitting || !email.trim()} className="w-full">
                  {submitting ? 'Checking…' : 'Continue'}
                </Button>
              </form>
            )}

            {!cfgPasswordEnabled && !cfgGoogleEnabled && (
              <div className="text-sm text-gray-500 text-center">No sign-in methods are enabled. Contact an administrator.</div>
            )}
          </>
        )}

        {/* External legal links — only render the ones the admin has set. */}
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
