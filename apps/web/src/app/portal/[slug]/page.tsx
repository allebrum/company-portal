'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ArrowRight, Calendar, FileText, Target } from 'lucide-react';
import { usePortalMe, usePortalOverview } from '@/hooks/usePortal';
import { PortalHeader } from '@/components/portal/PortalHeader';

/**
 * F23 — public client portal **overview**. Hero card (client name +
 * project count), in-flight goals, upcoming milestones, projects strip.
 * Reads /api/portal/overview in one shot to keep the public surface
 * chatter low.
 */
export default function PortalOverviewPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const router = useRouter();
  const meQuery = usePortalMe();
  const me = meQuery.data ?? null;
  const overview = usePortalOverview(!!me);

  // Redirect unauth → /portal/{slug}/login. The lookup happens up here
  // because the layout is shared with login/check-email/access pages.
  useEffect(() => {
    if (meQuery.isLoading) return;
    if (!me) router.replace(`/portal/${slug}/login`);
  }, [meQuery.isLoading, me, slug, router]);

  if (meQuery.isLoading || !me) {
    return <PortalLoading slug={slug} me={null} />;
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

        {/* Projects strip */}
        <Section title="Projects" icon={<Target className="w-4 h-4" />}>
          {!data ? (
            <SkeletonBlock />
          ) : data.projects.length === 0 ? (
            <Empty title="No projects yet" description="Your team will add them as work kicks off." />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data.projects.map((p) => (
                <Link
                  key={p.id}
                  href={`/portal/${slug}/projects#${p.id}`}
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
                      <div className="text-[11px] text-gray-500">
                        {p.goalCount} {p.goalCount === 1 ? 'goal' : 'goals'} · {p.avgProgress}%
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

        {/* Goals in flight */}
        <Section title="Goals in flight" icon={<Target className="w-4 h-4" />}>
          {!data ? (
            <SkeletonBlock />
          ) : data.inFlightGoals.length === 0 ? (
            <Empty title="No goals in flight" description="Everything that's been started is wrapped up." />
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
                      <div className="text-[10px] text-gray-400 tabular-nums mt-0.5 text-right">
                        {g.progress}%
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Upcoming milestones */}
        <Section title="Upcoming milestones" icon={<Calendar className="w-4 h-4" />}>
          {!data ? (
            <SkeletonBlock />
          ) : data.upcomingMilestones.length === 0 ? (
            <Empty title="No milestones in the next 90 days" />
          ) : (
            <ul className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
              {data.upcomingMilestones.map((m) => (
                <li key={m.id} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="text-[11px] uppercase tracking-wider font-bold text-gray-500 w-16 tabular-nums">
                    {m.date}
                  </span>
                  <span className="text-sm font-semibold text-gray-900 truncate">{m.title}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wider bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                    {m.kind}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Files CTA */}
        {data && data.fileCount > 0 && (
          <Link
            href={`/portal/${slug}/files`}
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

function PortalLoading({ slug, me }: { slug: string; me: null }) {
  return (
    <>
      <PortalHeader slug={slug} me={me} active={null} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 text-center text-sm text-gray-400">
        Loading…
      </div>
    </>
  );
}
