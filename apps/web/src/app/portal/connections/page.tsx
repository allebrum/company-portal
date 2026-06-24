'use client';

import { Suspense, useEffect, useState } from 'react';
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
  Send,
  Loader2,
  Unplug,
  type LucideIcon,
} from 'lucide-react';
import {
  usePortalMe,
  usePortalConnections,
  useConnectComposio,
  useConnectZernio,
  useRunSocialPost,
  useRunComposioTool,
  useDisconnectConnection,
  useRefreshConnections,
  type PortalConnection,
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

  const disconnect = useDisconnectConnection();
  const refresh = useRefreshConnections();
  const socialPost = useRunSocialPost();
  const gmailTool = useRunComposioTool();
  const [postText, setPostText] = useState('');
  const active = (conns.data?.connections ?? []).filter((c) => c.status.toLowerCase() === 'active');
  const hasSocial = active.some((c) => c.provider === 'zernio');
  const hasGmail = active.some((c) => c.provider === 'composio' && c.integration === 'gmail');

  useEffect(() => {
    if (meQuery.isLoading) return;
    if (!me) {
      router.replace(`/portal/login?slug=${encodeURIComponent(slug)}`);
      return;
    }
    // Connecting accounts is primary-only; viewers are bounced to the overview.
    if (!isPrimary) router.replace(`/portal?slug=${encodeURIComponent(slug)}`);
  }, [meQuery.isLoading, me, isPrimary, slug, router]);

  // provider:integration -> connection, from the cache.
  const byKey = new Map<string, PortalConnection>();
  for (const c of conns.data?.connections ?? []) byKey.set(`${c.provider}:${c.integration}`, c);

  const connectComposio = (toolkit: string) => {
    if (busy) return; // guard double-clicks while a redirect is being prepared
    composio.mutate(toolkit, {
      onSuccess: (r) => {
        if (r?.redirectUrl) window.location.href = r.redirectUrl;
      },
    });
  };
  const connectZernio = (platform: string) => {
    if (busy) return;
    zernio.mutate(platform, {
      onSuccess: (r) => {
        if (r?.authUrl) window.location.href = r.authUrl;
      },
    });
  };
  const startError = composio.isError || zernio.isError;

  const Row = ({ provider, it, onConnect }: { provider: 'composio' | 'zernio'; it: Item; onConnect: (k: string) => void }) => {
    const conn = byKey.get(`${provider}:${it.key}`);
    const connected = !!conn && conn.status.toLowerCase() === 'active';
    const Icon = it.icon;
    return (
      <li className="px-4 py-3 flex items-center gap-3">
        <Icon className="w-5 h-5 text-gray-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-900">{it.label}</div>
          {conn && !connected && <div className="text-[11px] text-amber-600 capitalize">{conn.status}</div>}
        </div>
        <span
          className={`text-[11px] px-2 py-0.5 rounded-full ${
            connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {connected ? 'Connected' : 'Not connected'}
        </span>
        {connected ? (
          <button
            type="button"
            disabled={disconnect.isPending}
            onClick={() => disconnect.mutate(conn!.id)}
            className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
          >
            <Unplug className="w-3.5 h-3.5" />
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => onConnect(it.key)}
            className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
          >
            {conn ? 'Reconnect' : 'Connect'}
          </button>
        )}
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
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
            className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refresh.isPending || conns.isFetching ? 'animate-spin' : ''}`} />
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
        {startError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
            Couldn’t start the connection. Please try again in a moment.
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

        {(hasSocial || hasGmail) && (
          <section className="mt-8 border-t border-gray-100 pt-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-1">Run a test</h2>
            <p className="text-xs text-gray-500 mb-4">
              These run on your connected accounts and are logged to Activity.
            </p>

            {hasSocial && (
              <div className="rounded-2xl border border-gray-200 bg-white p-4 mb-4">
                <label className="text-sm font-semibold text-gray-900">Post an update to your connected channels</label>
                <textarea
                  value={postText}
                  onChange={(e) => setPostText(e.target.value)}
                  rows={3}
                  className="mt-2 w-full rounded-lg border border-gray-200 p-2 text-sm"
                  placeholder="What should we post?"
                />
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    disabled={!postText.trim() || socialPost.isPending}
                    onClick={() => socialPost.mutate({ content: postText.trim(), accountIds: [] }, { onSuccess: () => setPostText('') })}
                    className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {socialPost.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Post now
                  </button>
                  {socialPost.data && (
                    <span className={`text-xs ${socialPost.data.ok ? 'text-green-600' : 'text-red-600'}`}>
                      {socialPost.data.ok ? 'Posted — see Activity' : 'Failed — see Activity'}
                    </span>
                  )}
                </div>
              </div>
            )}

            {hasGmail && (
              <div className="rounded-2xl border border-gray-200 bg-white p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900">List Gmail labels</div>
                  <div className="text-xs text-gray-500">A read-only check that the Gmail connection works.</div>
                </div>
                {gmailTool.data && (
                  <span className={`text-xs ${gmailTool.data.ok ? 'text-green-600' : 'text-red-600'}`}>
                    {gmailTool.data.ok ? 'Done' : 'Failed'}
                  </span>
                )}
                <button
                  type="button"
                  disabled={gmailTool.isPending}
                  onClick={() => gmailTool.mutate()}
                  className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {gmailTool.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Run
                </button>
              </div>
            )}
          </section>
        )}
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
