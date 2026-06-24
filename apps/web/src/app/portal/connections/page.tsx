'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Mail,
  MessageSquare,
  FileText,
  HardDrive,
  Calendar,
  GitBranch,
  Briefcase,
  AtSign,
  Camera,
  Users,
  Music2,
  Video,
  Image as ImageIcon,
  RefreshCw,
  Plug,
  Share2,
  type LucideIcon,
} from 'lucide-react';
import {
  usePortalMe,
  usePortalConnections,
  useConnectComposio,
  useConnectZernio,
} from '@/hooks/usePortal';
import { PortalHeader } from '@/components/portal/PortalHeader';

type Item = { key: string; label: string; icon: LucideIcon };

// Curated connectable integrations. `key` must match the provider's slug:
// Composio toolkit (lowercase) / Zernio platform (lowercase).
const COMPOSIO: Item[] = [
  { key: 'gmail', label: 'Gmail', icon: Mail },
  { key: 'slack', label: 'Slack', icon: MessageSquare },
  { key: 'notion', label: 'Notion', icon: FileText },
  { key: 'googledrive', label: 'Google Drive', icon: HardDrive },
  { key: 'googlecalendar', label: 'Google Calendar', icon: Calendar },
  { key: 'github', label: 'GitHub', icon: GitBranch },
];
const ZERNIO: Item[] = [
  { key: 'linkedin', label: 'LinkedIn', icon: Briefcase },
  { key: 'twitter', label: 'X (Twitter)', icon: AtSign },
  { key: 'instagram', label: 'Instagram', icon: Camera },
  { key: 'facebook', label: 'Facebook', icon: Users },
  { key: 'tiktok', label: 'TikTok', icon: Music2 },
  { key: 'youtube', label: 'YouTube', icon: Video },
  { key: 'pinterest', label: 'Pinterest', icon: ImageIcon },
];

function Inner() {
  const search = useSearchParams();
  const slug = search?.get('slug') ?? '';
  const errorParam = search?.get('error') ?? null;
  const router = useRouter();

  const meQuery = usePortalMe();
  const me = meQuery.data ?? null;
  const isPrimary = me?.contact.role === 'primary';
  const conns = usePortalConnections(!!me && isPrimary);
  const composio = useConnectComposio();
  const zernio = useConnectZernio();
  const busy = composio.isPending || zernio.isPending;

  useEffect(() => {
    if (meQuery.isLoading) return;
    if (!me) {
      router.replace(`/portal/login?slug=${encodeURIComponent(slug)}`);
      return;
    }
    // Connecting accounts is primary-only; viewers are bounced to the overview.
    if (!isPrimary) router.replace(`/portal?slug=${encodeURIComponent(slug)}`);
  }, [meQuery.isLoading, me, isPrimary, slug, router]);

  // provider:integration -> status, from the cache.
  const status = new Map<string, string>();
  for (const c of conns.data?.connections ?? []) status.set(`${c.provider}:${c.integration}`, c.status);

  const connectComposio = (toolkit: string) =>
    composio.mutate(toolkit, { onSuccess: (r) => { window.location.href = r.redirectUrl; } });
  const connectZernio = (platform: string) =>
    zernio.mutate(platform, { onSuccess: (r) => { window.location.href = r.authUrl; } });

  const Row = ({ provider, it, onConnect }: { provider: 'composio' | 'zernio'; it: Item; onConnect: (k: string) => void }) => {
    const s = status.get(`${provider}:${it.key}`);
    const connected = !!s && s.toLowerCase() === 'active';
    const Icon = it.icon;
    return (
      <li className="px-4 py-3 flex items-center gap-3">
        <Icon className="w-5 h-5 text-gray-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-900">{it.label}</div>
          {s && !connected && <div className="text-[11px] text-amber-600 capitalize">{s}</div>}
        </div>
        <span
          className={`text-[11px] px-2 py-0.5 rounded-full ${
            connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {connected ? 'Connected' : 'Not connected'}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => onConnect(it.key)}
          className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
        >
          {connected ? 'Reconnect' : 'Connect'}
        </button>
      </li>
    );
  };

  return (
    <>
      <PortalHeader slug={slug} me={me} active="connections" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-start justify-between gap-4 mb-1">
          <h1 className="text-2xl font-bold text-gray-900">Connections</h1>
          <button
            type="button"
            onClick={() => conns.refetch()}
            className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1"
          >
            <RefreshCw className={`w-4 h-4 ${conns.isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-6 max-w-2xl">
          Connect your accounts so your team can work on your behalf. Your credentials stay with the
          provider — this app never sees or stores them, and you can disconnect at any time.
        </p>

        {errorParam && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            That connection didn’t complete ({errorParam}). Please try again.
          </div>
        )}

        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <Plug className="w-4 h-4 text-gray-400" /> Apps &amp; Tools
          </h2>
          <ul className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
            {COMPOSIO.map((it) => (
              <Row key={it.key} provider="composio" it={it} onConnect={connectComposio} />
            ))}
          </ul>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <Share2 className="w-4 h-4 text-gray-400" /> Social Channels
          </h2>
          <ul className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
            {ZERNIO.map((it) => (
              <Row key={it.key} provider="zernio" it={it} onConnect={connectZernio} />
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

export default function PortalConnectionsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-500 p-8 text-center">Loading…</div>}>
      <Inner />
    </Suspense>
  );
}
