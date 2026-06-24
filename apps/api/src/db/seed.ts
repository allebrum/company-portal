import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, sqlClient } from './client.js';
import { getServiceSupabase } from '../lib/supabase.js';
import {
  users,
  tenants,
  tenantMembers,
  groups,
  permissions,
  groupPermissions,
  userGroups,
  appSettings,
  oauthTokens,
  clients,
  projects,
  goals,
  goalResources,
  todos,
  timeEntries,
  payPeriods,
  payConfig,
  integrations,
  driveLinkedFolders,
  driveItems,
  activityLog,
} from './schema.js';
import {
  PERMISSIONS,
  PERMISSION_LABELS,
  PERMISSION_CATEGORIES,
  SYSTEM_GROUPS,
  SYSTEM_GROUP_PERMISSIONS,
} from '@modernzen/shared';

const DEFAULT_PASSWORD = 'ModernZen2026!';

// Helpers ported from data.jsx
function isoDayOffset(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}
function isoLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function clearAll(): Promise<void> {
  // Order matters due to FKs. Truncate with cascade keeps it simple.
  await db.execute(sql`
    truncate
      ${activityLog},
      ${driveItems},
      ${driveLinkedFolders},
      ${integrations},
      ${timeEntries},
      ${payConfig},
      ${payPeriods},
      ${goalResources},
      ${todos},
      ${goals},
      ${projects},
      ${clients},
      ${oauthTokens},
      ${appSettings},
      ${groupPermissions},
      ${userGroups},
      ${groups},
      ${permissions},
      ${tenantMembers},
      ${users},
      ${tenants}
    restart identity cascade
  `);
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[seed] clearing existing data...');
  await clearAll();

  // ---- Tenant (single demo workspace) ----
  const [tenant] = await db
    .insert(tenants)
    .values({ name: 'Demo Workspace', slug: 'demo', status: 'active' })
    .returning();
  const TENANT_ID = tenant!.id;

  // ---- Users ----
  // Identities live in Supabase Auth; the `users` profile row is keyed to the
  // auth uid (FK). Create each via the Admin API, then mirror the profile.
  const userSeeds = [
    { key: 'senica', name: 'Senica Gonzalez', initials: 'SG', group: 'Owner' as const, color: '#9333ea', email: 'senica@modernzen.com', billable: '225' },
    { key: 'marcus', name: 'Marcus Lee', initials: 'ML', group: 'Member' as const, color: '#2563eb', email: 'marcus@modernzen.com', billable: '185' },
    { key: 'priya', name: 'Priya Patel', initials: 'PP', group: 'Member' as const, color: '#0d9488', email: 'priya@modernzen.com', billable: '165' },
    { key: 'jordan', name: 'Jordan Reyes', initials: 'JR', group: 'Member' as const, color: '#db2777', email: 'jordan@modernzen.com', billable: '145' },
    { key: 'avery', name: 'Avery Chen', initials: 'AC', group: 'Member' as const, color: '#f97316', email: 'avery@modernzen.com', billable: '155' },
    { key: 'sam', name: 'Sam Okafor', initials: 'SO', group: 'Member' as const, color: '#22c55e', email: 'sam@modernzen.com', billable: '175' },
  ];
  const admin = getServiceSupabase().auth.admin;

  // Idempotent re-seed: drop any existing auth users for the seed emails first.
  const seedEmails = new Set(userSeeds.map((u) => u.email.toLowerCase()));
  const existingAuth = await admin.listUsers({ perPage: 1000 });
  for (const au of existingAuth.data?.users ?? []) {
    if (au.email && seedEmails.has(au.email.toLowerCase())) await admin.deleteUser(au.id);
  }

  const userIds: Record<string, string> = {};
  for (const u of userSeeds) {
    const created = await admin.createUser({
      email: u.email,
      password: DEFAULT_PASSWORD,
      email_confirm: true,
      user_metadata: { name: u.name },
    });
    if (created.error || !created.data.user) {
      throw new Error(`[seed] failed to create auth user ${u.email}: ${created.error?.message ?? 'unknown'}`);
    }
    const id = created.data.user.id;
    userIds[u.key] = id;
    await db.insert(users).values({
      id,
      name: u.name,
      email: u.email,
      initials: u.initials,
      color: u.color,
      billable: u.billable,
      status: 'active',
    });
  }

  // ---- RBAC: permission catalog, system groups, membership ----
  const categoryOf = (perm: string): string => {
    for (const [cat, perms] of Object.entries(PERMISSION_CATEGORIES)) {
      if ((perms as readonly string[]).includes(perm)) return cat;
    }
    return '';
  };
  await db.insert(permissions).values(
    PERMISSIONS.map((p) => ({ key: p, label: PERMISSION_LABELS[p], category: categoryOf(p) })),
  );
  const groupIds: Record<string, string> = {};
  for (const gname of SYSTEM_GROUPS) {
    const id = randomUUID();
    groupIds[gname] = id;
    await db.insert(groups).values({
      id,
      tenantId: TENANT_ID,
      name: gname,
      description: `${gname} (system group)`,
      isSystem: true,
      require2fa: false,
    });
    const perms = SYSTEM_GROUP_PERMISSIONS[gname];
    if (perms.length > 0) {
      await db.insert(groupPermissions).values(perms.map((p) => ({ groupId: id, permissionKey: p, tenantId: TENANT_ID })));
    }
  }
  for (const u of userSeeds) {
    await db.insert(userGroups).values({ userId: userIds[u.key]!, groupId: groupIds[u.group]!, tenantId: TENANT_ID });
  }

  // ---- Tenant membership: enroll every seeded user; first user is owner ----
  await db.insert(tenantMembers).values(
    userSeeds.map((u, i) => ({ tenantId: TENANT_ID, userId: userIds[u.key]!, isOwner: i === 0 })),
  );

  // ---- App settings (one row per tenant) ----
  await db.insert(appSettings).values({ tenantId: TENANT_ID });

  // ---- Clients ----
  const clientSeeds = [
    { key: 'cdt', name: 'CA Dept of Technology', kind: 'gov' as const, color: '#7e22ce' },
    { key: 'rsv', name: 'City of Roseville', kind: 'gov' as const, color: '#6b21a8' },
    { key: 'csus', name: 'Sacramento State', kind: 'edu' as const, color: '#2563eb' },
    { key: 'northpk', name: 'North Park Agency', kind: 'agency' as const, color: '#db2777' },
    { key: 'foothill', name: 'Foothill Credit Union', kind: 'finance' as const, color: '#0d9488' },
    { key: 'internal', name: 'Modern Zen (internal)', kind: 'internal' as const, color: '#4b5563' },
  ];
  const clientIds: Record<string, string> = {};
  for (const c of clientSeeds) {
    const id = randomUUID();
    clientIds[c.key] = id;
    await db.insert(clients).values({ id, tenantId: TENANT_ID, name: c.name, kind: c.kind, color: c.color });
  }

  // ---- Projects ----
  const projectSeeds = [
    { key: 'govgrants', clientKey: 'cdt', name: 'GovGrants Portal Modernization', code: 'GG-24', billable: true, budgetHrs: 480, color: '#9333ea' },
    { key: 'vendapi', clientKey: 'cdt', name: 'Vendor Onboarding API', code: 'VND-API', billable: true, budgetHrs: 200, color: '#7e22ce' },
    { key: 'pwdash', clientKey: 'rsv', name: 'Public Works Dashboard', code: 'PW-DASH', billable: true, budgetHrs: 320, color: '#2563eb' },
    { key: 'records', clientKey: 'csus', name: 'Student Records Integration', code: 'CSUS-SR', billable: true, budgetHrs: 240, color: '#0d9488' },
    { key: 'onboard', clientKey: 'northpk', name: 'Client Onboarding Tool', code: 'NP-ONB', billable: true, budgetHrs: 160, color: '#db2777' },
    { key: 'member', clientKey: 'foothill', name: 'Member Portal Refresh', code: 'FCU-MP', billable: true, budgetHrs: 280, color: '#22c55e' },
    { key: 'marketing', clientKey: 'internal', name: 'Modern Zen.com', code: 'INT-WEB', billable: false, budgetHrs: 60, color: '#6b7280' },
    { key: 'sales', clientKey: 'internal', name: 'Sales & proposals', code: 'INT-SAL', billable: false, budgetHrs: 80, color: '#9ca3af' },
  ];
  const projectIds: Record<string, string> = {};
  for (const p of projectSeeds) {
    const id = randomUUID();
    projectIds[p.key] = id;
    await db.insert(projects).values({
      id,
      tenantId: TENANT_ID,
      clientId: clientIds[p.clientKey]!,
      name: p.name,
      code: p.code,
      billable: p.billable,
      budgetHrs: p.budgetHrs,
      color: p.color,
    });
  }

  // ---- Pay periods ----
  const periodSeeds = [
    { key: '2026-04a', label: 'Apr 1 – Apr 15', start: '2026-04-01', end: '2026-04-15', cutoff: '2026-04-20', pay: '2026-04-22', status: 'closed' as const, closedAt: '2026-04-20T17:00:00Z' },
    { key: '2026-04b', label: 'Apr 16 – Apr 30', start: '2026-04-16', end: '2026-04-30', cutoff: '2026-05-05', pay: '2026-05-07', status: 'closed' as const, closedAt: '2026-05-05T17:00:00Z' },
    { key: '2026-05a', label: 'May 1 – May 15', start: '2026-05-01', end: '2026-05-15', cutoff: '2026-05-20', pay: '2026-05-22', status: 'review' as const, closedAt: null },
    { key: '2026-05b', label: 'May 16 – May 31', start: '2026-05-16', end: '2026-05-31', cutoff: '2026-06-05', pay: '2026-06-07', status: 'open' as const, closedAt: null },
    { key: '2026-06a', label: 'Jun 1 – Jun 15', start: '2026-06-01', end: '2026-06-15', cutoff: '2026-06-20', pay: '2026-06-22', status: 'open' as const, closedAt: null },
  ];
  const periodIds: Record<string, string> = {};
  for (const p of periodSeeds) {
    const id = randomUUID();
    periodIds[p.key] = id;
    await db.insert(payPeriods).values({
      id,
      tenantId: TENANT_ID,
      label: p.label,
      startDate: p.start,
      endDate: p.end,
      approvalCutoff: p.cutoff,
      payDate: p.pay,
      status: p.status,
      closedAt: p.closedAt,
    });
  }
  function periodForIso(iso: string): string | null {
    const d = iso.slice(0, 10);
    const match = periodSeeds.find((p) => d >= p.start && d <= p.end);
    return match ? periodIds[match.key]! : null;
  }

  // ---- Pay config ----
  await db.insert(payConfig).values({
    tenantId: TENANT_ID,
    cadence: 'by-date',
    payDates: [15, 'last'],
    weekendRule: 'prior',
    anchor: '2026-04-06',
    processingBufferDays: 5,
    autoClose: true,
    approverId: userIds.senica!,
  });

  // ---- Goals ----
  const goalSeeds = [
    { key: 'g1', title: 'Ship GovGrants v2 application flow', clientKey: 'cdt', projectKey: 'govgrants', status: 'in-progress' as const, ownerKey: 'marcus', start: '2026-04-06', end: '2026-06-12', priority: 'high' as const, tag: 'Delivery' },
    { key: 'g2', title: 'Vendor onboarding API → production', clientKey: 'cdt', projectKey: 'vendapi', status: 'review' as const, ownerKey: 'priya', start: '2026-04-20', end: '2026-05-22', priority: 'high' as const, tag: 'Delivery' },
    { key: 'g3', title: 'Roseville public-works pilot launch', clientKey: 'rsv', projectKey: 'pwdash', status: 'in-progress' as const, ownerKey: 'jordan', start: '2026-04-13', end: '2026-07-03', priority: 'medium' as const, tag: 'Delivery' },
    { key: 'g4', title: 'CSUS records import — round trip', clientKey: 'csus', projectKey: 'records', status: 'backlog' as const, ownerKey: 'marcus', start: '2026-05-25', end: '2026-08-14', priority: 'medium' as const, tag: 'Delivery' },
    { key: 'g5', title: 'North Park onboarding launch', clientKey: 'northpk', projectKey: 'onboard', status: 'done' as const, ownerKey: 'avery', start: '2026-03-02', end: '2026-04-30', priority: 'low' as const, tag: 'Delivery' },
    { key: 'g6', title: 'Foothill member portal redesign', clientKey: 'foothill', projectKey: 'member', status: 'in-progress' as const, ownerKey: 'avery', start: '2026-04-27', end: '2026-07-17', priority: 'high' as const, tag: 'Delivery' },
    { key: 'g7', title: 'SOC 2 Type II readiness', clientKey: 'internal', projectKey: 'sales', status: 'in-progress' as const, ownerKey: 'sam', start: '2026-04-01', end: '2026-09-30', priority: 'high' as const, tag: 'Ops' },
    { key: 'g8', title: 'Refresh Modern Zen.com case studies', clientKey: 'internal', projectKey: 'marketing', status: 'backlog' as const, ownerKey: 'avery', start: '2026-06-01', end: '2026-07-15', priority: 'low' as const, tag: 'Growth' },
    { key: 'g9', title: 'Hire 2nd full-stack engineer', clientKey: 'internal', projectKey: 'sales', status: 'review' as const, ownerKey: 'senica', start: '2026-04-15', end: '2026-06-30', priority: 'medium' as const, tag: 'Hiring' },
  ];
  const goalIds: Record<string, string> = {};
  for (const g of goalSeeds) {
    const id = randomUUID();
    goalIds[g.key] = id;
    await db.insert(goals).values({
      id,
      tenantId: TENANT_ID,
      clientId: clientIds[g.clientKey]!,
      projectId: projectIds[g.projectKey]!,
      title: g.title,
      status: g.status,
      ownerId: userIds[g.ownerKey]!,
      startDate: g.start,
      endDate: g.end,
      priority: g.priority,
      tag: g.tag,
    });
  }

  // ---- Goal resources ----
  const resources: Array<{
    goalKey: string;
    kind: 'figma' | 'drive-doc' | 'drive-folder' | 'drive-sheet' | 'link' | 'github' | 'note' | 'key';
    title: string;
    url: string;
    meta: string;
    addedByKey: string;
    addedAt: string;
  }> = [
    { goalKey: 'g1', kind: 'figma', title: 'GovGrants v2 — Figma file', url: 'https://figma.com/file/govgrants-v2', meta: '24 frames', addedByKey: 'avery', addedAt: '2026-04-10' },
    { goalKey: 'g1', kind: 'drive-doc', title: 'GovGrants v2 — PRD', url: 'drive://CDT/GovGrants/PRD', meta: '18 pages', addedByKey: 'jordan', addedAt: '2026-04-07' },
    { goalKey: 'g1', kind: 'drive-folder', title: 'CDT shared folder', url: 'drive://CDT', meta: '142 files', addedByKey: 'senica', addedAt: '2026-04-01' },
    { goalKey: 'g1', kind: 'link', title: 'CA contracting handbook §3', url: 'https://dgs.ca.gov/handbook#s3', meta: 'dgs.ca.gov', addedByKey: 'senica', addedAt: '2026-04-08' },
    { goalKey: 'g2', kind: 'github', title: 'Modern Zen/vendor-onboarding-api', url: 'https://github.com/Modern Zen/vendor-onboarding-api', meta: 'main · v0.9', addedByKey: 'marcus', addedAt: '2026-04-22' },
    { goalKey: 'g2', kind: 'drive-doc', title: 'API spec & test plan', url: 'drive://CDT/VendorAPI/spec', meta: '42 pages', addedByKey: 'priya', addedAt: '2026-04-25' },
    { goalKey: 'g3', kind: 'drive-sheet', title: 'Roseville stakeholder list', url: 'drive://Roseville/stakeholders', meta: '47 rows', addedByKey: 'jordan', addedAt: '2026-04-15' },
    { goalKey: 'g3', kind: 'note', title: 'Discovery interview notes', url: '', meta: '6 interviews', addedByKey: 'jordan', addedAt: '2026-04-20' },
    { goalKey: 'g5', kind: 'figma', title: 'NP — final UI', url: 'https://figma.com/file/northpark-final', meta: '38 frames', addedByKey: 'avery', addedAt: '2026-04-28' },
    { goalKey: 'g6', kind: 'figma', title: 'Foothill — desktop redesign', url: 'https://figma.com/file/foothill-desktop', meta: '52 frames', addedByKey: 'avery', addedAt: '2026-04-29' },
    { goalKey: 'g6', kind: 'drive-doc', title: 'Compliance checklist (FFIEC)', url: 'drive://Foothill/compliance', meta: '12 pages', addedByKey: 'senica', addedAt: '2026-05-02' },
    { goalKey: 'g7', kind: 'drive-folder', title: 'SOC2 evidence locker', url: 'drive://Internal/SOC2', meta: '89 files', addedByKey: 'sam', addedAt: '2026-04-01' },
    { goalKey: 'g9', kind: 'drive-doc', title: 'JD — Senior Full-Stack', url: 'drive://Internal/Hiring/JD', meta: '3 pages', addedByKey: 'senica', addedAt: '2026-04-15' },
    { goalKey: 'g9', kind: 'link', title: 'Interview rubric', url: 'https://Modern Zen.com/hiring/rubric', meta: 'internal', addedByKey: 'senica', addedAt: '2026-04-15' },
  ];
  for (const r of resources) {
    await db.insert(goalResources).values({
      tenantId: TENANT_ID,
      goalId: goalIds[r.goalKey]!,
      kind: r.kind,
      title: r.title,
      url: r.url,
      meta: r.meta,
      addedBy: userIds[r.addedByKey]!,
      addedAt: r.addedAt,
    });
  }

  // ---- Todos ----
  type TodoSeed = {
    title: string;
    assigneeKey: string;
    clientKey: string;
    projectKey: string;
    goalKey: string | null;
    status: 'open' | 'done';
    dueOffset: number;
    estimateMin: number;
    loggedMin: number;
    priority: 'low' | 'medium' | 'high';
    tags: string[];
    private: boolean;
  };
  const todoSeeds: TodoSeed[] = [
    { title: 'Wire grant-application step 4 → review queue', assigneeKey: 'marcus', clientKey: 'cdt', projectKey: 'govgrants', goalKey: 'g1', status: 'open', dueOffset: 0, estimateMin: 180, loggedMin: 95, priority: 'high', tags: ['frontend'], private: false },
    { title: 'QA pass — vendor onboarding happy-path', assigneeKey: 'priya', clientKey: 'cdt', projectKey: 'vendapi', goalKey: 'g2', status: 'open', dueOffset: 1, estimateMin: 120, loggedMin: 35, priority: 'high', tags: ['qa'], private: false },
    { title: 'Public-works map: fix tile-server CORS', assigneeKey: 'sam', clientKey: 'rsv', projectKey: 'pwdash', goalKey: 'g3', status: 'open', dueOffset: 2, estimateMin: 90, loggedMin: 0, priority: 'medium', tags: ['devops'], private: false },
    { title: 'CSUS data dictionary — kickoff doc', assigneeKey: 'jordan', clientKey: 'csus', projectKey: 'records', goalKey: 'g4', status: 'open', dueOffset: 3, estimateMin: 60, loggedMin: 0, priority: 'medium', tags: ['discovery'], private: false },
    { title: 'Foothill — login screen visual review', assigneeKey: 'avery', clientKey: 'foothill', projectKey: 'member', goalKey: 'g6', status: 'open', dueOffset: 0, estimateMin: 75, loggedMin: 40, priority: 'high', tags: ['design', 'review'], private: false },
    { title: 'North Park onboarding — postmortem doc', assigneeKey: 'jordan', clientKey: 'northpk', projectKey: 'onboard', goalKey: 'g5', status: 'open', dueOffset: 5, estimateMin: 90, loggedMin: 10, priority: 'low', tags: ['docs'], private: false },
    { title: 'SOC2: collect access-review evidence Q1', assigneeKey: 'sam', clientKey: 'internal', projectKey: 'sales', goalKey: 'g7', status: 'open', dueOffset: 4, estimateMin: 120, loggedMin: 0, priority: 'high', tags: ['security'], private: false },
    { title: 'Draft case study: North Park onboarding', assigneeKey: 'avery', clientKey: 'internal', projectKey: 'marketing', goalKey: 'g8', status: 'open', dueOffset: 7, estimateMin: 150, loggedMin: 0, priority: 'low', tags: ['marketing'], private: false },
    { title: 'GovGrants — accessibility audit fixes', assigneeKey: 'priya', clientKey: 'cdt', projectKey: 'govgrants', goalKey: 'g1', status: 'open', dueOffset: 2, estimateMin: 240, loggedMin: 60, priority: 'high', tags: ['a11y'], private: false },
    { title: 'Interview: Senior FS Eng. — round 2 (3 candidates)', assigneeKey: 'senica', clientKey: 'internal', projectKey: 'sales', goalKey: 'g9', status: 'open', dueOffset: 1, estimateMin: 180, loggedMin: 0, priority: 'medium', tags: ['hiring'], private: false },
    { title: 'Vendor API — write changelog + release notes', assigneeKey: 'marcus', clientKey: 'cdt', projectKey: 'vendapi', goalKey: 'g2', status: 'open', dueOffset: 0, estimateMin: 45, loggedMin: 0, priority: 'medium', tags: ['docs'], private: false },
    { title: 'Roseville stakeholder demo prep', assigneeKey: 'jordan', clientKey: 'rsv', projectKey: 'pwdash', goalKey: 'g3', status: 'open', dueOffset: 3, estimateMin: 90, loggedMin: 25, priority: 'medium', tags: ['client'], private: false },
    { title: 'Refactor auth middleware (shared)', assigneeKey: 'marcus', clientKey: 'internal', projectKey: 'sales', goalKey: null, status: 'done', dueOffset: -3, estimateMin: 120, loggedMin: 130, priority: 'low', tags: ['cleanup'], private: false },
    { title: 'Update SOW template — gov terms', assigneeKey: 'senica', clientKey: 'internal', projectKey: 'sales', goalKey: null, status: 'done', dueOffset: -5, estimateMin: 60, loggedMin: 75, priority: 'low', tags: ['ops'], private: false },
    { title: 'Block 90min for deep work on grant flow', assigneeKey: 'senica', clientKey: 'cdt', projectKey: 'govgrants', goalKey: null, status: 'open', dueOffset: 0, estimateMin: 90, loggedMin: 0, priority: 'high', tags: ['focus'], private: true },
    { title: 'Prep talking points for the Roseville call', assigneeKey: 'senica', clientKey: 'rsv', projectKey: 'pwdash', goalKey: 'g3', status: 'open', dueOffset: 2, estimateMin: 30, loggedMin: 0, priority: 'medium', tags: ['prep'], private: true },
    { title: 'Read: SOC2 evidence collection guide', assigneeKey: 'senica', clientKey: 'internal', projectKey: 'sales', goalKey: null, status: 'open', dueOffset: 4, estimateMin: 45, loggedMin: 0, priority: 'low', tags: ['learning'], private: true },
    { title: 'One-on-one prep — Marcus', assigneeKey: 'senica', clientKey: 'internal', projectKey: 'sales', goalKey: null, status: 'open', dueOffset: 1, estimateMin: 20, loggedMin: 0, priority: 'medium', tags: ['1:1'], private: true },
    { title: 'Refactor my dev environment', assigneeKey: 'marcus', clientKey: 'internal', projectKey: 'sales', goalKey: null, status: 'open', dueOffset: 6, estimateMin: 60, loggedMin: 0, priority: 'low', tags: ['personal'], private: true },
    { title: 'Watch new React 19 talk', assigneeKey: 'marcus', clientKey: 'internal', projectKey: 'sales', goalKey: null, status: 'open', dueOffset: 3, estimateMin: 45, loggedMin: 0, priority: 'low', tags: ['learning'], private: true },
  ];
  for (const t of todoSeeds) {
    await db.insert(todos).values({
      tenantId: TENANT_ID,
      title: t.title,
      assigneeId: userIds[t.assigneeKey]!,
      clientId: clientIds[t.clientKey]!,
      projectId: projectIds[t.projectKey]!,
      goalId: t.goalKey ? goalIds[t.goalKey]! : null,
      status: t.status,
      dueDate: isoDayOffset(t.dueOffset),
      estimateMin: t.estimateMin,
      loggedMin: t.loggedMin,
      priority: t.priority,
      tags: t.tags,
      private: t.private,
    });
  }

  // ---- Time entries (last 30 weekdays, like data.jsx makeEntries) ----
  const userKeys = ['senica', 'marcus', 'priya', 'jordan', 'avery', 'sam'] as const;
  const projKeys = ['govgrants', 'vendapi', 'pwdash', 'records', 'onboard', 'member', 'marketing', 'sales'];
  const tasks = [
    'Feature work', 'Bug fixes', 'Code review', 'Stakeholder call',
    'Design pass', 'QA & testing', 'Deployment', 'Sprint planning',
    'Docs & writeups', 'Discovery / research', 'Pair programming',
  ];
  let entryCounter = 1;
  const today = new Date();
  for (let d = 29; d >= 0; d--) {
    const dateObj = new Date(today);
    dateObj.setDate(today.getDate() - d);
    const iso = isoLocalDate(dateObj);
    const dow = dateObj.getDay();
    if (dow === 0 || dow === 6) continue; // skip weekends
    const ppId = periodForIso(iso);
    const ppStatus = periodSeeds.find((p) => iso >= p.start && iso <= p.end)?.status ?? 'open';
    for (const uk of userKeys) {
      const n = 2 + ((entryCounter + d) % 3);
      for (let i = 0; i < n; i++) {
        const projKey = projKeys[(entryCounter + i + d) % projKeys.length]!;
        const task = tasks[(entryCounter + i) % tasks.length]!;
        const duration = 30 + ((entryCounter * 17 + i * 23) % 7) * 25;
        const hour = 9 + i * 2;
        const startIso = `${iso}T${String(hour).padStart(2, '0')}:00:00Z`;
        const endIso = new Date(new Date(startIso).getTime() + duration * 60000).toISOString();
        let status: 'draft' | 'submitted' | 'approved';
        let submittedAt: string | null = null;
        let approvedAt: string | null = null;
        let approvedBy: string | null = null;
        if (ppStatus === 'closed') {
          status = 'approved';
          submittedAt = `${iso}T18:00:00Z`;
          approvedAt = `${iso}T20:00:00Z`;
          approvedBy = userIds.senica!;
        } else if (ppStatus === 'review') {
          status = (entryCounter + i) % 7 === 0 ? 'approved' : 'submitted';
          submittedAt = `${iso}T18:00:00Z`;
          if (status === 'approved') {
            approvedAt = `${iso}T20:00:00Z`;
            approvedBy = userIds.senica!;
          }
        } else {
          if (d <= 2) status = 'draft';
          else if (d <= 5) status = (entryCounter + i) % 3 === 0 ? 'draft' : 'submitted';
          else status = 'submitted';
          if (status === 'submitted') submittedAt = `${iso}T18:00:00Z`;
        }
        await db.insert(timeEntries).values({
          tenantId: TENANT_ID,
          userId: userIds[uk]!,
          projectId: projectIds[projKey]!,
          note: task,
          startIso,
          endIso,
          durationMin: duration,
          payPeriodId: ppId,
          status,
          submittedAt,
          approvedAt,
          approvedBy,
        });
        entryCounter++;
      }
    }
  }

  // ---- Integrations + Drive ----
  await db.insert(integrations).values({
    tenantId: TENANT_ID,
    kind: 'drive',
    connected: true,
    account: 'senica@Modern Zen.com',
    connectedAt: '2026-03-15',
    lastSyncAt: '2026-05-14T08:12:00Z',
    autoSync: true,
    syncIntervalHours: 4,
    config: {},
  });
  await db.insert(integrations).values({ tenantId: TENANT_ID, kind: 'github', connected: false, config: {} });
  await db.insert(integrations).values({ tenantId: TENANT_ID, kind: 'slack', connected: false, config: {} });
  await db.insert(integrations).values({ tenantId: TENANT_ID, kind: 'quickbooks', connected: false, config: {} });

  const folderSeeds = [
    { key: 'df1', drivePath: 'Modern Zen LLC / Clients / CDT', clientKey: 'cdt', itemCount: 142, lastSync: '2026-05-14T08:12:00Z' },
    { key: 'df2', drivePath: 'Modern Zen LLC / Clients / Roseville', clientKey: 'rsv', itemCount: 87, lastSync: '2026-05-14T08:12:00Z' },
    { key: 'df3', drivePath: 'Modern Zen LLC / Clients / Sac State', clientKey: 'csus', itemCount: 34, lastSync: '2026-05-13T16:30:00Z' },
    { key: 'df4', drivePath: 'Modern Zen LLC / Clients / Foothill CU', clientKey: 'foothill', itemCount: 56, lastSync: '2026-05-14T08:12:00Z' },
    { key: 'df5', drivePath: 'Modern Zen LLC / Internal', clientKey: 'internal', itemCount: 219, lastSync: '2026-05-14T08:12:00Z' },
  ];
  const folderIds: Record<string, string> = {};
  for (const f of folderSeeds) {
    const id = randomUUID();
    folderIds[f.key] = id;
    await db.insert(driveLinkedFolders).values({
      id,
      tenantId: TENANT_ID,
      drivePath: f.drivePath,
      clientId: clientIds[f.clientKey]!,
      itemCount: f.itemCount,
      lastSync: f.lastSync,
    });
  }

  const driveItemSeeds = [
    { folderKey: 'df1', kind: 'drive-doc' as const, title: 'GovGrants v2 — PRD', path: 'drive://CDT/GovGrants/PRD', meta: '18 pages', modified: '2026-05-12' },
    { folderKey: 'df1', kind: 'drive-doc' as const, title: 'CDT contract — fully executed', path: 'drive://CDT/contract', meta: '6 pages', modified: '2026-04-01' },
    { folderKey: 'df1', kind: 'drive-sheet' as const, title: 'Burn — GovGrants', path: 'drive://CDT/GovGrants/burn', meta: '142 rows', modified: '2026-05-13' },
    { folderKey: 'df1', kind: 'drive-doc' as const, title: 'API spec & test plan', path: 'drive://CDT/VendorAPI/spec', meta: '42 pages', modified: '2026-05-08' },
    { folderKey: 'df2', kind: 'drive-sheet' as const, title: 'Stakeholder list', path: 'drive://Roseville/stakeholders', meta: '47 rows', modified: '2026-04-15' },
    { folderKey: 'df2', kind: 'drive-doc' as const, title: 'PW Dashboard kickoff notes', path: 'drive://Roseville/kickoff', meta: '8 pages', modified: '2026-04-10' },
    { folderKey: 'df4', kind: 'drive-doc' as const, title: 'Compliance checklist (FFIEC)', path: 'drive://Foothill/compliance', meta: '12 pages', modified: '2026-05-02' },
    { folderKey: 'df5', kind: 'drive-folder' as const, title: 'SOC2 evidence locker', path: 'drive://Internal/SOC2', meta: '89 files', modified: '2026-05-14' },
    { folderKey: 'df5', kind: 'drive-doc' as const, title: 'JD — Senior Full-Stack', path: 'drive://Internal/Hiring/JD', meta: '3 pages', modified: '2026-04-15' },
    { folderKey: 'df5', kind: 'drive-doc' as const, title: 'Modern Zen SOW template (v3)', path: 'drive://Internal/Templates/SOW', meta: '4 pages', modified: '2026-03-22' },
  ];
  for (const it of driveItemSeeds) {
    await db.insert(driveItems).values({
      tenantId: TENANT_ID,
      folderId: folderIds[it.folderKey]!,
      kind: it.kind,
      title: it.title,
      path: it.path,
      meta: it.meta,
      modified: it.modified,
    });
  }

  // ---- Seed activity log ----
  const initialActivity = [
    { whoKey: 'marcus', kind: 'todo.done', target: 'Refactor auth middleware (shared)' },
    { whoKey: 'priya', kind: 'time.start', target: 'GovGrants Portal — QA pass' },
    { whoKey: 'avery', kind: 'goal.move', target: 'Foothill member portal redesign → in-progress' },
    { whoKey: 'senica', kind: 'user.invite', target: 'casey@Modern Zen.com invited as member' },
    { whoKey: 'jordan', kind: 'todo.assign', target: 'Roseville stakeholder demo prep → Jordan' },
  ];
  for (const a of initialActivity) {
    await db.insert(activityLog).values({
      tenantId: TENANT_ID,
      whoId: userIds[a.whoKey]!,
      kind: a.kind,
      target: a.target,
    });
  }

  // eslint-disable-next-line no-console
  console.log('[seed] done.');
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('  Seeded 6 users. Default password: ' + DEFAULT_PASSWORD);
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('  Logins:');
  for (const u of userSeeds) {
    // eslint-disable-next-line no-console
    console.log(`    ${u.email}  (${u.group})`);
  }
  // eslint-disable-next-line no-console
  console.log('');
}

main()
  .then(async () => {
    await sqlClient.end();
    process.exit(0);
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('[seed] failed', err);
    await sqlClient.end().catch(() => undefined);
    process.exit(1);
  });
