import type {
  GoalRow, ClientRow, ProjectRow, UserRow, TodoRow, EpicRow, MilestoneRow,
} from '@/hooks/useResources';
import type { Scope, ColorBy } from '@/lib/roadmap';

export type Tweaks = {
  density: 'compact' | 'comfortable';
  colorBy: ColorBy;
  showDone: boolean;
  showDependencies: boolean;
  showMilestones: boolean;
  groupByKanban: 'status' | 'owner' | 'priority' | 'epic' | 'client';
};

export const DEFAULT_TWEAKS: Tweaks = {
  density: 'comfortable',
  colorBy: 'status',
  showDone: true,
  showDependencies: true,
  showMilestones: true,
  groupByKanban: 'status',
};

/** Shared context every roadmap view receives. */
export type ViewProps = {
  goals: GoalRow[];
  clients: ClientRow[];
  projects: ProjectRow[];
  users: UserRow[];
  todos: TodoRow[];
  epics: EpicRow[];
  milestones: MilestoneRow[];
  scope: Scope;
  tw: Tweaks;
  onOpenGoal: (g: GoalRow) => void;
};
