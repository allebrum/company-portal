import type {
  GoalRow,
  ProjectRow,
  ClientRow,
  UserRow,
  TodoRow,
  ProjectStatusRow,
} from '@/hooks/useResources';
import { PRIORITY_DOT } from '@/lib/formatters';

// ---------- scope ----------
export type Scope =
  | { kind: 'all' }
  | { kind: 'client'; id: string }
  | { kind: 'project'; id: string };

// ---------- time ----------
export const startOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
export const dayDiff = (a: Date, b: Date): number =>
  Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
export const monthLabel = (d: Date): string =>
  d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
export const dateMD = (d: Date): string =>
  d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
/** Parse a YYYY-MM-DD string to a local-midnight Date (always returns a Date). */
export const parseLocalDate = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};

// ---------- tone palette ----------
type Tone = ProjectStatusRow['tone'];
const TONE_COLOR: Record<string, string> = {
  gray: '#9ca3af', purple: '#9333ea', amber: '#d97706', green: '#16a34a',
  blue: '#2563eb', orange: '#ea580c', red: '#dc2626', teal: '#0d9488', pink: '#db2777',
};
const TONE_BG: Record<string, string> = {
  gray: '#f3f4f6', purple: '#f3e8ff', amber: '#fef3c7', green: '#dcfce7',
  blue: '#dbeafe', orange: '#ffedd5', red: '#fee2e2', teal: '#ccfbf1', pink: '#fce7f3',
};
export const toneColor = (tone: Tone | string): string => TONE_COLOR[tone] ?? TONE_COLOR.gray!;
export const toneBg = (tone: Tone | string): string => TONE_BG[tone] ?? TONE_BG.gray!;

// ---------- health ----------
export const HEALTH_TONE: Record<string, { color: string; label: string }> = {
  'on-track': { color: '#16a34a', label: 'On track' },
  'at-risk': { color: '#d97706', label: 'At risk' },
  'off-track': { color: '#dc2626', label: 'Off track' },
  done: { color: '#0ea5e9', label: 'Shipped' },
};

// ---------- default status workflow ----------
export const DEFAULT_STATUSES: ProjectStatusRow[] = [
  { id: 'backlog', label: 'Backlog', tone: 'gray' },
  { id: 'in-progress', label: 'In progress', tone: 'purple' },
  { id: 'review', label: 'In review', tone: 'amber' },
  { id: 'done', label: 'Shipped', tone: 'green' },
];

/** Active workflow for a scope: a project's custom statuses if scoped to a
 *  project that defines them; otherwise the default 4. */
export function statusesForScope(scope: Scope, projects: ProjectRow[]): ProjectStatusRow[] {
  if (scope.kind === 'project') {
    const p = projects.find((x) => x.id === scope.id);
    if (p?.statuses && p.statuses.length > 0) return p.statuses;
  }
  return DEFAULT_STATUSES;
}

/** Map any goal status (incl. custom-workflow values from other projects)
 *  onto one of the active statuses. Pure render-time mapping; never mutates
 *  goal data. */
export function bucketStatus(goalStatus: string, activeStatuses: ProjectStatusRow[]): string {
  if (activeStatuses.some((s) => s.id === goalStatus)) return goalStatus;
  const id = (want: string) => activeStatuses.find((s) => s.id === want)?.id;
  const lower = goalStatus.toLowerCase();
  const inProgress = ['in-progress', 'design', 'build', 'dev', 'discovery', 'planning', 'doing'];
  const review = ['review', 'qa', 'compliance', 'staging', 'test', 'testing'];
  const done = ['done', 'shipped', 'launch', 'launched', 'complete', 'closed'];
  if (inProgress.includes(lower)) return id('in-progress') ?? activeStatuses[1]?.id ?? activeStatuses[0]!.id;
  if (review.includes(lower)) return id('review') ?? activeStatuses[2]?.id ?? activeStatuses[activeStatuses.length - 1]!.id;
  if (done.includes(lower)) return id('done') ?? activeStatuses[activeStatuses.length - 1]!.id;
  return id('backlog') ?? activeStatuses[0]!.id;
}

// ---------- progress ----------
/** Manual progress override if set; else rolled up from linked to-dos. */
export function rollupProgress(goal: GoalRow, todos: TodoRow[]): number {
  if (typeof goal.progress === 'number') return goal.progress;
  const linked = todos.filter((t) => t.goalId === goal.id);
  if (linked.length === 0) return 0;
  const done = linked.filter((t) => t.status === 'done').length;
  return Math.round((done / linked.length) * 100);
}

// ---------- accent color ----------
export type ColorBy = 'status' | 'priority' | 'owner' | 'client' | 'health';

export function goalAccent(
  goal: GoalRow,
  colorBy: ColorBy,
  ctx: { clients: ClientRow[]; users: UserRow[]; projects: ProjectRow[] },
): string {
  switch (colorBy) {
    case 'priority':
      return PRIORITY_DOT[goal.priority]?.color ?? TONE_COLOR.gray!;
    case 'owner':
      return ctx.users.find((u) => u.id === goal.ownerId)?.color ?? TONE_COLOR.gray!;
    case 'client':
      return ctx.clients.find((c) => c.id === goal.clientId)?.color ?? TONE_COLOR.gray!;
    case 'health':
      return goal.health ? HEALTH_TONE[goal.health]?.color ?? TONE_COLOR.gray! : TONE_COLOR.gray!;
    case 'status':
    default: {
      // Workspace goals (null project) fall back to the default workflow.
      const active = statusesForScope({ kind: 'project', id: goal.projectId ?? '' }, ctx.projects);
      const bucket = bucketStatus(goal.status, active);
      const tone = active.find((s) => s.id === bucket)?.tone ?? 'gray';
      return toneColor(tone);
    }
  }
}
