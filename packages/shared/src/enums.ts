// ---- RBAC: granular permission catalog (replaces the old role enum) ----
export const PERMISSIONS = [
  'time_entry.create',
  'time_entry.view_own',
  'time_entry.view_all',
  'time_entry.edit',
  'time_entry.delete',
  'time_entry.submit',
  'time_entry.approve',
  'pay.manage',
  'users.manage',
  'groups.manage',
  'clients.manage',
  'projects.manage',
  'goals.manage',
  'integrations.manage',
  'media.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_CATEGORIES: Record<string, Permission[]> = {
  'Time entries': [
    'time_entry.create',
    'time_entry.view_own',
    'time_entry.view_all',
    'time_entry.edit',
    'time_entry.delete',
    'time_entry.submit',
    'time_entry.approve',
  ],
  Payroll: ['pay.manage'],
  People: ['users.manage', 'groups.manage'],
  Workspace: ['clients.manage', 'projects.manage', 'goals.manage', 'integrations.manage', 'media.manage'],
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  'time_entry.create': 'Create time entries',
  'time_entry.view_own': 'View own time entries',
  'time_entry.view_all': "View everyone's time entries",
  'time_entry.edit': 'Edit any time entry',
  'time_entry.delete': 'Delete any time entry',
  'time_entry.submit': 'Submit time for approval',
  'time_entry.approve': 'Approve / reject / reopen time',
  'pay.manage': 'Manage pay periods & pay config',
  'users.manage': 'Invite, edit, remove users',
  'groups.manage': 'Manage groups & permissions',
  'clients.manage': 'Create / edit clients',
  'projects.manage': 'Create / edit projects',
  'goals.manage': 'Manage roadmap goals',
  'integrations.manage': 'Manage integrations',
  'media.manage': 'Manage media / Drive',
};

// Built-in starter groups (seeded; users get mapped onto these).
export const SYSTEM_GROUPS = ['Owner', 'Admin', 'Bookkeeper', 'Member'] as const;
export type SystemGroup = (typeof SYSTEM_GROUPS)[number];

export const SYSTEM_GROUP_PERMISSIONS: Record<SystemGroup, Permission[]> = {
  Owner: [...PERMISSIONS],
  Admin: PERMISSIONS.filter((p) => p !== 'groups.manage'),
  Bookkeeper: ['time_entry.view_all', 'pay.manage'],
  Member: ['time_entry.create', 'time_entry.view_own', 'time_entry.submit', 'goals.manage'],
};

export const ENTRY_STATUSES = ['draft', 'submitted', 'approved', 'rejected'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const PERIOD_STATUSES = ['open', 'review', 'closed'] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

export const GOAL_STATUSES = ['backlog', 'in-progress', 'review', 'done'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const PRIORITIES = ['low', 'medium', 'high'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TODO_STATUSES = ['open', 'done'] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export const CLIENT_KINDS = ['gov', 'edu', 'agency', 'finance', 'internal'] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

export const RESOURCE_KINDS = [
  'drive-folder',
  'drive-doc',
  'drive-sheet',
  'figma',
  'github',
  'link',
  'key',
  'note',
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const CADENCES = ['by-date', 'weekly', 'bi-weekly'] as const;
export type Cadence = (typeof CADENCES)[number];

export const WEEKEND_RULES = ['prior', 'after', 'as-is'] as const;
export type WeekendRule = (typeof WEEKEND_RULES)[number];

export const INTEGRATION_KINDS = ['drive', 'github', 'slack', 'quickbooks'] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

// ---- PM workspace ----
export const HEALTHS = ['on-track', 'at-risk', 'off-track', 'done'] as const;
export type Health = (typeof HEALTHS)[number];

export const MILESTONE_KINDS = ['release', 'review', 'deadline', 'phase'] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export const STATUS_TONES = ['gray', 'purple', 'amber', 'green', 'blue', 'orange', 'red', 'teal', 'pink'] as const;
export type StatusTone = (typeof STATUS_TONES)[number];
