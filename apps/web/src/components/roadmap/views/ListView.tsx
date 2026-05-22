'use client';

import { Card, Empty } from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';
import { Layers } from 'lucide-react';
import { PRIORITY_DOT, parseLocalDate } from '@/lib/formatters';
import { statusesForScope, bucketStatus, toneColor, toneBg, HEALTH_TONE, rollupProgress, dateMD, dayDiff } from '@/lib/roadmap';
import type { ViewProps } from '../types';

export function ListView(props: ViewProps) {
  const { goals, scope, projects, onOpenGoal } = props;
  const statuses = statusesForScope(scope, projects);
  const today = new Date();

  const sorted = goals.slice().sort((a, b) => (a.endDate ?? '9999').localeCompare(b.endDate ?? '9999'));

  if (sorted.length === 0) {
    return <Empty title="No goals match these filters" description="Adjust scope or filters to see goals." />;
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[820px]">
          <div className="grid grid-cols-[24px_minmax(0,2.5fr)_140px_minmax(120px,1fr)_170px_120px_44px_40px] gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200 text-[10px] uppercase tracking-widest text-gray-500 font-semibold sticky top-0">
            <span></span><span>Goal</span><span>Status</span><span>Epic / Client</span><span>Timeline</span><span>Progress</span><span>Health</span><span></span>
          </div>
          {sorted.map((g) => {
            const proj = projects.find((p) => p.id === g.projectId);
            const epic = g.epicId ? props.epics.find((e) => e.id === g.epicId) : null;
            const client = props.clients.find((c) => c.id === g.clientId);
            const owner = props.users.find((u) => u.id === g.ownerId);
            const pri = PRIORITY_DOT[g.priority];
            const bucket = bucketStatus(g.status, statuses);
            const st = statuses.find((s) => s.id === bucket) ?? statuses[0]!;
            const pct = rollupProgress(g, props.todos);
            const linked = props.todos.filter((t) => t.goalId === g.id).length;
            const start = g.startDate ? parseLocalDate(g.startDate) : null;
            const end = g.endDate ? parseLocalDate(g.endDate) : null;
            const overdue = end ? dayDiff(today, end) < 0 && g.status !== 'done' : false;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => onOpenGoal(g)}
                className="w-full grid grid-cols-[24px_minmax(0,2.5fr)_140px_minmax(120px,1fr)_170px_120px_44px_40px] gap-2 px-4 py-3 items-center text-left hover:bg-gray-50 border-b border-gray-50"
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: pri?.color }} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-gray-900 truncate">{g.title}</span>
                  <span className="block text-[11px] text-gray-500 truncate">
                    {proj?.name}{proj?.code ? ` · ${proj.code}` : ''}{linked ? ` · ${linked} to-do${linked === 1 ? '' : 's'}` : ''}
                  </span>
                </span>
                <span>
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold" style={{ backgroundColor: toneBg(st.tone), color: toneColor(st.tone) }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: toneColor(st.tone) }} />
                    {st.label}
                  </span>
                </span>
                <span className="min-w-0">
                  {epic ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold truncate" style={{ backgroundColor: `${epic.color}15`, color: epic.color }}>
                      <Layers className="w-3 h-3 shrink-0" /> <span className="truncate">{epic.title}</span>
                    </span>
                  ) : client ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-gray-600"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: client.color }} /> {client.name}</span>
                  ) : null}
                </span>
                <span className={`text-xs ${overdue ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                  {start && end ? `${dateMD(start)} – ${dateMD(end)} · ${dayDiff(start, end)}d` : end ? dateMD(end) : '—'}
                </span>
                <span className="flex items-center gap-2">
                  <span className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden"><span className="block h-full bg-brand-500" style={{ width: `${pct}%` }} /></span>
                  <span className="text-[11px] tabular-nums text-gray-500 w-8 text-right">{pct}%</span>
                </span>
                <span className="flex justify-center">
                  {g.health && <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: HEALTH_TONE[g.health]?.color }} title={HEALTH_TONE[g.health]?.label} />}
                </span>
                <span className="flex justify-end">{owner && <Avatar user={owner} size={26} />}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
