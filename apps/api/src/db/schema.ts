import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  ENTRY_STATUSES,
  PERIOD_STATUSES,
  GOAL_STATUSES,
  PRIORITIES,
  TODO_STATUSES,
  CLIENT_KINDS,
  RESOURCE_KINDS,
  CADENCES,
  WEEKEND_RULES,
} from '@allebrum/shared';

// ---- Enums ----
export const entryStatusEnum = pgEnum('entry_status', ENTRY_STATUSES);
export const periodStatusEnum = pgEnum('period_status', PERIOD_STATUSES);
export const goalStatusEnum = pgEnum('goal_status', GOAL_STATUSES);
export const priorityEnum = pgEnum('priority', PRIORITIES);
export const todoStatusEnum = pgEnum('todo_status', TODO_STATUSES);
export const clientKindEnum = pgEnum('client_kind', CLIENT_KINDS);
export const resourceKindEnum = pgEnum('resource_kind', RESOURCE_KINDS);
export const cadenceEnum = pgEnum('cadence', CADENCES);
export const weekendRuleEnum = pgEnum('weekend_rule', WEEKEND_RULES);
export const overrideEffectEnum = pgEnum('override_effect', ['grant', 'deny']);

const ts = () => timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull();
const updTs = () => timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull();

// ---- Users ----
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash'),
  googleSub: text('google_sub'),
  authProvider: text('auth_provider').notNull().default('password'),
  initials: text('initials').notNull().default(''),
  color: text('color').notNull().default('#6b7280'),
  billable: numeric('billable', { precision: 10, scale: 2 }).notNull().default('150'),
  status: text('status').notNull().default('active'),
  createdAt: ts(),
  updatedAt: updTs(),
}, (t) => ({
  emailIdx: uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`),
  googleSubIdx: uniqueIndex('users_google_sub_idx').on(t.googleSub),
}));

// ---- App settings (singleton) ----
export const appSettings = pgTable('app_settings', {
  id: text('id').primaryKey().default('singleton'),
  passwordLoginEnabled: boolean('password_login_enabled').notNull().default(true),
  googleLoginEnabled: boolean('google_login_enabled').notNull().default(true),
  allowedEmailDomains: text('allowed_email_domains').array().notNull().default(sql`'{}'::text[]`),
  bookkeeperEmail: text('bookkeeper_email'),
  sendToBookkeeperOn: text('send_to_bookkeeper_on').notNull().default('never'),
  updatedAt: updTs(),
});

// ---- OAuth tokens (per user/provider; reused by later Drive/Gmail scopes) ----
export const oauthTokens = pgTable('oauth_tokens', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  expiry: timestamp('expiry', { withTimezone: true, mode: 'string' }),
  updatedAt: updTs(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.provider] }),
}));

// ---- RBAC: permissions catalog, groups, membership, overrides ----
export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  category: text('category').notNull().default(''),
});

export const groups = pgTable('groups', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  isSystem: boolean('is_system').notNull().default(false),
  require2fa: boolean('require_2fa').notNull().default(false),
  createdAt: ts(),
  updatedAt: updTs(),
}, (t) => ({
  nameIdx: uniqueIndex('groups_name_lower_idx').on(sql`lower(${t.name})`),
}));

export const groupPermissions = pgTable('group_permissions', {
  groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  permissionKey: text('permission_key').notNull().references(() => permissions.key, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.groupId, t.permissionKey] }),
}));

export const userGroups = pgTable('user_groups', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.groupId] }),
}));

export const userPermissionOverrides = pgTable('user_permission_overrides', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  permissionKey: text('permission_key').notNull().references(() => permissions.key, { onDelete: 'cascade' }),
  effect: overrideEffectEnum('effect').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.permissionKey] }),
}));

// ---- Clients ----
export const clients = pgTable('clients', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  kind: clientKindEnum('kind').notNull().default('agency'),
  color: text('color').notNull().default('#7e22ce'),
  createdAt: ts(),
  updatedAt: updTs(),
});

// ---- Projects ----
export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  code: text('code').notNull().default(''),
  billable: boolean('billable').notNull().default(true),
  budgetHrs: integer('budget_hrs').notNull().default(120),
  color: text('color').notNull().default('#9333ea'),
  createdAt: ts(),
  updatedAt: updTs(),
}, (t) => ({
  clientIdx: index('projects_client_idx').on(t.clientId),
}));

// ---- Goals ----
export const goals = pgTable('goals', {
  id: uuid('id').defaultRandom().primaryKey(),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'restrict' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  title: text('title').notNull(),
  status: goalStatusEnum('status').notNull().default('backlog'),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  startDate: date('start_date'),
  endDate: date('end_date'),
  priority: priorityEnum('priority').notNull().default('medium'),
  tag: text('tag').notNull().default('Delivery'),
  createdAt: ts(),
  updatedAt: updTs(),
}, (t) => ({
  statusIdx: index('goals_status_idx').on(t.status),
  projectIdx: index('goals_project_idx').on(t.projectId),
}));

// ---- Goal resources ----
export const goalResources = pgTable('goal_resources', {
  id: uuid('id').defaultRandom().primaryKey(),
  goalId: uuid('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
  kind: resourceKindEnum('kind').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull().default(''),
  meta: text('meta').notNull().default(''),
  addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
  addedAt: date('added_at').notNull().defaultNow(),
}, (t) => ({
  goalIdx: index('goal_resources_goal_idx').on(t.goalId),
}));

// ---- Todos ----
export const todos = pgTable('todos', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  status: todoStatusEnum('status').notNull().default('open'),
  dueDate: date('due_date'),
  estimateMin: integer('estimate_min').notNull().default(60),
  loggedMin: integer('logged_min').notNull().default(0),
  priority: priorityEnum('priority').notNull().default('medium'),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  private: boolean('private').notNull().default(false),
  createdAt: ts(),
  updatedAt: updTs(),
}, (t) => ({
  assigneeIdx: index('todos_assignee_idx').on(t.assigneeId),
  statusIdx: index('todos_status_idx').on(t.status),
}));

// ---- Pay periods ----
export const payPeriods = pgTable('pay_periods', {
  id: uuid('id').defaultRandom().primaryKey(),
  label: text('label').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  approvalCutoff: date('approval_cutoff').notNull(),
  payDate: date('pay_date').notNull(),
  status: periodStatusEnum('status').notNull().default('open'),
  closedAt: timestamp('closed_at', { withTimezone: true, mode: 'string' }),
  createdAt: ts(),
  updatedAt: updTs(),
}, (t) => ({
  startEndUnique: uniqueIndex('pay_periods_start_end_unique').on(t.startDate, t.endDate),
}));

// ---- Pay config singleton ----
export const payConfig = pgTable('pay_config', {
  id: text('id').primaryKey().default('singleton'),
  cadence: cadenceEnum('cadence').notNull().default('by-date'),
  payDates: jsonb('pay_dates').notNull().default(sql`'[15, "last"]'::jsonb`),
  weekendRule: weekendRuleEnum('weekend_rule').notNull().default('prior'),
  anchor: date('anchor'),
  processingBufferDays: integer('processing_buffer_days').notNull().default(5),
  payDelayDays: integer('pay_delay_days').notNull().default(7),
  autoClose: boolean('auto_close').notNull().default(true),
  approverId: uuid('approver_id').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updTs(),
});

// ---- Time entries ----
export const timeEntries = pgTable('time_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  note: text('note').notNull().default(''),
  startIso: timestamp('start_iso', { withTimezone: true, mode: 'string' }).notNull(),
  endIso: timestamp('end_iso', { withTimezone: true, mode: 'string' }),
  durationMin: integer('duration_min').notNull(),
  payPeriodId: uuid('pay_period_id').references(() => payPeriods.id, { onDelete: 'set null' }),
  status: entryStatusEnum('status').notNull().default('draft'),
  submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'string' }),
  approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'string' }),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  rejectionNote: text('rejection_note'),
  todoId: uuid('todo_id').references(() => todos.id, { onDelete: 'set null' }),
  createdAt: ts(),
  updatedAt: updTs(),
}, (t) => ({
  userStartIdx: index('time_entries_user_start_idx').on(t.userId, t.startIso),
  periodStatusIdx: index('time_entries_period_status_idx').on(t.payPeriodId, t.status),
}));

// ---- Active timers (one per user) ----
export const activeTimers = pgTable('active_timers', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  note: text('note').notNull().default(''),
  todoId: uuid('todo_id').references(() => todos.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

// ---- Activity log ----
export const activityLog = pgTable('activity_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  whoId: uuid('who_id').references(() => users.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  target: text('target').notNull(),
  meta: jsonb('meta'),
  createdAt: ts(),
}, (t) => ({
  createdIdx: index('activity_created_idx').on(sql`${t.createdAt} DESC`),
}));

// ---- Integrations (1 row per kind) ----
export const integrations = pgTable('integrations', {
  kind: text('kind').primaryKey(),
  connected: boolean('connected').notNull().default(false),
  account: text('account'),
  connectedAt: date('connected_at'),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true, mode: 'string' }),
  autoSync: boolean('auto_sync').notNull().default(false),
  syncIntervalHours: integer('sync_interval_hours').notNull().default(4),
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  updatedAt: updTs(),
});

// ---- Drive folders ----
export const driveLinkedFolders = pgTable('drive_linked_folders', {
  id: uuid('id').defaultRandom().primaryKey(),
  drivePath: text('drive_path').notNull(),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  itemCount: integer('item_count').notNull().default(0),
  lastSync: timestamp('last_sync', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  createdAt: ts(),
});

export const driveItems = pgTable('drive_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  folderId: uuid('folder_id').notNull().references(() => driveLinkedFolders.id, { onDelete: 'cascade' }),
  kind: resourceKindEnum('kind').notNull(),
  title: text('title').notNull(),
  path: text('path').notNull(),
  meta: text('meta').notNull().default(''),
  modified: date('modified'),
});

// ---- Type exports ----
export type User = typeof users.$inferSelect;
export type AppSettingsRow = typeof appSettings.$inferSelect;
export type OAuthToken = typeof oauthTokens.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type GoalResource = typeof goalResources.$inferSelect;
export type Todo = typeof todos.$inferSelect;
export type PayPeriod = typeof payPeriods.$inferSelect;
export type PayConfig = typeof payConfig.$inferSelect;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type ActiveTimer = typeof activeTimers.$inferSelect;
export type ActivityRow = typeof activityLog.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type DriveFolder = typeof driveLinkedFolders.$inferSelect;
export type DriveItem = typeof driveItems.$inferSelect;
