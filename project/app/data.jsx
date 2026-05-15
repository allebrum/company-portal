/* global React */
// Allebrum portal — sample data + helpers

// --- Users ---
const SEED_USERS = [
  { id: 'u-senica',  name: 'Senica Gonzalez', initials: 'SG', role: 'Owner',    color: '#9333ea', email: 'senica@allebrum.com',   billable: 225 },
  { id: 'u-marcus',  name: 'Marcus Lee',      initials: 'ML', role: 'Senior Engineer', color: '#2563eb', email: 'marcus@allebrum.com', billable: 185 },
  { id: 'u-priya',   name: 'Priya Patel',     initials: 'PP', role: 'Engineer', color: '#0d9488', email: 'priya@allebrum.com',  billable: 165 },
  { id: 'u-jordan',  name: 'Jordan Reyes',    initials: 'JR', role: 'Project Manager', color: '#db2777', email: 'jordan@allebrum.com', billable: 145 },
  { id: 'u-avery',   name: 'Avery Chen',      initials: 'AC', role: 'Designer', color: '#f97316', email: 'avery@allebrum.com',  billable: 155 },
  { id: 'u-sam',     name: 'Sam Okafor',      initials: 'SO', role: 'DevOps',   color: '#22c55e', email: 'sam@allebrum.com',    billable: 175 },
];

// --- Clients & Projects ---
const SEED_CLIENTS = [
  { id: 'c-cdt',     name: 'CA Dept of Technology', kind: 'gov',     color: '#7e22ce' },
  { id: 'c-rsv',     name: 'City of Roseville',      kind: 'gov',     color: '#6b21a8' },
  { id: 'c-csus',    name: 'Sacramento State',       kind: 'edu',     color: '#2563eb' },
  { id: 'c-northpk', name: 'North Park Agency',      kind: 'agency',  color: '#db2777' },
  { id: 'c-foothill',name: 'Foothill Credit Union',  kind: 'finance', color: '#0d9488' },
  { id: 'c-internal',name: 'Allebrum (internal)',    kind: 'internal',color: '#4b5563' },
];

const SEED_PROJECTS = [
  { id: 'p-govgrants',  clientId: 'c-cdt',     name: 'GovGrants Portal Modernization', code: 'GG-24',   billable: true,  budgetHrs: 480, color: '#9333ea' },
  { id: 'p-vendapi',    clientId: 'c-cdt',     name: 'Vendor Onboarding API',           code: 'VND-API', billable: true,  budgetHrs: 200, color: '#7e22ce' },
  { id: 'p-pwdash',     clientId: 'c-rsv',     name: 'Public Works Dashboard',          code: 'PW-DASH', billable: true,  budgetHrs: 320, color: '#2563eb' },
  { id: 'p-records',    clientId: 'c-csus',    name: 'Student Records Integration',     code: 'CSUS-SR', billable: true,  budgetHrs: 240, color: '#0d9488' },
  { id: 'p-onboard',    clientId: 'c-northpk', name: 'Client Onboarding Tool',          code: 'NP-ONB',  billable: true,  budgetHrs: 160, color: '#db2777' },
  { id: 'p-member',     clientId: 'c-foothill',name: 'Member Portal Refresh',           code: 'FCU-MP',  billable: true,  budgetHrs: 280, color: '#22c55e' },
  { id: 'p-marketing',  clientId: 'c-internal',name: 'Allebrum.com',                    code: 'INT-WEB', billable: false, budgetHrs: 60,  color: '#6b7280' },
  { id: 'p-sales',      clientId: 'c-internal',name: 'Sales & proposals',               code: 'INT-SAL', billable: false, budgetHrs: 80,  color: '#9ca3af' },
];

// --- Roadmap goals (Q2 / Q3 2026) ---
// status: backlog | in-progress | review | done
const SEED_GOALS = [
  { id: 'g-1', title: 'Ship GovGrants v2 application flow', clientId: 'c-cdt',     projectId: 'p-govgrants', status: 'in-progress', owner: 'u-marcus', start: '2026-04-06', end: '2026-06-12', priority: 'high',   tag: 'Delivery',
    resources: [
      { id: 'r-1', kind: 'figma',  title: 'GovGrants v2 — Figma file',         url: 'https://figma.com/file/govgrants-v2', addedBy: 'u-avery',  addedAt: '2026-04-10', meta: '24 frames' },
      { id: 'r-2', kind: 'drive-doc', title: 'GovGrants v2 — PRD',             url: 'drive://CDT/GovGrants/PRD',           addedBy: 'u-jordan', addedAt: '2026-04-07', meta: '18 pages' },
      { id: 'r-3', kind: 'drive-folder', title: 'CDT shared folder',           url: 'drive://CDT',                          addedBy: 'u-senica', addedAt: '2026-04-01', meta: '142 files' },
      { id: 'r-4', kind: 'link',   title: 'CA contracting handbook §3',         url: 'https://dgs.ca.gov/handbook#s3',       addedBy: 'u-senica', addedAt: '2026-04-08', meta: 'dgs.ca.gov' },
    ],
  },
  { id: 'g-2', title: 'Vendor onboarding API → production',  clientId: 'c-cdt',     projectId: 'p-vendapi',   status: 'review',      owner: 'u-priya',  start: '2026-04-20', end: '2026-05-22', priority: 'high',   tag: 'Delivery',
    resources: [
      { id: 'r-5', kind: 'github', title: 'allebrum/vendor-onboarding-api',     url: 'https://github.com/allebrum/vendor-onboarding-api', addedBy: 'u-marcus', addedAt: '2026-04-22', meta: 'main · v0.9' },
      { id: 'r-6', kind: 'drive-doc', title: 'API spec & test plan',            url: 'drive://CDT/VendorAPI/spec',           addedBy: 'u-priya',  addedAt: '2026-04-25', meta: '42 pages' },
    ],
  },
  { id: 'g-3', title: 'Roseville public-works pilot launch', clientId: 'c-rsv',     projectId: 'p-pwdash',    status: 'in-progress', owner: 'u-jordan', start: '2026-04-13', end: '2026-07-03', priority: 'medium', tag: 'Delivery',
    resources: [
      { id: 'r-7', kind: 'drive-sheet', title: 'Roseville stakeholder list',    url: 'drive://Roseville/stakeholders',       addedBy: 'u-jordan', addedAt: '2026-04-15', meta: '47 rows' },
      { id: 'r-8', kind: 'note',   title: 'Discovery interview notes',          url: '',                                     addedBy: 'u-jordan', addedAt: '2026-04-20', meta: '6 interviews' },
    ],
  },
  { id: 'g-4', title: 'CSUS records import — round trip',    clientId: 'c-csus',    projectId: 'p-records',   status: 'backlog',     owner: 'u-marcus', start: '2026-05-25', end: '2026-08-14', priority: 'medium', tag: 'Delivery',
    resources: [],
  },
  { id: 'g-5', title: 'North Park onboarding launch',        clientId: 'c-northpk', projectId: 'p-onboard',   status: 'done',        owner: 'u-avery',  start: '2026-03-02', end: '2026-04-30', priority: 'low',    tag: 'Delivery',
    resources: [
      { id: 'r-9', kind: 'figma',  title: 'NP — final UI',                       url: 'https://figma.com/file/northpark-final', addedBy: 'u-avery', addedAt: '2026-04-28', meta: '38 frames' },
    ],
  },
  { id: 'g-6', title: 'Foothill member portal redesign',     clientId: 'c-foothill',projectId: 'p-member',    status: 'in-progress', owner: 'u-avery',  start: '2026-04-27', end: '2026-07-17', priority: 'high',   tag: 'Delivery',
    resources: [
      { id: 'r-10', kind: 'figma',     title: 'Foothill — desktop redesign',      url: 'https://figma.com/file/foothill-desktop', addedBy: 'u-avery', addedAt: '2026-04-29', meta: '52 frames' },
      { id: 'r-11', kind: 'drive-doc', title: 'Compliance checklist (FFIEC)',     url: 'drive://Foothill/compliance',            addedBy: 'u-senica', addedAt: '2026-05-02', meta: '12 pages' },
    ],
  },
  { id: 'g-7', title: 'SOC 2 Type II readiness',             clientId: 'c-internal',projectId: 'p-sales',     status: 'in-progress', owner: 'u-sam',    start: '2026-04-01', end: '2026-09-30', priority: 'high',   tag: 'Ops',
    resources: [
      { id: 'r-12', kind: 'drive-folder', title: 'SOC2 evidence locker',          url: 'drive://Internal/SOC2',                 addedBy: 'u-sam',   addedAt: '2026-04-01', meta: '89 files' },
    ],
  },
  { id: 'g-8', title: 'Refresh allebrum.com case studies',   clientId: 'c-internal',projectId: 'p-marketing', status: 'backlog',     owner: 'u-avery',  start: '2026-06-01', end: '2026-07-15', priority: 'low',    tag: 'Growth', resources: [] },
  { id: 'g-9', title: 'Hire 2nd full-stack engineer',        clientId: 'c-internal',projectId: 'p-sales',     status: 'review',      owner: 'u-senica', start: '2026-04-15', end: '2026-06-30', priority: 'medium', tag: 'Hiring', resources: [
      { id: 'r-13', kind: 'drive-doc', title: 'JD — Senior Full-Stack',           url: 'drive://Internal/Hiring/JD',            addedBy: 'u-senica', addedAt: '2026-04-15', meta: '3 pages' },
      { id: 'r-14', kind: 'link',      title: 'Interview rubric',                 url: 'https://allebrum.com/hiring/rubric',     addedBy: 'u-senica', addedAt: '2026-04-15', meta: 'internal' },
    ] },
];

// --- Resource type config (for icons + colors) ---
const RESOURCE_TYPES = {
  'drive-folder': { label: 'Drive folder', icon: 'folder',    color: '#0d9488' },
  'drive-doc':    { label: 'Google Doc',   icon: 'edit',      color: '#2563eb' },
  'drive-sheet':  { label: 'Google Sheet', icon: 'grid',      color: '#22c55e' },
  'figma':        { label: 'Figma',        icon: 'edit',      color: '#db2777' },
  'github':       { label: 'GitHub',       icon: 'code',      color: '#111827' },
  'link':         { label: 'Web link',     icon: 'link',      color: '#7e22ce' },
  'key':          { label: 'Encrypted key', icon: 'shield',    color: '#dc2626' },
  'note':         { label: 'Note',         icon: 'list',      color: '#9ca3af' },
};

// --- Google Drive integration (mock) ---
const SEED_INTEGRATIONS = {
  drive: {
    connected: true,
    account: 'senica@allebrum.com',
    connectedAt: '2026-03-15',
    lastSyncAt: '2026-05-14T08:12:00Z',
    autoSync: true,
    syncIntervalHours: 4,
    // folders indexed and linked to clients
    linkedFolders: [
      { id: 'df-1', drivePath: 'Allebrum LLC / Clients / CDT',         clientId: 'c-cdt',     itemCount: 142, lastSync: '2026-05-14T08:12:00Z' },
      { id: 'df-2', drivePath: 'Allebrum LLC / Clients / Roseville',   clientId: 'c-rsv',     itemCount: 87,  lastSync: '2026-05-14T08:12:00Z' },
      { id: 'df-3', drivePath: 'Allebrum LLC / Clients / Sac State',   clientId: 'c-csus',    itemCount: 34,  lastSync: '2026-05-13T16:30:00Z' },
      { id: 'df-4', drivePath: 'Allebrum LLC / Clients / Foothill CU', clientId: 'c-foothill',itemCount: 56,  lastSync: '2026-05-14T08:12:00Z' },
      { id: 'df-5', drivePath: 'Allebrum LLC / Internal',              clientId: 'c-internal',itemCount: 219, lastSync: '2026-05-14T08:12:00Z' },
    ],
  },
  github: { connected: false },
  slack:  { connected: false },
  quickbooks: { connected: false },
};

// Mock drive items used by the resource picker — flat list, filterable
const SEED_DRIVE_ITEMS = [
  { id: 'di-1', folderId: 'df-1', kind: 'drive-doc',    title: 'GovGrants v2 — PRD',            path: 'drive://CDT/GovGrants/PRD',           meta: '18 pages',  modified: '2026-05-12' },
  { id: 'di-2', folderId: 'df-1', kind: 'drive-doc',    title: 'CDT contract — fully executed', path: 'drive://CDT/contract',                meta: '6 pages',   modified: '2026-04-01' },
  { id: 'di-3', folderId: 'df-1', kind: 'drive-sheet',  title: 'Burn — GovGrants',              path: 'drive://CDT/GovGrants/burn',          meta: '142 rows',  modified: '2026-05-13' },
  { id: 'di-4', folderId: 'df-1', kind: 'drive-doc',    title: 'API spec & test plan',          path: 'drive://CDT/VendorAPI/spec',           meta: '42 pages',  modified: '2026-05-08' },
  { id: 'di-5', folderId: 'df-2', kind: 'drive-sheet',  title: 'Stakeholder list',              path: 'drive://Roseville/stakeholders',       meta: '47 rows',   modified: '2026-04-15' },
  { id: 'di-6', folderId: 'df-2', kind: 'drive-doc',    title: 'PW Dashboard kickoff notes',    path: 'drive://Roseville/kickoff',            meta: '8 pages',   modified: '2026-04-10' },
  { id: 'di-7', folderId: 'df-4', kind: 'drive-doc',    title: 'Compliance checklist (FFIEC)',  path: 'drive://Foothill/compliance',          meta: '12 pages',  modified: '2026-05-02' },
  { id: 'di-8', folderId: 'df-5', kind: 'drive-folder', title: 'SOC2 evidence locker',          path: 'drive://Internal/SOC2',                meta: '89 files',  modified: '2026-05-14' },
  { id: 'di-9', folderId: 'df-5', kind: 'drive-doc',    title: 'JD — Senior Full-Stack',        path: 'drive://Internal/Hiring/JD',           meta: '3 pages',   modified: '2026-04-15' },
  { id: 'di-10',folderId: 'df-5', kind: 'drive-doc',    title: 'Allebrum SOW template (v3)',    path: 'drive://Internal/Templates/SOW',       meta: '4 pages',   modified: '2026-03-22' },
];

// --- Todos ---
// status: open | done; link to goal optional
const today = new Date();
const day = (offset) => {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const SEED_TODOS = [
  { id: 't-1',  title: 'Wire grant-application step 4 → review queue',          assignee: 'u-marcus', clientId: 'c-cdt',      projectId: 'p-govgrants', goalId: 'g-1', status: 'open', due: day(0),  estimateMin: 180, loggedMin: 95,  priority: 'high',   tags: ['frontend'], private: false },
  { id: 't-2',  title: 'QA pass — vendor onboarding happy-path',                assignee: 'u-priya',  clientId: 'c-cdt',      projectId: 'p-vendapi',   goalId: 'g-2', status: 'open', due: day(1),  estimateMin: 120, loggedMin: 35,  priority: 'high',   tags: ['qa'], private: false },
  { id: 't-3',  title: 'Public-works map: fix tile-server CORS',                assignee: 'u-sam',    clientId: 'c-rsv',      projectId: 'p-pwdash',    goalId: 'g-3', status: 'open', due: day(2),  estimateMin: 90,  loggedMin: 0,   priority: 'medium', tags: ['devops'], private: false },
  { id: 't-4',  title: 'CSUS data dictionary — kickoff doc',                    assignee: 'u-jordan', clientId: 'c-csus',     projectId: 'p-records',   goalId: 'g-4', status: 'open', due: day(3),  estimateMin: 60,  loggedMin: 0,   priority: 'medium', tags: ['discovery'], private: false },
  { id: 't-5',  title: 'Foothill — login screen visual review',                 assignee: 'u-avery',  clientId: 'c-foothill', projectId: 'p-member',    goalId: 'g-6', status: 'open', due: day(0),  estimateMin: 75,  loggedMin: 40,  priority: 'high',   tags: ['design','review'], private: false },
  { id: 't-6',  title: 'North Park onboarding — postmortem doc',                assignee: 'u-jordan', clientId: 'c-northpk',  projectId: 'p-onboard',   goalId: 'g-5', status: 'open', due: day(5),  estimateMin: 90,  loggedMin: 10,  priority: 'low',    tags: ['docs'], private: false },
  { id: 't-7',  title: 'SOC2: collect access-review evidence Q1',                assignee: 'u-sam',    clientId: 'c-internal', projectId: 'p-sales',     goalId: 'g-7', status: 'open', due: day(4),  estimateMin: 120, loggedMin: 0,   priority: 'high',   tags: ['security'], private: false },
  { id: 't-8',  title: 'Draft case study: North Park onboarding',                assignee: 'u-avery',  clientId: 'c-internal', projectId: 'p-marketing', goalId: 'g-8', status: 'open', due: day(7),  estimateMin: 150, loggedMin: 0,   priority: 'low',    tags: ['marketing'], private: false },
  { id: 't-9',  title: 'GovGrants — accessibility audit fixes',                  assignee: 'u-priya',  clientId: 'c-cdt',      projectId: 'p-govgrants', goalId: 'g-1', status: 'open', due: day(2),  estimateMin: 240, loggedMin: 60,  priority: 'high',   tags: ['a11y'], private: false },
  { id: 't-10', title: 'Interview: Senior FS Eng. — round 2 (3 candidates)',     assignee: 'u-senica', clientId: 'c-internal', projectId: 'p-sales',     goalId: 'g-9', status: 'open', due: day(1),  estimateMin: 180, loggedMin: 0,   priority: 'medium', tags: ['hiring'], private: false },
  { id: 't-11', title: 'Vendor API — write changelog + release notes',           assignee: 'u-marcus', clientId: 'c-cdt',      projectId: 'p-vendapi',   goalId: 'g-2', status: 'open', due: day(0),  estimateMin: 45,  loggedMin: 0,   priority: 'medium', tags: ['docs'], private: false },
  { id: 't-12', title: 'Roseville stakeholder demo prep',                        assignee: 'u-jordan', clientId: 'c-rsv',      projectId: 'p-pwdash',    goalId: 'g-3', status: 'open', due: day(3),  estimateMin: 90,  loggedMin: 25,  priority: 'medium', tags: ['client'], private: false },
  { id: 't-13', title: 'Refactor auth middleware (shared)',                       assignee: 'u-marcus', clientId: 'c-internal', projectId: 'p-sales',     goalId: null,  status: 'done', due: day(-3), estimateMin: 120, loggedMin: 130, priority: 'low',    tags: ['cleanup'], private: false },
  { id: 't-14', title: 'Update SOW template — gov terms',                         assignee: 'u-senica', clientId: 'c-internal', projectId: 'p-sales',     goalId: null,  status: 'done', due: day(-5), estimateMin: 60,  loggedMin: 75,  priority: 'low',    tags: ['ops'], private: false },

  // --- Private todos (only visible to the assignee) ---
  { id: 't-p1', title: 'Block 90min for deep work on grant flow',                assignee: 'u-senica', clientId: 'c-cdt',      projectId: 'p-govgrants', goalId: null,  status: 'open', due: day(0),  estimateMin: 90,  loggedMin: 0,   priority: 'high',   tags: ['focus'], private: true },
  { id: 't-p2', title: 'Prep talking points for the Roseville call',              assignee: 'u-senica', clientId: 'c-rsv',      projectId: 'p-pwdash',    goalId: 'g-3', status: 'open', due: day(2),  estimateMin: 30,  loggedMin: 0,   priority: 'medium', tags: ['prep'],  private: true },
  { id: 't-p3', title: 'Read: SOC2 evidence collection guide',                    assignee: 'u-senica', clientId: 'c-internal', projectId: 'p-sales',     goalId: null,  status: 'open', due: day(4),  estimateMin: 45,  loggedMin: 0,   priority: 'low',    tags: ['learning'], private: true },
  { id: 't-p4', title: 'One-on-one prep — Marcus',                                assignee: 'u-senica', clientId: 'c-internal', projectId: 'p-sales',     goalId: null,  status: 'open', due: day(1),  estimateMin: 20,  loggedMin: 0,   priority: 'medium', tags: ['1:1'],   private: true },

  { id: 't-p5', title: 'Refactor my dev environment',                              assignee: 'u-marcus', clientId: 'c-internal', projectId: 'p-sales',     goalId: null,  status: 'open', due: day(6),  estimateMin: 60,  loggedMin: 0,   priority: 'low',    tags: ['personal'], private: true },
  { id: 't-p6', title: 'Watch new React 19 talk',                                  assignee: 'u-marcus', clientId: 'c-internal', projectId: 'p-sales',     goalId: null,  status: 'open', due: day(3),  estimateMin: 45,  loggedMin: 0,   priority: 'low',    tags: ['learning'], private: true },
];

// --- Pay periods (semi-monthly: 1st-15th & 16th-end, 5-day buffer, pay 7 days after) ---
// status: open | review | closed
// Each period: work range, approval cutoff (lock date), pay date (bookkeeper runs payroll)
const SEED_PAY_PERIODS = [
  { id: 'pp-2026-04a', label: 'Apr 1 – Apr 15',  start: '2026-04-01', end: '2026-04-15', approvalCutoff: '2026-04-20', payDate: '2026-04-22', status: 'closed', closedAt: '2026-04-20T17:00:00Z' },
  { id: 'pp-2026-04b', label: 'Apr 16 – Apr 30', start: '2026-04-16', end: '2026-04-30', approvalCutoff: '2026-05-05', payDate: '2026-05-07', status: 'closed', closedAt: '2026-05-05T17:00:00Z' },
  { id: 'pp-2026-05a', label: 'May 1 – May 15',  start: '2026-05-01', end: '2026-05-15', approvalCutoff: '2026-05-20', payDate: '2026-05-22', status: 'review', closedAt: null },
  { id: 'pp-2026-05b', label: 'May 16 – May 31', start: '2026-05-16', end: '2026-05-31', approvalCutoff: '2026-06-05', payDate: '2026-06-07', status: 'open',   closedAt: null },
  { id: 'pp-2026-06a', label: 'Jun 1 – Jun 15',  start: '2026-06-01', end: '2026-06-15', approvalCutoff: '2026-06-20', payDate: '2026-06-22', status: 'open',   closedAt: null },
];

// --- Pay period config (what the bookkeeper sets up) ---
// Cadences:
//   'by-date'    — pick the specific calendar dates payroll runs (e.g. 1st & 15th)
//   'weekly'     — every 7 days from an anchor
//   'bi-weekly'  — every 14 days from an anchor
const SEED_PAY_CONFIG = {
  cadence: 'by-date',
  // by-date config: payDates are the actual pay dates (days of month 1-31, or 'last')
  payDates: [15, 'last'],
  weekendRule: 'prior',             // 'prior' | 'after' | 'as-is' (if pay date lands on weekend)
  // weekly / bi-weekly:
  anchor: '2026-04-06',
  // shared:
  processingBufferDays: 5,          // days after period end → approval cutoff
  payDelayDays: 7,                  // days after period end → pay date (gap between work end and payroll)
  autoClose: true,                  // auto-close periods at cutoff
  approverId: 'u-senica',
};

const payPeriodFor = (iso, periods = SEED_PAY_PERIODS) => {
  const d = iso.slice(0, 10);
  return periods.find((p) => d >= p.start && d <= p.end) || null;
};

// ---- Pay period generator -------------------------------------------------
// Parse a YYYY-MM-DD ISO date as LOCAL midnight (avoids the UTC-parsing TZ shift
// that makes "2026-05-15" render as May 14 west of UTC).
const parseLocalDate = (iso) => {
  if (!iso) return null;
  if (typeof iso === 'string' && iso.length > 10 && iso.includes('T')) return new Date(iso);
  return new Date(iso + 'T00:00:00');
};
// Format a Date as local YYYY-MM-DD (avoiding the UTC shift toISOString does).
const _isoDate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const _addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const _fmtRange = (s, e) => `${s.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${e.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'})}`;

// Apply weekend rule to a pay date — shift to prior Friday / following Monday / leave as-is
function _applyWeekendRule(date, rule) {
  const dow = date.getDay();
  if (dow !== 0 && dow !== 6) return date;
  if (rule === 'as-is') return date;
  if (rule === 'after') return _addDays(date, dow === 0 ? 1 : 2);
  // 'prior' is default — shift back to Friday
  return _addDays(date, dow === 0 ? -2 : -1);
}

// Resolve a "day of month" reference (number 1-31 or 'last') into an actual date for given year/month
function _resolveDayOfMonth(year, month, dayRef) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  if (dayRef === 'last') return new Date(year, month, lastDay);
  return new Date(year, month, Math.min(dayRef, lastDay));
}

// Returns an array of { start, end, approvalCutoff, payDate, label } objects
// describing the next `count` periods given a config object.
function generatePeriodSchedule(config, count = 6, fromDateIso) {
  const { cadence, processingBufferDays = 5, payDelayDays = 7, weekendRule = 'prior' } = config;
  const out = [];
  const today = fromDateIso ? new Date(fromDateIso) : new Date();
  today.setHours(0, 0, 0, 0);

  if (cadence === 'by-date') {
    const payDates = (config.payDates && config.payDates.length > 0) ? config.payDates : [15, 'last'];
    // sort ascending; 'last' becomes 31 for ordering
    const sorted = [...payDates].sort((a, b) => {
      const av = a === 'last' ? 31 : a;
      const bv = b === 'last' ? 31 : b;
      return av - bv;
    });

    // walk months until we have `count` future periods
    let cursorMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    let prevPeriodEnd = null;
    while (out.length < count) {
      const year = cursorMonth.getFullYear();
      const month = cursorMonth.getMonth();
      for (const dayRef of sorted) {
        let rawPayDate = _resolveDayOfMonth(year, month, dayRef);
        const payDate = _applyWeekendRule(rawPayDate, weekendRule);
        const periodEnd = _addDays(payDate, -payDelayDays);
        let periodStart;
        if (prevPeriodEnd) {
          periodStart = _addDays(prevPeriodEnd, 1);
        } else {
          // first period: estimate start as half-way back to previous pay date
          periodStart = _addDays(periodEnd, -14);
        }
        const approvalCutoff = _addDays(periodEnd, processingBufferDays);
        prevPeriodEnd = periodEnd;
        // only collect future or current periods
        if (payDate >= today) {
          out.push({
            start: _isoDate(periodStart),
            end: _isoDate(periodEnd),
            approvalCutoff: _isoDate(approvalCutoff),
            payDate: _isoDate(payDate),
            label: _fmtRange(periodStart, periodEnd),
          });
          if (out.length >= count) break;
        }
      }
      cursorMonth = new Date(year, month + 1, 1);
    }
  } else if (cadence === 'weekly' || cadence === 'bi-weekly') {
    const stepDays = cadence === 'weekly' ? 7 : 14;
    let start = new Date(config.anchor || _isoDate(today));
    // skip past periods until we reach today or future
    while (_addDays(start, stepDays - 1) < today) start = _addDays(start, stepDays);
    for (let i = 0; i < count; i++) {
      const end = _addDays(start, stepDays - 1);
      const rawPayDate = _addDays(end, payDelayDays);
      const payDate = _applyWeekendRule(rawPayDate, weekendRule);
      const cutoff = _addDays(end, processingBufferDays);
      out.push({
        start: _isoDate(start), end: _isoDate(end),
        approvalCutoff: _isoDate(cutoff), payDate: _isoDate(payDate),
        label: _fmtRange(start, end),
      });
      start = _addDays(end, 1);
    }
  }
  return out;
}

const cadenceLabel = (c) => ({
  'weekly':       'Weekly',
  'bi-weekly':    'Bi-weekly',
  'by-date':      'Monthly · custom dates',
  // legacy fallbacks
  'semi-monthly': 'Semi-monthly',
  'monthly':      'Monthly',
}[c] || c);

const dayOfMonthLabel = (d) => {
  if (d === 'last') return 'Last day';
  const ords = ['th','st','nd','rd'];
  const v = d % 100;
  return d + (ords[(v - 20) % 10] || ords[v] || ords[0]);
};

const describePaySchedule = (cfg) => {
  if (cfg.cadence === 'by-date') {
    const dates = [...(cfg.payDates || [])].sort((a, b) => (a === 'last' ? 31 : a) - (b === 'last' ? 31 : b));
    const list = dates.map(dayOfMonthLabel);
    if (list.length === 1) return `Pays on the ${list[0]} of each month`;
    if (list.length === 2) return `Pays on the ${list[0]} and ${list[1]} of each month`;
    return `Pays ${list.length}× monthly · ${list.join(', ')}`;
  }
  return cadenceLabel(cfg.cadence);
};

// --- Time entries (last 30 days) ---
// status: draft | submitted | approved | rejected; tied to payPeriodId
function makeEntries() {
  const entries = [];
  const projIds = ['p-govgrants','p-vendapi','p-pwdash','p-records','p-onboard','p-member','p-marketing','p-sales'];
  const userIds = SEED_USERS.map((u) => u.id);
  const tasks = [
    'Feature work', 'Bug fixes', 'Code review', 'Stakeholder call',
    'Design pass', 'QA & testing', 'Deployment', 'Sprint planning',
    'Docs & writeups', 'Discovery / research', 'Pair programming',
  ];
  const todayIso = new Date().toISOString().slice(0, 10);
  let id = 1;
  for (let d = 29; d >= 0; d--) {
    const date = new Date();
    date.setDate(date.getDate() - d);
    const iso = date.toISOString().slice(0, 10);
    const dow = date.getDay();
    if (dow === 0 || dow === 6) continue; // skip weekends
    const pp = payPeriodFor(iso);
    for (const uid of userIds) {
      const n = 2 + ((id + d) % 3);
      for (let i = 0; i < n; i++) {
        const proj = projIds[(id + i + d) % projIds.length];
        const task = tasks[(id + i) % tasks.length];
        const duration = 30 + ((id * 17 + i * 23) % 7) * 25;
        const hour = 9 + i * 2;
        const startIso = `${iso}T${String(hour).padStart(2,'0')}:00:00`;
        // status based on age + period status
        let status, approvedBy = null, approvedAt = null, submittedAt = null;
        if (pp && pp.status === 'closed') {
          status = 'approved';
          approvedBy = 'u-senica';
          approvedAt = pp.closedAt;
          submittedAt = `${iso}T18:00:00Z`;
        } else if (pp && pp.status === 'review') {
          // ~85% submitted, ~15% pre-approved as admin pre-approves
          status = (id + i) % 7 === 0 ? 'approved' : 'submitted';
          submittedAt = `${iso}T18:00:00Z`;
          if (status === 'approved') { approvedBy = 'u-senica'; approvedAt = `${iso}T20:00:00Z`; }
        } else {
          // current period: recent days are draft, older are submitted
          if (d <= 2) status = 'draft';
          else if (d <= 5) status = (id + i) % 3 === 0 ? 'draft' : 'submitted';
          else status = 'submitted';
          if (status === 'submitted') submittedAt = `${iso}T18:00:00Z`;
        }
        entries.push({
          id: `e-${id++}`,
          userId: uid,
          projectId: proj,
          note: task,
          startIso,
          durationMin: duration,
          payPeriodId: pp ? pp.id : null,
          status,
          submittedAt,
          approvedBy,
          approvedAt,
          rejectionNote: null,
        });
      }
    }
  }
  return entries;
}

const SEED_ENTRIES = makeEntries();

// --- Activity / audit ---
const SEED_ACTIVITY = [
  { id: 'a-1', who: 'u-marcus', kind: 'todo.done',    target: 'Refactor auth middleware (shared)',   when: '2h ago' },
  { id: 'a-2', who: 'u-priya',  kind: 'time.start',   target: 'GovGrants Portal — QA pass',          when: '15m ago' },
  { id: 'a-3', who: 'u-avery',  kind: 'goal.move',    target: 'Foothill member portal redesign → In progress', when: 'yesterday' },
  { id: 'a-4', who: 'u-senica', kind: 'user.invite',  target: 'casey@allebrum.com invited as Member', when: 'yesterday' },
  { id: 'a-5', who: 'u-jordan', kind: 'todo.assign',  target: 'Roseville stakeholder demo prep → Jordan', when: '2d ago' },
];

// --- helpers ---
const fmtMins = (m) => {
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  if (h === 0) return `${mm}m`;
  if (mm === 0) return `${h}h`;
  return `${h}h ${mm}m`;
};

const fmtMoney = (n) => `$${Math.round(n).toLocaleString()}`;

const fmtTimer = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
};

const byId = (arr, id) => arr.find((x) => x.id === id);
const projectsForClient = (projects, clientId) => projects.filter((p) => p.clientId === clientId);

const STATUS_LABEL = {
  'backlog': 'Backlog',
  'in-progress': 'In progress',
  'review': 'In review',
  'done': 'Shipped',
};
const STATUS_ORDER = ['backlog', 'in-progress', 'review', 'done'];

const ENTRY_STATUS_LABEL = {
  draft:     'Draft',
  submitted: 'Submitted',
  approved:  'Approved',
  rejected:  'Rejected',
};
const ENTRY_STATUS_PILL = {
  draft:     'gray',
  submitted: 'yellow',
  approved:  'green',
  rejected:  'red',
};

const PAY_PERIOD_STATUS_LABEL = {
  open:   'Open',
  review: 'Under review',
  closed: 'Closed',
};
const PAY_PERIOD_STATUS_PILL = {
  open:   'purple',
  review: 'yellow',
  closed: 'gray',
};

const PRIORITY_DOT = {
  high:   { color: '#dc2626', label: 'High' },
  medium: { color: '#f97316', label: 'Medium' },
  low:    { color: '#9ca3af', label: 'Low' },
};

Object.assign(window, {
  SEED_USERS, SEED_CLIENTS, SEED_PROJECTS, SEED_GOALS,
  SEED_TODOS, SEED_ENTRIES, SEED_ACTIVITY, SEED_PAY_PERIODS, SEED_PAY_CONFIG,
  SEED_INTEGRATIONS, SEED_DRIVE_ITEMS, RESOURCE_TYPES,
  payPeriodFor, generatePeriodSchedule, cadenceLabel, dayOfMonthLabel, describePaySchedule,
  parseLocalDate,
  fmtMins, fmtMoney, fmtTimer, byId, projectsForClient,
  STATUS_LABEL, STATUS_ORDER, PRIORITY_DOT,
  ENTRY_STATUS_LABEL, ENTRY_STATUS_PILL,
  PAY_PERIOD_STATUS_LABEL, PAY_PERIOD_STATUS_PILL,
});
