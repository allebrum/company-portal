'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Calendar, CheckCircle2, FileText, Target } from 'lucide-react';
import {
  usePortalMe,
  usePortalOverview,
  useSignOffMilestone,
  type PortalMilestoneRow,
  type PortalProjectRow,
} from '@/hooks/usePortal';
import { PortalHeader } from '@/components/portal/PortalHeader';

const HEALTH_LABEL: Record<NonNullable<PortalProjectRow['health']>, { text: string; dot: string }> = {
  'on-track': { text: 'On track', dot: 'bg-green-500' },
  'at-risk': { text: 'At risk', dot: 'bg-amber-500' },
  'off-track': { text: 'Off track', dot: 'bg-red-500' },
};

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function Page() {
  const search = useSearchParams();
  const slug = search?.get('slug') ?? '';
  const router = useRouter();
  const meQuery = usePortalMe();
  const me = meQuery.data ?? null;
  const overview = usePortalOverview(!!me);
  const q = `?slug=${encodeURIComponent(slug)}`;

  useEffect(() => {
    if (meQuery.isLoading) return;
    if (!me) router.replace(`/portal/login${q}`);
  }, [meQuery.isLoading, me, slug, router, q]);

  if (meQuery.isLoading || !me) {
    return <PortalLoading slug={slug} />;
  }

  const data = overview.data;

  return (
    <>
      <PortalHeader slug={slug} me={me} active="overview" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Hero */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 flex items-start gap-4">
          <span
            className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-lg font-bold shrink-0"
            style={{ backgroundColor: me.client.color }}
          >
            {me.client.name.charAt(0).toUpperCase()}
          </span>
          <div className="flex-1 min-w-0">
            <div className="eyebrow">Welcome back</div>
            <h1 className="text-2xl font-bold text-gray-900 truncate">{me.client.name}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {data ? (
                <>
                  <span className="font-semibold text-gray-700">{data.projects.length}</span>{' '}
                  {data.projects.length === 1 ? 'project' : 'projects'} ·{' '}
                  <span className="font-semibold text-gray-700">{data.inFlightGoals.length}</span>{' '}
                  goals in flight ·{' '}
                  <span className="font-semibold text-gray-700">{data.fileCount}</span> files
                </>
              ) : (
                'Loading status…'
              )}
            </p>
          </div>
        </div>

        <Section title="Projects" icon={<Target className="w-4 h-4" />}>
          {!data ? (
            <SkeletonBlock />
          ) : data.projects.length === 0 ? (
            <Empty title="Nothing here yet" description="Your team usually adds projects after kickoff." />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data.projects.map((p) => (
                <Link
                  key={p.id}
                  href={`/portal/projects${q}#${p.id}`}
                  className="group rounded-xl border border-gray-200 bg-white p-4 hover:border-brand-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-7 h-7 rounded-md text-white text-[11px] font-bold flex items-center justify-center"
                      style={{ backgroundColor: p.color }}
                    >
                      {(p.code || p.name.slice(0, 2)).slice(0, 2).toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-900 truncate group-hover:text-brand-700">
                        {p.name}
                      </div>
                      <div className="text-[11px] text-gray-500 truncate">
                        {p.health && (
                          <span className="inline-flex items-center gap-1 font-semibold text-gray-700">
                            <span className={`w-1.5 h-1.5 rounded-full ${HEALTH_LABEL[p.health].dot}`} />
                            {HEALTH_LABEL[p.health].text}
                            {' · '}
                          </span>
                        )}
                        {p.avgProgress}% complete
                        {p.nextMilestone && ` · next: ${p.nextMilestone.title} ${shortDate(p.nextMilestone.date)}`}
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-brand-700 transition-colors" />
                  </div>
                  <div className="mt-2 h-1 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${p.avgProgress}%`, backgroundColor: p.color }}
                    />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Section>

        <Section title="Goals in flight" icon={<Target className="w-4 h-4" />}>
          {!data ? (
            <SkeletonBlock />
          ) : data.inFlightGoals.length === 0 ? (
            <Empty title="Nothing in motion right now" description="Goals your team is actively working on will appear here." />
          ) : (
            <ul className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
              {data.inFlightGoals.map((g) => (
                <li key={g.id} className="px-4 py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">{g.title}</div>
                    <div className="text-[11px] text-gray-500">
                      {g.status}
                      {g.dueDate && ` · due ${g.dueDate}`}
                    </div>
                  </div>
                  {typeof g.progress === 'number' && (
                    <div className="shrink-0 w-24">
                      <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brand-500 rounded-full"
                          style={{ width: `${g.progress}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-gray-500 tabular-nums mt-0.5 text-right">
                        {g.progress}%
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Upcoming milestones" icon={<Calendar className="w-4 h-4" />}>
          {!data ? (
            <SkeletonBlock />
          ) : data.upcomingMilestones.length === 0 ? (
            <Empty title="No milestones on the calendar yet" description="Dates your team sets for the next 90 days will appear here." />
          ) : (
            <ul className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
              {data.upcomingMilestones.map((m) => (
                <MilestoneRow key={m.id} milestone={m} />
              ))}
            </ul>
          )}
        </Section>

        {data && data.fileCount > 0 && (
          <Link
            href={`/portal/files${q}`}
            className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline"
          >
            <FileText className="w-4 h-4" />
            See all {data.fileCount} files →
          </Link>
        )}
      </div>
    </>
  );
}

/**
 * S3.2: a milestone row the client can APPROVE. Unsigned → an "Approve"
 * button that expands a small optional-comment form; signed → a green
 * confirmation with who/when (+ the comment). Errors render inline — the
 * portal has no toast surface, and the state change itself is the feedback.
 */
function MilestoneRow({ milestone: m }: { milestone: PortalMilestoneRow }) {
  const signOff = useSignOffMilestone();
  const [formOpen, setFormOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onApprove = async () => {
    setError(null);
    try {
      await signOff.mutateAsync({ id: m.id, comment });
      setFormOpen(false);
    } catch (e) {
      setError(e instanceof Error && /already_signed/.test(e.message)
        ? 'Someone already approved this — refresh to see it.'
        : 'Could not record your approval. Please try again.');
    }
  };

  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <span className="text-[11px] uppercase tracking-wider font-bold text-gray-500 w-16 tabular-nums shrink-0">
          {m.date}
        </span>
        <span className="text-sm font-semibold text-gray-900 truncate">{m.title}</span>
        <span className="ml-auto text-[10px] uppercase tracking-wider bg-gray-100 text-gray-600 rounded-full px-2 py-0.5 shrink-0">
          {m.kind}
        </span>
        {m.signOff ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5" /> Approved
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setFormOpen((v) => !v)}
            className="shrink-0 text-[11px] font-bold text-brand-700 hover:text-brand-800 border border-brand-200 hover:border-brand-300 hover:bg-brand-50 rounded-lg px-2.5 py-1"
          >
            Approve
          </button>
        )}
      </div>

      {m.signOff && (
        <div className="mt-1 ml-[76px] text-[11px] text-gray-500">
          Approved{m.signOff.by ? ` by ${m.signOff.by}` : ''} ·{' '}
          {new Date(m.signOff.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          {m.signOff.comment && <span className="italic"> — “{m.signOff.comment}”</span>}
        </div>
      )}

      {!m.signOff && formOpen && (
        <div className="mt-2 ml-[76px] flex flex-col sm:flex-row gap-2">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional comment (e.g. looks great, one note…)"
            maxLength={1000}
            autoFocus
            className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
          />
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => { setFormOpen(false); setError(null); }}
              className="text-xs font-semibold text-gray-500 hover:text-gray-700 px-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onApprove()}
              disabled={signOff.isPending}
              className="text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-3 py-1.5 disabled:opacity-60"
            >
              {signOff.isPending ? 'Approving…' : 'Confirm approval'}
            </button>
          </div>
        </div>
      )}
      {error && <div className="mt-1 ml-[76px] text-[11px] text-red-600">{error}</div>}
    </li>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3 text-[11px] uppercase tracking-widest font-bold text-gray-500">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

function Empty({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center">
      <div className="font-semibold text-gray-700">{title}</div>
      {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
    </div>
  );
}

function SkeletonBlock() {
  return <div className="rounded-xl bg-gray-100 animate-pulse h-24" />;
}

function PortalLoading({ slug }: { slug: string }) {
  return (
    <>
      <PortalHeader slug={slug} me={null} active={null} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 text-center text-sm text-gray-500">
        Loading…
      </div>
    </>
  );
}

export default function PortalOverviewPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-500 p-8 text-center">Loading…</div>}>
      <Page />
    </Suspense>
  );
}
