'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Circle, FileText, Target } from 'lucide-react';
import {
  usePortalMe,
  usePortalProjects,
  usePortalProject,
  type PortalProjectRow,
} from '@/hooks/usePortal';
import { PortalHeader } from '@/components/portal/PortalHeader';

const when = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const HEALTH_LABEL: Record<string, { label: string; cls: string }> = {
  'on-track': { label: 'On track', cls: 'bg-green-50 text-green-700' },
  'at-risk': { label: 'At risk', cls: 'bg-yellow-50 text-yellow-800' },
  'off-track': { label: 'Off track', cls: 'bg-red-50 text-red-700' },
};

// ---- Project detail (0029) — shared goals / to-dos / files + milestones ----

function ProjectDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const detail = usePortalProject(id);
  const d = detail.data;

  if (detail.isLoading) return <div className="rounded-xl bg-gray-100 animate-pulse h-56" />;
  if (!d) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
        <div className="font-semibold text-gray-700">Project not found</div>
        <button type="button" onClick={onBack} className="mt-2 text-sm text-gray-500 hover:text-gray-800">
          Back to projects
        </button>
      </div>
    );
  }
  const p = d.project;
  const health = p.health ? HEALTH_LABEL[p.health] : null;

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> All projects
      </button>

      <header className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-start gap-3">
          <span
            className="w-12 h-12 rounded-xl text-white text-base font-bold flex items-center justify-center shrink-0"
            style={{ backgroundColor: p.color }}
          >
            {(p.code || p.name.slice(0, 2)).slice(0, 2).toUpperCase()}
          </span>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-gray-900">{p.name}</h1>
            <p className="text-[12px] text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
              {health && (
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${health.cls}`}>
                  {health.label}
                </span>
              )}
              {p.nextMilestone && <span>Next: {p.nextMilestone.title} · {when(p.nextMilestone.date)}</span>}
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums" style={{ color: p.color }}>{p.avgProgress}%</div>
            <div className="text-[10px] uppercase tracking-widest text-gray-500">Progress</div>
          </div>
        </div>
        <div className="mt-4 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${p.avgProgress}%`, backgroundColor: p.color }} />
        </div>
      </header>

      {d.milestones.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-gray-900 mb-2">Milestones</h2>
          <ul className="space-y-1.5">
            {d.milestones.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm">
                <span className="flex-1 min-w-0 truncate font-semibold text-gray-800">{m.title}</span>
                <span className="text-[12px] text-gray-500">{when(m.date)}</span>
                {m.signOff && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-50 rounded-full px-2 py-0.5">
                    <CheckCircle2 className="w-3 h-3" /> Approved{m.signOff.by ? ` by ${m.signOff.by}` : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-sm font-bold text-gray-900 mb-2">Goals</h2>
        {d.goals.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing shared here yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {d.goals.map((g) => (
              <li key={g.id} className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm">
                <Target className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="flex-1 min-w-0 truncate font-semibold text-gray-800">{g.title}</span>
                {g.dueDate && <span className="text-[12px] text-gray-500">due {when(g.dueDate)}</span>}
                {typeof g.progress === 'number' && (
                  <span className="text-[12px] font-semibold tabular-nums text-gray-700">{g.progress}%</span>
                )}
                <span className="text-[11px] uppercase tracking-wide text-gray-400">{g.status.replace(/-/g, ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-bold text-gray-900 mb-2">To-dos</h2>
        {d.todos.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing shared here yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {d.todos.map((t) => (
              <li key={t.id} className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm">
                {t.status === 'done' ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                ) : (
                  <Circle className="w-4 h-4 text-gray-300 shrink-0" />
                )}
                <span className={`flex-1 min-w-0 truncate ${t.status === 'done' ? 'text-gray-400 line-through' : 'font-semibold text-gray-800'}`}>
                  {t.title}
                </span>
                {t.dueDate && <span className="text-[12px] text-gray-500">due {when(t.dueDate)}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-bold text-gray-900 mb-2">Files</h2>
        {d.files.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing shared here yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {d.files.map((f) => (
              <li key={f.id}>
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm hover:border-gray-300 transition-colors"
                >
                  <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="flex-1 min-w-0 truncate font-semibold text-gray-800">{f.title}</span>
                  <span className="text-[12px] text-gray-500">{when(f.addedAt)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Inner() {
  const search = useSearchParams();
  const slug = search?.get('slug') ?? '';
  const openProjectId = search?.get('project');
  const router = useRouter();
  const meQuery = usePortalMe();
  const me = meQuery.data ?? null;
  const projects = usePortalProjects(!!me);

  useEffect(() => {
    if (!meQuery.isLoading && !me) {
      router.replace(`/portal/login?slug=${encodeURIComponent(slug)}`);
    }
  }, [meQuery.isLoading, me, slug, router]);

  const q = `?slug=${encodeURIComponent(slug)}`;
  const openProject = (p: PortalProjectRow) => router.push(`/portal/projects${q}&project=${p.id}`);

  if (openProjectId) {
    return (
      <>
        <PortalHeader slug={slug} me={me} active="projects" />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <ProjectDetail id={openProjectId} onBack={() => router.push(`/portal/projects${q}`)} />
        </div>
      </>
    );
  }

  return (
    <>
      <PortalHeader slug={slug} me={me} active="projects" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Projects</h1>
        <p className="text-sm text-gray-500 mb-6">
          Active engagements with goals and milestones you can follow. Click a project for details.
        </p>

        {!projects.data ? (
          <div className="rounded-xl bg-gray-100 animate-pulse h-40" />
        ) : projects.data.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
            <div className="font-semibold text-gray-700">Nothing here yet</div>
            <p className="mt-1 text-sm text-gray-500">Your team usually adds projects after kickoff.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {projects.data.map((p) => (
              <article
                key={p.id}
                id={p.id}
                onClick={() => openProject(p)}
                role="link"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') openProject(p); }}
                className="rounded-2xl border border-gray-200 bg-white p-5 cursor-pointer hover:border-gray-300 hover:shadow-sm transition-all"
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
                    <div className="text-[10px] uppercase tracking-widest text-gray-500">
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

export default function PortalProjectsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-500 p-8 text-center">Loading…</div>}>
      <Inner />
    </Suspense>
  );
}
