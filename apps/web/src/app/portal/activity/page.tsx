'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Share2, Plug, CheckCircle2, AlertCircle, type LucideIcon } from 'lucide-react';
import { usePortalMe, usePortalActivity, type PortalActivityRun } from '@/hooks/usePortal';
import { PortalHeader } from '@/components/portal/PortalHeader';

const KIND: Record<string, { label: string; icon: LucideIcon }> = {
  social_post: { label: 'Social post', icon: Share2 },
  composio_tool: { label: 'App action', icon: Plug },
};

function formatWhen(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function summarize(run: PortalActivityRun): string {
  const r = run.result as { ok?: boolean; error?: string; postId?: string } | undefined;
  if (r?.ok === false) return r.error ? `Failed — ${r.error}` : 'Failed';
  if (run.kind === 'social_post') return r?.postId ? `Published (post ${r.postId})` : 'Published';
  if (run.kind === 'composio_tool') return 'Completed';
  return 'Done';
}

function Inner() {
  const search = useSearchParams();
  const slug = search?.get('slug') ?? '';
  const router = useRouter();

  const meQuery = usePortalMe();
  const me = meQuery.data ?? null;
  const isPrimary = me?.contact.role === 'primary';
  const activity = usePortalActivity(!!me && isPrimary);

  useEffect(() => {
    if (meQuery.isLoading) return;
    if (!me) {
      router.replace(`/portal/login?slug=${encodeURIComponent(slug)}`);
      return;
    }
    if (!isPrimary) router.replace(`/portal?slug=${encodeURIComponent(slug)}`);
  }, [meQuery.isLoading, me, isPrimary, slug, router]);

  return (
    <>
      <PortalHeader slug={slug} me={me} active="activity" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Activity</h1>
        <p className="text-sm text-gray-500 mb-6">
          Actions your team has run on your behalf using your connected accounts.
        </p>

        {!activity.data ? (
          <div className="rounded-xl bg-gray-100 animate-pulse h-40" />
        ) : activity.data.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
            <div className="font-semibold text-gray-700">No activity yet</div>
            <p className="mt-1 text-sm text-gray-500">On-behalf actions will appear here as they run.</p>
          </div>
        ) : (
          <ul className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
            {activity.data.map((run) => {
              const meta = KIND[run.kind] ?? { label: run.kind, icon: Plug };
              const Icon = meta.icon;
              const failed = (run.result as { ok?: boolean } | undefined)?.ok === false;
              return (
                <li key={run.id} className="px-4 py-3 flex items-center gap-3">
                  <Icon className="w-5 h-5 text-gray-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900">{meta.label}</div>
                    <div className="text-[11px] text-gray-500 truncate">{summarize(run)}</div>
                  </div>
                  {failed ? (
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  )}
                  <span className="text-[11px] text-gray-400 shrink-0">{formatWhen(run.createdAt)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

export default function PortalActivityPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-500 p-8 text-center">Loading…</div>}>
      <Inner />
    </Suspense>
  );
}
