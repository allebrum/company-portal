'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useBootstrap } from '@/hooks/useResources';
import { Sidebar } from './Sidebar';
import { TimerBar } from './TimerBar';
import { ClientSpaceOverlay } from '@/components/space/ClientSpaceOverlay';

export function AuthGate({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const router = useRouter();
  const rawPathname = usePathname();
  // Normalize trailing slashes (next.config has trailingSlash:true for static export).
  const pathname = rawPathname?.replace(/\/+$/, '') || '/';
  // Routes that render unauthenticated — login, password flows, and the
  // public legal-policy pages. The redirect-to-login + render-without-shell
  // path treats all of them the same.
  const PUBLIC_ROUTES = new Set([
    '/login',
    '/forgot-password',
    '/reset-password',
    '/accept-invite',
    '/terms',
    '/privacy',
  ]);
  const isPublic = PUBLIC_ROUTES.has(pathname);
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
