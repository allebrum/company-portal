'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useBootstrap } from '@/hooks/useResources';
import { Sidebar } from './Sidebar';
import { TimerBar } from './TimerBar';

export function AuthGate({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const router = useRouter();
  const rawPathname = usePathname();
  // Normalize trailing slashes (next.config has trailingSlash:true for static export).
  const pathname = rawPathname?.replace(/\/+$/, '') || '/';
  const isLogin = pathname === '/login';
  const isRoot = pathname === '/' || rawPathname === '';

  useEffect(() => {
    if (!loading && !me && !isLogin) {
      router.replace('/login');
    }
  }, [loading, me, isLogin, router]);

  useEffect(() => {
    if (!loading && me && isRoot) {
      router.replace('/dashboard');
    }
  }, [loading, me, isRoot, router]);

  if (isLogin) {
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
    <ShellWithBootstrap>{children}</ShellWithBootstrap>
  );
}

function ShellWithBootstrap({ children }: { children: ReactNode }) {
  const { isLoading, isError, error } = useBootstrap();

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
    <div className="min-h-screen flex bg-gray-50">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col">
        <TimerBar />
        <div className="px-6 py-6 max-w-7xl w-full mx-auto">{children}</div>
      </main>
    </div>
  );
}
