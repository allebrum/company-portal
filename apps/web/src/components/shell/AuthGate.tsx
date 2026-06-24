'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Menu, Lock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useBootstrap, useAuthConfig, useBillingInfo } from '@/hooks/useResources';
import { api, ApiError } from '@/lib/api';
import { Sidebar } from './Sidebar';
import { TimerBar } from './TimerBar';
import { ClientSpaceOverlay } from '@/components/space/ClientSpaceOverlay';
import { UploadTray } from '@/components/upload/UploadTray';
import { IntegrationGateProvider } from './IntegrationGate';
import { OnboardingChecklist } from './OnboardingChecklist';
import { ShortcutsHelp } from './ShortcutsHelp';
import { ShellSkeleton } from '@/components/ui/Skeleton';

export function AuthGate({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const router = useRouter();
  const rawPathname = usePathname();
  // Normalize trailing slashes (next.config has trailingSlash:true for static export).
  const pathname = rawPathname?.replace(/\/+$/, '') || '/';
  // Routes that render unauthenticated — login + the password flows. The
  // redirect-to-login + render-without-shell path treats all of them the same.
  const PUBLIC_ROUTES = new Set([
    '/login',
    '/signup', // thin redirect to the marketing signup (renders without auth)
    '/forgot-password',
    '/reset-password',
    '/accept-invite',
  ]);
  // F23 client portal — everything under /portal is its own auth track
  // (sibling clientPortalSession on the express-session). The staff
  // AuthGate stays out of the way so the portal layout can render its
  // own branded shell + run its own session check. Slug is a query
  // param (not a path segment) so this prefix matches every portal route.
  const isPortal = pathname === '/portal' || pathname.startsWith('/portal/');
  const isQrUpload = pathname === '/upload/qr' || pathname.startsWith('/upload/qr/');
  const isPublic = PUBLIC_ROUTES.has(pathname) || isPortal || isQrUpload;
  const isRoot = pathname === '/' || rawPathname === '';

  useEffect(() => {
    if (!loading && !me && !isPublic) {
      router.replace('/login');
    }
  }, [loading, me, isPublic, router]);

  useEffect(() => {
    if (!loading && me && isRoot) {
      router.replace('/dashboard');
    }
  }, [loading, me, isRoot, router]);

  // Normalize deep-link space URLs onto /clients so a link like
  // /dashboard?space=project:... always opens in the clients workspace
  // shell context instead of whichever page happened to be linked.
  useEffect(() => {
    if (loading || !me || isPublic) return;
    if (pathname === '/clients') return;
    const url = new URL(window.location.href);
    if (!url.searchParams.get('space')) return;
    router.replace(`/clients${url.search}${url.hash}`);
  }, [loading, me, isPublic, pathname, router]);

  if (isPublic) {
    return <>{children}</>;
  }

  if (loading) {
    return <ShellSkeleton label="Signing you in" />;
  }

  if (!me) {
    return null;
  }

  return (
    <IntegrationGateProvider>
      <ShellWithBootstrap>{children}</ShellWithBootstrap>
      {/* Client/Project Space overlay — fixed inset-0 portal, only renders
          when context's openScope is non-null. Lives alongside the shell so
          it sits above sidebar + content but inside the auth gate. */}
      <ClientSpaceOverlay />
      {/* Background upload manager UI — fixed bottom-left card. Persists
          across Space-overlay open/close and route changes; users can
          drop files, navigate elsewhere, and watch progress complete. */}
      <UploadTray />
      {/* First-run setup checklist — bottom-right, dismissible, auto-checks
          off as integrations connect / teammates are invited. */}
      <OnboardingChecklist />
      {/* Global "?" keyboard-shortcuts reference. */}
      <ShortcutsHelp />
    </IntegrationGateProvider>
  );
}

function ShellWithBootstrap({ children }: { children: ReactNode }) {
  const { isLoading, isError, error } = useBootstrap();
  const { data: cfg } = useAuthConfig();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  if (isLoading) {
    return <ShellSkeleton label="Loading workspace" />;
  }
  // Modern Zen: a 402 from the subscription gate → show the billing screen instead
  // of the generic error (the workspace's subscription lapsed/canceled).
  if (isError && error instanceof ApiError && error.status === 402) {
    // The 402 body carries billingStatus/trialEndsAt so the lockout screen
    // can explain WHY instead of a generic "subscription required".
    return <SubscriptionRequired info={error.body as LockoutInfo | undefined} />;
  }
  if (isError) {
    return (
      <div className="min-h-screen grid place-items-center text-red-600 text-sm">
        Failed to load: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden flex bg-gray-50">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      {/* Mobile off-canvas drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
            onClick={() => setNavOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-64 max-w-[80vw] shadow-2xl">
            <Sidebar />
          </div>
        </div>
      )}

      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center gap-3 px-4 h-14 bg-white border-b border-gray-200 shrink-0">
          <button
            onClick={() => setNavOpen(true)}
            className="text-gray-600 hover:text-gray-900"
            aria-label="Open menu"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-sm font-bold overflow-hidden"
              style={{ backgroundColor: cfg?.brandPrimaryColor ?? '#9333ea' }}
            >
              {cfg?.brandLogoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cfg.brandLogoDataUrl} alt="" className="w-full h-full object-contain" />
              ) : (
                (cfg?.portalName ?? 'Modern Zen').charAt(0).toUpperCase()
              )}
            </div>
            <span className="font-bold text-gray-900">{cfg?.portalName ?? 'Modern Zen'}</span>
          </div>
        </div>

        <TrialBanner />
        <TimerBar />
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 sm:px-6 py-6 max-w-7xl w-full mx-auto">{children}</div>
        </div>
      </main>
    </div>
  );
}

/** Shape of the enriched 402 body from the subscription gate. */
type LockoutInfo = {
  billingStatus?: string | null;
  trialEndsAt?: string | null;
  hasPaymentMethod?: boolean;
};

/** Mint a signed "manage billing" link and hand off to the marketing-hosted
 *  card page. Shared by the lockout screen and the in-shell trial banner. */
function useManageBilling() {
  const [busy, setBusy] = useState(false);
  const [billingErr, setBillingErr] = useState<string | null>(null);
  const openManageBilling = async () => {
    setBusy(true);
    setBillingErr(null);
    try {
      const r = await api.post<{ url: string }>('/billing/manage-link', {});
      if (!r.url) throw new Error('no_url');
      window.location.assign(r.url);
    } catch {
      setBillingErr('Billing isn’t available right now. Please contact support.');
      setBusy(false);
    }
  };
  return { busy, billingErr, openManageBilling };
}

const DAY_MS = 86_400_000;

/**
 * Pre-lockout warning: a slim banner above the timer bar while the workspace
 * is trialing and the end is near. past_due/canceled never reach the shell
 * (the gate 402s bootstrap), so the trial countdown is the one warning we can
 * give BEFORE the wall. Renders nothing on self-host (billing is null).
 */
function TrialBanner() {
  const billing = useBillingInfo();
  const { busy, openManageBilling } = useManageBilling();
  if (billing?.status !== 'trialing' || !billing.trialEndsAt) return null;
  const daysLeft = Math.ceil((new Date(billing.trialEndsAt).getTime() - Date.now()) / DAY_MS);
  if (daysLeft > 7 || daysLeft < 0) return null; // quiet until the last week
  const urgent = daysLeft <= 2;
  return (
    <div
      className={`flex items-center gap-3 px-4 sm:px-6 py-2 text-sm border-b ${
        urgent ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'
      }`}
    >
      <span className="font-semibold">
        {daysLeft === 0 ? 'Your trial ends today' : `Your trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}
      </span>
      <span className="hidden sm:inline text-[13px] opacity-80">
        {billing.hasPaymentMethod
          ? 'Your card on file will be charged when it ends — nothing else to do.'
          : 'Add a payment method to keep access when it ends.'}
      </span>
      <button
        type="button"
        onClick={() => void openManageBilling()}
        disabled={busy}
        className={`ml-auto shrink-0 text-xs font-bold rounded-lg px-3 py-1.5 text-white disabled:opacity-60 ${
          urgent ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'
        }`}
      >
        {busy ? 'Opening…' : 'Manage billing'}
      </button>
    </div>
  );
}

/**
 * Modern Zen: shown when the active workspace's subscription is inactive (402 from
 * the gate). Billing lives on the marketing site, so "Update payment method"
 * redirects to the marketing-hosted fix-card page (via a short-lived signed
 * link); a multi-workspace user can switch to an active workspace; anyone can
 * sign out. `info` (the 402 body) picks reason-specific copy.
 */
function SubscriptionRequired({ info }: { info?: LockoutInfo }) {
  const { me, switchWorkspace, logout } = useAuth();
  const { busy, billingErr, openManageBilling } = useManageBilling();
  const others = (me?.workspaces ?? []).filter((w) => w.id !== me?.tenantId);
  const wsName = me?.workspaces?.find((w) => w.id === me?.tenantId)?.name ?? 'your workspace';

  const status = info?.billingStatus ?? null;
  const trialEnd = info?.trialEndsAt ? new Date(info.trialEndsAt) : null;
  const reason =
    status === 'trialing' && !info?.hasPaymentMethod
      ? {
          title: 'Add a card to start your trial',
          body: (
            <>
              Your free trial of <span className="font-semibold">{wsName}</span> needs a payment
              method on file{trialEnd ? <> — it runs until {trialEnd.toLocaleDateString()}</> : null}.
              You won’t be charged until the trial ends.
            </>
          ),
          cta: 'Add payment method',
        }
      : status === 'past_due'
        ? {
            title: 'Payment failed',
            body: (
              <>
                The card on file for <span className="font-semibold">{wsName}</span> was declined.
                Update it to restore access immediately — your data is intact and nothing has been
                deleted.
              </>
            ),
            cta: 'Update payment method',
          }
        : status === 'canceled'
          ? {
              title: 'Subscription canceled',
              body: (
                <>
                  The subscription for <span className="font-semibold">{wsName}</span> was canceled.
                  Reactivate to pick up exactly where you left off — your data is intact.
                </>
              ),
              cta: 'Reactivate',
            }
          : {
              title: 'Subscription required',
              body: (
                <>
                  This workspace doesn’t have an active subscription. Reactivate it to get back into{' '}
                  <span className="font-semibold">{wsName}</span>.
                </>
              ),
              cta: 'Update payment method',
            };

  return (
    <div className="min-h-screen grid place-items-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
        <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 grid place-items-center mx-auto mb-4">
          <Lock className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">{reason.title}</h1>
        <p className="mt-2 text-sm text-gray-500">{reason.body}</p>
        {billingErr && <div className="mt-4 text-sm text-red-600">{billingErr}</div>}

        <button
          type="button"
          onClick={() => void openManageBilling()}
          disabled={busy}
          className="mt-6 w-full rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 disabled:opacity-60"
        >
          {busy ? 'Opening…' : reason.cta}
        </button>

        {others.length > 0 && (
          <div className="mt-6 pt-5 border-t border-gray-100 text-left">
            <div className="text-[11px] uppercase tracking-widest text-gray-400 font-semibold mb-2">
              Switch to another workspace
            </div>
            <div className="space-y-1.5">
              {others.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => void switchWorkspace(w.id)}
                  className="w-full text-left px-3 py-2 rounded-lg border border-gray-200 hover:border-brand-300 hover:bg-brand-50 text-sm font-semibold text-gray-800"
                >
                  {w.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => void logout()}
          className="mt-6 text-xs font-semibold text-gray-500 hover:text-gray-800"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
