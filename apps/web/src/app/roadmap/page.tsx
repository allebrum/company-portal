'use client';

import { useMemo, useState } from 'react';
import { Card, Pill } from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { GoalFormModal } from '@/components/features/GoalFormModal';
import {
  useGoals,
  useUsers,
  useProjects,
  useClients,
  useMoveGoal,
  useRemoveResource,
  type GoalRow,
} from '@/hooks/useResources';
import { STATUS_LABEL, STATUS_ORDER, PRIORITY_DOT } from '@/lib/formatters';
import type { ResourceKind } from '@allebrum/shared';
import { Plus, Link as LinkIcon, FileText, Folder, Github, KeyRound, StickyNote, Sheet } from 'lucide-react';

const KIND_ICON: Record<ResourceKind, typeof LinkIcon> = {
  'drive-folder': Folder,
  'drive-doc': FileText,
  'drive-sheet': Sheet,
  figma: FileText,
  github: Github,
  link: LinkIcon,
  key: KeyRound,
  note: StickyNote,
};

export default function RoadmapPage() {
  const toast = useToast();
  const { data: goals = [] } = useGoals();
  const { data: users = [] } = useUsers();
  const { data: projects = [] } = useProjects();
  const { data: clients = [] } = useClients();
  const move = useMoveGoal();
  const removeRes = useRemoveResource();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<GoalRow | null>(null);

  const lanes = useMemo(() => {
    const m: Record<string, GoalRow[]> = { backlog: [], 'in-progress': [], review: [], done: [] };
    for (const g of goals) m[g.status]?.push(g);
    return m;
  }, [goals]);

  const onDrop = async (status: string, e: React.DragEvent) => {
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    try {
      await move.mutateAsync({ id, status: status as GoalRow['status'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Move failed');
    }
  };

  const openCreate = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (g: GoalRow) => { setEditing(g); setModalOpen(true); };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="eyebrow">Roadmap</div>
          <h1 className="text-2xl font-bold text-gray-900">Q2 / Q3 goals</h1>
          <p className="text-sm text-gray-500">Drag goals across lanes; click a card to edit.</p>
        </div>
        <Button variant="primary" onClick={openCreate}><Plus className="w-4 h-4" /> New goal</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {STATUS_ORDER.map((status) => (
          <div
            key={status}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(status, e)}
            className="space-y-3"
          >
            <div className="flex items-center justify-between px-1">
              <div className="text-sm font-bold text-gray-900">{STATUS_LABEL[status]}</div>
              <span className="text-[11px] text-gray-400">{lanes[status]?.length ?? 0}</span>
            </div>
            <div className="space-y-2 min-h-[80px]">
              {(lanes[status] ?? []).map((g) => {
                const owner = users.find((u) => u.id === g.ownerId);
                const proj = projects.find((p) => p.id === g.projectId);
                const cli = proj ? clients.find((c) => c.id === proj.clientId) : null;
                const pri = PRIORITY_DOT[g.priority];
                return (
                  <Card
                    key={g.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', g.id)}
                    onClick={() => openEdit(g)}
                    className="p-3 cursor-pointer hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start gap-2">
                      <span className="w-2.5 h-2.5 mt-1.5 rounded-full shrink-0" style={{ backgroundColor: pri?.color }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-900">{g.title}</div>
                        <div className="text-[11px] text-gray-500">{cli?.name} · {proj?.name}</div>
                        <div className="mt-2 flex items-center gap-2">
                          <Pill tone="gray">{g.tag}</Pill>
                          {g.startDate && g.endDate && (
                            <span className="text-[11px] text-gray-500 tabular-nums">{g.startDate.slice(5)} → {g.endDate.slice(5)}</span>
                          )}
                        </div>
                        {g.resources.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {g.resources.slice(0, 4).map((r) => {
                              const Ic = KIND_ICON[r.kind as ResourceKind] ?? LinkIcon;
                              return (
                                <li key={r.id} className="flex items-center gap-1.5 text-[11px] text-gray-700">
                                  <Ic className="w-3 h-3 text-brand-600 shrink-0" />
                                  <span className="truncate">{r.title}</span>
                                  <button
                                    onClick={async (ev) => {
                                      ev.stopPropagation();
                                      try {
                                        await removeRes.mutateAsync({ goalId: g.id, resourceId: r.id });
                                        toast.success('Resource removed');
                                      } catch (e) {
                                        toast.error(e instanceof Error ? e.message : 'Failed');
                                      }
                                    }}
                                    className="ml-auto text-gray-300 hover:text-red-600"
                                    title="Remove"
                                  >×</button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                        <div className="mt-2 flex items-center justify-between">
                          <Avatar user={owner} size={20} />
                          <button
                            onClick={(ev) => { ev.stopPropagation(); openEdit(g); }}
                            className="text-[11px] text-brand-600 font-semibold hover:underline inline-flex items-center gap-1"
                          >
                            <Plus className="w-3 h-3" /> Resource
                          </button>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
              {(lanes[status] ?? []).length === 0 && (
                <div className="text-[11px] text-gray-400 px-2 py-3">Drop goals here.</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <GoalFormModal open={modalOpen} onClose={() => setModalOpen(false)} goal={editing} />
    </div>
  );
}
