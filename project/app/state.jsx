/* global React, Icon, SEED_USERS, SEED_CLIENTS, SEED_PROJECTS, SEED_GOALS, SEED_TODOS, SEED_ENTRIES, SEED_ACTIVITY, SEED_PAY_PERIODS, SEED_PAY_CONFIG, SEED_INTEGRATIONS, payPeriodFor, generatePeriodSchedule, byId, fmtTimer */
const { useState, useEffect, useMemo, useCallback, useRef, createContext, useContext } = React;

// =============================================================================
// AppContext — single source of truth for the prototype
// =============================================================================

const AppContext = createContext(null);
const useApp = () => useContext(AppContext);

function AppProvider({ children }) {
  const [users, setUsers]         = useState(SEED_USERS);
  const [clients, setClients]     = useState(SEED_CLIENTS);
  const [projects, setProjects]   = useState(SEED_PROJECTS);
  const [goals, setGoals]         = useState(SEED_GOALS);
  const [todos, setTodos]         = useState(SEED_TODOS);
  const [entries, setEntries]     = useState(SEED_ENTRIES);
  const [activity, setActivity]   = useState(SEED_ACTIVITY);
  const [payPeriods, setPayPeriods] = useState(SEED_PAY_PERIODS);
  const [payConfig, setPayConfig]   = useState(SEED_PAY_CONFIG);
  const [integrations, setIntegrations] = useState(SEED_INTEGRATIONS);

  // who am I in this prototype
  const [meId, setMeId] = useState('u-senica');
  const me = byId(users, meId);

  // active timer
  // { projectId, note, todoId?, startedAt (epoch ms) }
  const [timer, setTimer] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [timer]);
  const elapsedSec = timer ? Math.max(0, Math.floor((Date.now() - timer.startedAt) / 1000)) : 0;

  // active route
  const [route, setRoute] = useState('dashboard');

  // ----- mutators -----
  const startTimer = useCallback((opts) => {
    // if already running, stop first
    if (timer) {
      stopTimer(); // eslint-disable-line no-use-before-define
    }
    const t = {
      projectId: opts.projectId || 'p-sales',
      note: opts.note || 'Working',
      todoId: opts.todoId || null,
      startedAt: Date.now(),
    };
    setTimer(t);
    setActivity((a) => [{ id: `a-${Date.now()}`, who: meId, kind: 'time.start', target: opts.note || 'Started timer', when: 'just now' }, ...a].slice(0, 30));
  }, [timer, meId]);

  const stopTimer = useCallback(() => {
    if (!timer) return;
    const durationMin = Math.max(1, Math.round((Date.now() - timer.startedAt) / 60000));
    const startIso = new Date(timer.startedAt).toISOString();
    const pp = payPeriodFor(startIso, payPeriods);
    setEntries((e) => [{
      id: `e-${Date.now()}`,
      userId: meId,
      projectId: timer.projectId,
      note: timer.note,
      startIso,
      durationMin,
      payPeriodId: pp ? pp.id : null,
      status: 'draft',
      submittedAt: null,
      approvedBy: null,
      approvedAt: null,
      rejectionNote: null,
    }, ...e]);
    if (timer.todoId) {
      setTodos((arr) => arr.map((t) => t.id === timer.todoId ? { ...t, loggedMin: (t.loggedMin || 0) + durationMin } : t));
    }
    setActivity((a) => [{ id: `a-${Date.now()}`, who: meId, kind: 'time.stop', target: `${timer.note} (${durationMin}m)`, when: 'just now' }, ...a].slice(0, 30));
    setTimer(null);
  }, [timer, meId, payPeriods]);

  const addManualEntry = useCallback((entry) => {
    const pp = payPeriodFor(entry.startIso, payPeriods);
    setEntries((e) => [{
      id: `e-${Date.now()}`, userId: meId,
      payPeriodId: pp ? pp.id : null,
      status: 'draft',
      submittedAt: null, approvedBy: null, approvedAt: null, rejectionNote: null,
      ...entry,
    }, ...e]);
  }, [meId, payPeriods]);

  // todo mutators
  const toggleTodo = useCallback((id) => {
    setTodos((arr) => arr.map((t) => t.id === id ? { ...t, status: t.status === 'done' ? 'open' : 'done' } : t));
  }, []);
  const addTodo = useCallback((t) => {
    setTodos((arr) => [{ id: `t-${Date.now()}`, status: 'open', loggedMin: 0, estimateMin: 60, priority: 'medium', tags: [], private: false, ...t }, ...arr]);
  }, []);
  const updateTodo = useCallback((id, patch) => {
    setTodos((arr) => arr.map((t) => t.id === id ? { ...t, ...patch } : t));
  }, []);
  const deleteTodo = useCallback((id) => {
    setTodos((arr) => arr.filter((t) => t.id !== id));
  }, []);

  // goal mutators
  const moveGoal = useCallback((id, status) => {
    setGoals((arr) => arr.map((g) => g.id === id ? { ...g, status } : g));
    setActivity((a) => {
      const g = byId(goals, id);
      const label = g ? `${g.title} → ${status}` : `Goal updated`;
      return [{ id: `a-${Date.now()}`, who: meId, kind: 'goal.move', target: label, when: 'just now' }, ...a].slice(0, 30);
    });
  }, [goals, meId]);
  const addGoal = useCallback((g) => {
    setGoals((arr) => [{ id: `g-${Date.now()}`, status: 'backlog', priority: 'medium', tag: 'Delivery', ...g }, ...arr]);
  }, []);
  const updateGoal = useCallback((id, patch) => {
    setGoals((arr) => arr.map((g) => g.id === id ? { ...g, ...patch } : g));
  }, []);

  // user/client/project mutators
  const inviteUser = useCallback((u) => {
    const initials = (u.name || '').split(' ').map((p) => p[0]).slice(0,2).join('').toUpperCase();
    const newU = { id: `u-${Date.now()}`, role: 'Member', color: '#6b7280', initials, billable: 150, ...u, status: 'invited' };
    setUsers((arr) => [...arr, newU]);
    setActivity((a) => [{ id: `a-${Date.now()}`, who: meId, kind: 'user.invite', target: `${u.email} invited as ${u.role || 'Member'}`, when: 'just now' }, ...a]);
  }, [meId]);
  const updateUser = useCallback((id, patch) => {
    setUsers((arr) => arr.map((u) => u.id === id ? { ...u, ...patch } : u));
  }, []);
  const removeUser = useCallback((id) => {
    setUsers((arr) => arr.filter((u) => u.id !== id));
  }, []);
  const addClient = useCallback((c) => {
    setClients((arr) => [...arr, { id: `c-${Date.now()}`, color: '#7e22ce', kind: 'agency', ...c }]);
  }, []);
  const addProject = useCallback((p) => {
    setProjects((arr) => [...arr, { id: `p-${Date.now()}`, billable: true, budgetHrs: 120, color: '#9333ea', ...p }]);
  }, []);

  // ----- approval mutators -----
  const submitEntries = useCallback((ids) => {
    const now = new Date().toISOString();
    setEntries((arr) => arr.map((e) => ids.includes(e.id) && e.status === 'draft' ? { ...e, status: 'submitted', submittedAt: now } : e));
    setActivity((a) => [{ id: `a-${Date.now()}`, who: meId, kind: 'time.submit', target: `${ids.length} entries submitted for approval`, when: 'just now' }, ...a].slice(0, 30));
  }, [meId]);
  const approveEntries = useCallback((ids) => {
    const now = new Date().toISOString();
    setEntries((arr) => arr.map((e) => ids.includes(e.id) ? { ...e, status: 'approved', approvedBy: meId, approvedAt: now, rejectionNote: null } : e));
    setActivity((a) => [{ id: `a-${Date.now()}`, who: meId, kind: 'time.approve', target: `${ids.length} entries approved`, when: 'just now' }, ...a].slice(0, 30));
  }, [meId]);
  const rejectEntries = useCallback((ids, note) => {
    setEntries((arr) => arr.map((e) => ids.includes(e.id) ? { ...e, status: 'rejected', rejectionNote: note || 'Returned for review' } : e));
    setActivity((a) => [{ id: `a-${Date.now()}`, who: meId, kind: 'time.reject', target: `${ids.length} entries returned for review`, when: 'just now' }, ...a].slice(0, 30));
  }, [meId]);
  const reopenEntries = useCallback((ids) => {
    setEntries((arr) => arr.map((e) => ids.includes(e.id) ? { ...e, status: 'submitted', approvedBy: null, approvedAt: null } : e));
  }, []);

  // ----- pay period mutators -----
  const closePeriod = useCallback((id) => {
    const now = new Date().toISOString();
    setPayPeriods((arr) => arr.map((p) => p.id === id ? { ...p, status: 'closed', closedAt: now } : p));
    // auto-approve any remaining submitted entries in that period
    setEntries((arr) => arr.map((e) => e.payPeriodId === id && e.status === 'submitted' ? { ...e, status: 'approved', approvedBy: meId, approvedAt: now } : e));
    setActivity((a) => [{ id: `a-${Date.now()}`, who: meId, kind: 'period.close', target: `Pay period ${id} closed`, when: 'just now' }, ...a].slice(0, 30));
  }, [meId]);
  const reopenPeriod = useCallback((id) => {
    setPayPeriods((arr) => arr.map((p) => p.id === id ? { ...p, status: 'review', closedAt: null } : p));
  }, []);
  const moveToReview = useCallback((id) => {
    setPayPeriods((arr) => arr.map((p) => p.id === id ? { ...p, status: 'review' } : p));
  }, []);
  const generatePeriods = useCallback(({ config, count, fromDate }) => {
    const cfg = config || payConfig;
    const schedule = generatePeriodSchedule(cfg, count, fromDate);
    const periods = schedule.map((s, i) => ({
      id: `pp-gen-${Date.now()}-${i}`,
      label: s.label,
      start: s.start, end: s.end,
      approvalCutoff: s.approvalCutoff, payDate: s.payDate,
      status: 'open', closedAt: null,
    }));
    // dedupe by start date — skip any that already exist
    setPayPeriods((arr) => {
      const existingStarts = new Set(arr.map((p) => p.start));
      const newOnes = periods.filter((p) => !existingStarts.has(p.start));
      return [...arr, ...newOnes].sort((a, b) => a.start.localeCompare(b.start));
    });
  }, [payConfig]);

  const updatePayConfig = useCallback((patch) => {
    setPayConfig((c) => ({ ...c, ...patch }));
    setActivity((a) => [{ id: `a-${Date.now()}`, who: meId, kind: 'period.config', target: 'Pay schedule updated', when: 'just now' }, ...a].slice(0, 30));
  }, [meId]);

  // ----- goal resources -----
  const addResource = useCallback((goalId, resource) => {
    const r = {
      id: `r-${Date.now()}`,
      addedBy: meId,
      addedAt: new Date().toISOString().slice(0, 10),
      meta: '',
      ...resource,
    };
    setGoals((arr) => arr.map((g) => g.id === goalId ? { ...g, resources: [...(g.resources || []), r] } : g));
    setActivity((a) => [{ id: `a-${Date.now()}`, who: meId, kind: 'resource.add', target: `${r.title} attached`, when: 'just now' }, ...a].slice(0, 30));
  }, [meId]);
  const removeResource = useCallback((goalId, resourceId) => {
    setGoals((arr) => arr.map((g) => g.id === goalId ? { ...g, resources: (g.resources || []).filter((r) => r.id !== resourceId) } : g));
  }, []);

  // ----- integrations -----
  const connectIntegration = useCallback((key, payload) => {
    setIntegrations((all) => ({ ...all, [key]: { connected: true, connectedAt: new Date().toISOString().slice(0,10), account: payload.account || 'user@allebrum.com', ...payload } }));
    setActivity((a) => [{ id: `a-${Date.now()}`, who: meId, kind: 'integration.connect', target: `${key} connected`, when: 'just now' }, ...a].slice(0, 30));
  }, [meId]);
  const disconnectIntegration = useCallback((key) => {
    setIntegrations((all) => ({ ...all, [key]: { connected: false } }));
  }, []);
  const updateIntegration = useCallback((key, patch) => {
    setIntegrations((all) => ({ ...all, [key]: { ...all[key], ...patch } }));
  }, []);
  const linkDriveFolder = useCallback((folder) => {
    setIntegrations((all) => ({
      ...all,
      drive: {
        ...all.drive,
        linkedFolders: [...(all.drive.linkedFolders || []), { id: `df-${Date.now()}`, lastSync: new Date().toISOString(), itemCount: 0, ...folder }],
      },
    }));
  }, []);
  const unlinkDriveFolder = useCallback((folderId) => {
    setIntegrations((all) => ({
      ...all,
      drive: { ...all.drive, linkedFolders: (all.drive.linkedFolders || []).filter((f) => f.id !== folderId) },
    }));
  }, []);
  const syncDrive = useCallback(() => {
    setIntegrations((all) => ({ ...all, drive: { ...all.drive, lastSyncAt: new Date().toISOString() } }));
    setActivity((a) => [{ id: `a-${Date.now()}`, who: meId, kind: 'integration.sync', target: 'Google Drive synced', when: 'just now' }, ...a].slice(0, 30));
  }, [meId]);

  const value = {
    users, clients, projects, goals, todos, entries, activity, payPeriods, payConfig, integrations,
    me, meId, setMeId,
    route, setRoute,
    timer, elapsedSec, tick,
    startTimer, stopTimer,
    addManualEntry,
    toggleTodo, addTodo, updateTodo, deleteTodo,
    moveGoal, addGoal, updateGoal,
    addResource, removeResource,
    inviteUser, updateUser, removeUser, addClient, addProject,
    submitEntries, approveEntries, rejectEntries, reopenEntries,
    closePeriod, reopenPeriod, moveToReview, generatePeriods, updatePayConfig,
    connectIntegration, disconnectIntegration, updateIntegration,
    linkDriveFolder, unlinkDriveFolder, syncDrive,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

window.AppContext = AppContext;
window.AppProvider = AppProvider;
window.useApp = useApp;
