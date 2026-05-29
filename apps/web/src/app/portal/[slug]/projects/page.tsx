'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { usePortalMe, usePortalProjects } from '@/hooks/usePortal';
import { PortalHeader } from '@/components/portal/PortalHeader';

export default function PortalProjectsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const router = useRouter();
  const meQuery = usePortalMe();
  const me = meQuery.data ?? null;
  const projects = usePortalProjects(!!me);

  useEffect(() => {
    if (!meQuery.isLoading && !me) router.replace(`/portal/${slug}/login`);
  }, [meQuery.isLoading, me, slug, router]);

  return (
    <>
      <PortalHeader slug={slug} me={me} active="projects" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Projects</h1>
        <p className="text-sm text-gray-500 mb-6">
          Active engagements with goals and milestones you can follow.
        </p>

        {!projects.data ? (
          <div className="rounded-xl bg-gray-100 animate-pulse h-40" />
        ) : projects.data.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
            <div className="font-semibold text-gray-700">No projects yet</div>
            <p className="mt-1 text-sm text-gray-500">Your team will add them as work kicks off.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {projects.data.map((p) => (
              <article
                key={p.id}
                id={p.id}
                className="rounded-2xl border border-gray-200 bg-white p-5"
              >
                <header className="flex items-start gap-3 mb-4">
                  <span
                    className="w-10 h-10 rounded-lg text-white text-sm font-bold flex items-center justify-center shrink-0"
                    style={{ backgroundColor: p.color }}
                  >
                    {(p.code || p.name.slice(0, 2)).slice(0, 2).toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-bold text-gray-900 truncate">{p.name}</h2>
                    <p className="text-[12px] text-gray-500 mt-0.5">
                      {p.goalCount} {p.goalCount === 1 ? 'goal' : 'goals'} ·{' '}
                      {p.openTodoCount} open {p.openTodoCount === 1 ? 'task' : 'tasks'}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold tabular-nums" style={{ color: p.color }}>
                      {p.avgProgress}%
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-gray-400">
                      Progress
                    </div>
                  </div>
                </header>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${p.avgProgress}%`, backgroundColor: p.color }}
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
