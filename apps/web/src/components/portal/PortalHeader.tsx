'use client';

import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { useAuthConfig } from '@/hooks/useResources';
import { useLogoutPortal, type PortalMe } from '@/hooks/usePortal';

/**
 * F23 — branded header for the public client portal. Inherits workspace
 * branding from F8 (`portalName` / `brandPrimaryColor` / `brandLogoDataUrl`)
 * and pairs it with the client's own name + accent color.
 *
 * Routes use `?slug=` query params because the portal lives outside the
 * static-export `[slug]` dynamic segment (see layout.tsx comment).
 */
export function PortalHeader({
  slug,
  me,
  active,
}: {
  slug: string;
  me: PortalMe | null;
  active: 'overview' | 'projects' | 'files' | 'tickets' | null;
}) {
  const { data: cfg } = useAuthConfig();
  const logout = useLogoutPortal();
  // Prefer the signed-in contact's WORKSPACE branding (their agency) — the
  // instance config is product-branded on SaaS, so it's only the fallback
  // for the logged-out state.
  const workspaceName = me?.workspace?.name ?? cfg?.portalName ?? 'Hoppa';
  const brandColor = me?.workspace?.color ?? cfg?.brandPrimaryColor ?? '#9333ea';
  const logo = me?.workspace ? me.workspace.logo : cfg?.brandLogoDataUrl;
  const q = `?slug=${encodeURIComponent(slug)}`;

  const nav: { id: typeof active; label: string; href: string }[] = [
    { id: 'overview', label: 'Overview', href: `/portal${q}` },
    { id: 'projects', label: 'Projects', href: `/portal/projects${q}` },
    { id: 'files', label: 'Files', href: `/portal/files${q}` },
    { id: 'tickets', label: 'Tickets', href: `/portal/tickets${q}` },
  ];

  return (
    <header className="bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-4">
        <Link href={`/portal${q}`} className="flex items-center gap-2 shrink-0">
          {logo ? (
            <img src={logo} alt={workspaceName} className="w-8 h-8 rounded-lg object-cover" />
          ) : (
            <span
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold"
              style={{ backgroundColor: brandColor }}
            >
              {workspaceName.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="hidden sm:block text-sm font-semibold text-gray-700">
            {workspaceName}
          </span>
        </Link>

        {me && (
          <>
            <span className="text-gray-300">/</span>
            <span className="flex items-center gap-2 min-w-0">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: me.client.color }}
              />
              <span className="text-sm font-bold text-gray-900 truncate">
                {me.client.name} portal
              </span>
            </span>
          </>
        )}

        {me && (
          <nav className="ml-auto hidden sm:flex items-center gap-1">
            {nav.map((n) => (
              <Link
                key={n.id ?? n.label}
                href={n.href}
                className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
                  active === n.id
                    ? 'bg-gray-100 font-semibold text-gray-900'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        )}

        {me ? (
          <div className="ml-auto sm:ml-3 flex items-center gap-2">
            <span className="hidden md:flex flex-col items-end leading-tight">
              <span className="text-[12px] font-semibold text-gray-700">{me.contact.name}</span>
              <span className="text-[10px] text-gray-500">{me.contact.email}</span>
            </span>
            <button
              type="button"
              onClick={() => logout.mutate()}
              className="text-gray-400 hover:text-gray-700 p-1.5"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <Link
            href={`/portal/login${q}`}
            className="ml-auto text-sm font-semibold hover:underline"
            style={{ color: brandColor }}
          >
            Sign in
          </Link>
        )}
      </div>

      {me && (
        <nav className="sm:hidden border-t border-gray-100 flex items-center justify-around">
          {nav.map((n) => (
            <Link
              key={n.id ?? n.label}
              href={n.href}
              className={`flex-1 text-center text-[12px] py-2 ${
                active === n.id ? 'font-semibold text-gray-900' : 'text-gray-500'
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
