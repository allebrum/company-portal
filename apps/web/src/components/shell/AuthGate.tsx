'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Menu, Lock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useBootstrap } from '@/hooks/useResources';
import { api, ApiError } from '@/lib/api';
import { Sidebar } from './Sidebar';
import { TimerBar } from './TimerBar';
import { ClientSpaceOverlay } from '@/components/space/ClientSpaceOverlay';
import { UploadTray } from '@/components/upload/UploadTray';

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
    return (
      <div className="min-h-screen grid place-items-center text-gray-400 text-sm">
        Loading…
      </div>
    );
  }

  if (!me) {
    return null;
  }

  return (
    <>
      <ShellWithBootstrap>{children}</ShellWithBootstrap>
      {/* Client/Project Space overlay — fixed inset-0 portal, only renders
          when context's openScope is non-null. Lives alongside the shell so
          it sits above sidebar + content but inside the auth gate. */}
      <ClientSpaceOverlay />
      {/* Background upload manager UI — fixed bottom-left card. Persists
          across Space-overlay open/close and route changes; users can
          drop files, navigate elsewhere, and watch progress complete. */}
      <UploadTray />
    </>
  );
}

function ShellWithBootstrap({ children }: { children: ReactNode }) {
  const { isLoading, isError, error } = useBootstrap();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center text-gray-400 text-sm">
        Loading workspace…
      </div>
    );
  }
  // Hoppa: a 402 from the subscription gate → show the billing screen instead
  // of the generic error (the workspace's subscription lapsed/canceled).
  if (isError && error instanceof ApiError && error.status === 402) {
    return <SubscriptionRequired />;
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
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-600 to-brand-700 flex items-center justify-center text-white text-sm font-bold">
              A
            </div>
            <span className="font-bold text-gray-900">Allebrum</span>
          </div>
        </div>

        <TimerBar />
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 sm:px-6 py-6 max-w-7xl w-full mx-auto">{children}</div>
        </div>
      </main>
    </div>
  );
}

/**
 * Hoppa: shown when the active workspace's subscription is inactive (402 from
 * the gate). The owner can open Stripe's billing portal to re-subscribe; a
 * multi-workspace user can switch to an active workspace; anyone can sign out.
 */
function SubscriptionRequired() {
  const { me, switchWorkspace, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const others = (me?.workspaces ?? []).filter((w) => w.id !== me?.tenantId);

  const manageBilling = async () => {
    setBusy(true);
    try {
      const { url } = await api.post<{ url: string }>('/billing/portal', {});
      window.location.assign(url);
    } catch {
      setBusy(false);
      // 503 billing_unavailable (marketing site unreachable / no billing id).
      alert('Billing isn’t available right now. Please contact support to manage your subscription.');
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
        <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 grid place-items-center mx-auto mb-4">
          <Lock className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Subscription required</h1>
        <p className="mt-2 text-sm text-gray-500">
          This workspace doesn’t have an active subscription. Reactivate it to get back into{' '}
          <span className="font-semibold">{me?.workspaces?.find((w) => w.id === me?.tenantId)?.name ?? 'your workspace'}</span>.
        </p>
        <button
          type="button"
          onClick={manageBilling}
          disabled={busy}
          className="mt-6 w-full rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 disabled:opacity-60"
        >
          {busy ? 'Opening…' : 'Manage billing'}
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
