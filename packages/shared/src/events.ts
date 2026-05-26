export const EV = {
  // users
  USER_CREATED: 'user:created',
  USER_UPDATED: 'user:updated',
  USER_DELETED: 'user:deleted',
  // rbac + settings
  GROUP_UPDATED: 'group:updated',
  SETTINGS_UPDATED: 'settings:updated',
  // clients / projects
  CLIENT_CREATED: 'client:created',
  CLIENT_UPDATED: 'client:updated',
  PROJECT_CREATED: 'project:created',
  PROJECT_UPDATED: 'project:updated',
  // goals
  GOAL_CREATED: 'goal:created',
  GOAL_UPDATED: 'goal:updated',
  GOAL_MOVED: 'goal:moved',
  GOAL_RESOURCE_ADDED: 'goal:resource-added',
  GOAL_RESOURCE_REMOVED: 'goal:resource-removed',
  // todos
  TODO_CREATED: 'todo:created',
  TODO_UPDATED: 'todo:updated',
  TODO_DELETED: 'todo:deleted',
  // entries
  ENTRY_CREATED: 'entry:created',
  ENTRY_UPDATED: 'entry:updated',
  ENTRY_DELETED: 'entry:deleted',
  ENTRY_SUBMITTED: 'entry:submitted',
  ENTRY_APPROVED: 'entry:approved',
  ENTRY_REJECTED: 'entry:rejected',
  ENTRY_REOPENED: 'entry:reopened',
  // timer
  TIMER_STARTED: 'timer:started',
  TIMER_STOPPED: 'timer:stopped',
  // pay periods + config
  PAY_PERIOD_GENERATED: 'pay-period:generated',
  PAY_PERIOD_UPDATED: 'pay-period:updated',
  PAY_PERIOD_CLOSED: 'pay-period:closed',
  PAY_CONFIG_UPDATED: 'pay-config:updated',
  // integrations
  INTEGRATION_UPDATED: 'integration:updated',
  DRIVE_FOLDER_LINKED: 'drive-folder:linked',
  DRIVE_FOLDER_UNLINKED: 'drive-folder:unlinked',
  // activity (embeds full row)
  ACTIVITY_APPENDED: 'activity:appended',
} as const;

export type EventName = (typeof EV)[keyof typeof EV];

export type IdPayload = { id: string; by?: string | null; at: string };

export type TimerPayload = {
  userId: string;
  // Nullable: timers may run against a to-do that has no project, or with
  // no to-do at all. UIs that show "Tracking · {client/project}" must
  // gracefully render when this is null.
  projectId: string | null;
  todoId: string | null;
  note: string;
  startedAt: string;
  /** Set when the timer was started from a Notes-canvas /timer block —
   *  lets the block render its own running state without note-matching. */
  spaceBlockId?: string | null;
};

export type ActivityPayload = {
  id: string;
  whoId: string | null;
  kind: string;
  target: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

// Client → Server events (room management)
export interface ClientToServerEvents {
  'room:join': (roomId: string) => void;
  'room:leave': (roomId: string) => void;
}

// Server → Client events (subscribe-side)
export interface ServerToClientEvents {
  [EV.USER_CREATED]: (p: IdPayload) => void;
  [EV.USER_UPDATED]: (p: IdPayload) => void;
  [EV.USER_DELETED]: (p: IdPayload) => void;
  [EV.GROUP_UPDATED]: (p: IdPayload) => void;
  [EV.SETTINGS_UPDATED]: (p: IdPayload) => void;
  [EV.CLIENT_CREATED]: (p: IdPayload) => void;
  [EV.CLIENT_UPDATED]: (p: IdPayload) => void;
  [EV.PROJECT_CREATED]: (p: IdPayload) => void;
  [EV.PROJECT_UPDATED]: (p: IdPayload) => void;
  [EV.GOAL_CREATED]: (p: IdPayload) => void;
  [EV.GOAL_UPDATED]: (p: IdPayload) => void;
  [EV.GOAL_MOVED]: (p: IdPayload) => void;
  [EV.GOAL_RESOURCE_ADDED]: (p: IdPayload) => void;
  [EV.GOAL_RESOURCE_REMOVED]: (p: IdPayload) => void;
  [EV.TODO_CREATED]: (p: IdPayload) => void;
  [EV.TODO_UPDATED]: (p: IdPayload) => void;
  [EV.TODO_DELETED]: (p: IdPayload) => void;
  [EV.ENTRY_CREATED]: (p: IdPayload) => void;
  [EV.ENTRY_UPDATED]: (p: IdPayload) => void;
  [EV.ENTRY_DELETED]: (p: IdPayload) => void;
  [EV.ENTRY_SUBMITTED]: (p: IdPayload & { count: number }) => void;
  [EV.ENTRY_APPROVED]: (p: IdPayload & { count: number }) => void;
  [EV.ENTRY_REJECTED]: (p: IdPayload & { count: number }) => void;
  [EV.ENTRY_REOPENED]: (p: IdPayload & { count: number }) => void;
  [EV.TIMER_STARTED]: (p: TimerPayload) => void;
  [EV.TIMER_STOPPED]: (p: TimerPayload & { durationMin: number; entryId: string }) => void;
  [EV.PAY_PERIOD_GENERATED]: (p: IdPayload & { count: number }) => void;
  [EV.PAY_PERIOD_UPDATED]: (p: IdPayload) => void;
  [EV.PAY_PERIOD_CLOSED]: (p: IdPayload) => void;
  [EV.PAY_CONFIG_UPDATED]: (p: IdPayload) => void;
  [EV.INTEGRATION_UPDATED]: (p: IdPayload & { kind: string }) => void;
  [EV.DRIVE_FOLDER_LINKED]: (p: IdPayload) => void;
  [EV.DRIVE_FOLDER_UNLINKED]: (p: IdPayload) => void;
  [EV.ACTIVITY_APPENDED]: (p: ActivityPayload) => void;
}
