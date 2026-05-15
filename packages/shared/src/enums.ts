export const ROLES = ['owner', 'admin', 'member', 'bookkeeper'] as const;
export type Role = (typeof ROLES)[number];

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
