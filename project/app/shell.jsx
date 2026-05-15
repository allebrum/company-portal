/* global React, Icon, useApp, byId, fmtTimer, Button, Avatar, Modal, Field, Select, Input, projectsForClient */
const { useState: useShellState } = React;

// Sidebar nav items
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard',     icon: 'home' },
  { id: 'time',      label: 'Time tracking', icon: 'clock' },
  { id: 'todos',     label: 'To-dos',        icon: 'check' },
  { id: 'roadmap',   label: 'Roadmap',       icon: 'target' },
  { id: 'approvals', label: 'Approvals',     icon: 'shield' },
  { id: 'reports',   label: 'Reports',       icon: 'chart' },
  { id: 'admin',     label: 'Admin',         icon: 'cog' },
];

// ---------------------------------------------------------------------------
// Persistent top timer bar — always visible, shows active timer + start CTA
// ---------------------------------------------------------------------------
function TimerBar() {
  const app = useApp();
  const { timer, elapsedSec, startTimer, stopTimer, projects, clients, todos, route } = app;
  const [pickerOpen, setPickerOpen] = useShellState(false);
  const [clientId, setClientId]     = useShellState('c-cdt');
  const [projectId, setProjectId]   = useShellState('p-govgrants');
  const [todoId, setTodoId]         = useShellState('');
  const [note, setNote]             = useShellState('');

  const activeProject = timer ? byId(projects, timer.projectId) : null;
  const activeClient  = activeProject ? byId(clients, activeProject.clientId) : null;
  const activeTodo    = timer && timer.todoId ? byId(todos, timer.todoId) : null;

  const clientProjects = projectsForClient(projects, clientId);
  const filteredTodos = todos.filter((t) => t.status !== 'done' && (!projectId || t.projectId === projectId));

  const start = () => {
    startTimer({
      projectId,
      note: note || (activeTodo ? activeTodo.title : 'Working'),
      todoId: todoId || null,
    });
    setPickerOpen(false);
    setNote('');
    setTodoId('');
  };

  return (
    <div className={`sticky top-0 z-40 backdrop-blur-md ${timer ? 'bg-purple-700/95 text-white' : 'bg-white/90 border-b border-gray-200'}`}>
      <div className="px-6 h-14 flex items-center gap-4">
        {/* current page indicator */}
        <div className={`text-sm font-semibold ${timer ? 'text-white/80' : 'text-gray-500'} hidden md:flex items-center gap-2`}>
          <Icon name={(NAV_ITEMS.find((n) => n.id === route) || NAV_ITEMS[0]).icon} className="w-4 h-4" />
          <span>{(NAV_ITEMS.find((n) => n.id === route) || NAV_ITEMS[0]).label}</span>
        </div>

        <div className="flex-1"></div>

        {/* Active timer display */}
        {timer ? (
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col items-end leading-tight">
              <div className="text-[11px] uppercase tracking-widest text-purple-200/90 font-semibold">
                Tracking · {activeClient ? activeClient.name : ''}
              </div>
              <div className="text-sm font-semibold text-white truncate max-w-[300px]">
                {activeProject ? activeProject.name : ''} <span className="text-purple-200/80">— {timer.note}</span>
              </div>
            </div>
            <div className="font-mono text-lg font-bold tabular-nums bg-white/15 px-3 py-1 rounded-lg">
              {fmtTimer(elapsedSec)}
            </div>
            <Button variant="danger" size="md" onClick={stopTimer} className="shadow-md">
              <Icon name="stop" className="w-4 h-4" /> Stop
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-xs text-gray-500">No timer running</span>
            <Button data-start-shortcut variant="primary" size="md" onClick={() => setPickerOpen(true)} className="shadow-md">
              <Icon name="play" className="w-4 h-4" /> Start timer
            </Button>
          </div>
        )}
      </div>

      {/* Start-timer modal */}
      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Start timer"
        size="md"
        footer={<>
          <Button variant="ghost" onClick={() => setPickerOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={start}><Icon name="play" className="w-4 h-4" />Start</Button>
        </>}
      >
        <div className="space-y-4">
          <Field label="Client">
            <Select value={clientId} onChange={(e) => { setClientId(e.target.value); const ps = projectsForClient(projects, e.target.value); setProjectId(ps[0] ? ps[0].id : ''); }}>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Project">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {clientProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Link to a to-do (optional)">
            <Select value={todoId} onChange={(e) => { setTodoId(e.target.value); const t = byId(todos, e.target.value); if (t) setNote(t.title); }}>
              <option value="">— none —</option>
              {filteredTodos.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </Select>
          </Field>
          <Field label="Note" hint="What are you working on right now?">
            <Input placeholder="e.g. Reviewing accessibility audit findings" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
function Sidebar() {
  const { route, setRoute, me, users, setMeId, entries } = useApp();
  const [userMenu, setUserMenu] = useShellState(false);
  // pending approvals badge — entries awaiting review
  const pendingApprovals = entries.filter((e) => e.status === 'submitted').length;
  return (
    <aside className="w-60 shrink-0 bg-white border-r border-gray-200 text-gray-700 flex flex-col">
      {/* brand */}
      <div className="px-5 pt-5 pb-4 flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-600 to-purple-700 flex items-center justify-center shadow-md">
          <img src="assets/icon.png" alt="Allebrum" className="w-7 h-7 object-contain" />
        </div>
        <div className="leading-tight">
          <div className="font-bold text-base tracking-tight text-gray-900">Allebrum</div>
          <div className="text-[10px] uppercase tracking-widest text-purple-600 font-semibold">Company portal</div>
        </div>
      </div>

      {/* nav */}
      <nav className="px-2 pt-2 pb-4 flex-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const active = route === item.id;
          const showBadge = item.id === 'approvals' && pendingApprovals > 0;
          return (
            <button
              key={item.id}
              onClick={() => setRoute(item.id)}
              className={`group w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-colors mb-0.5 ${active ? 'bg-purple-600 text-white shadow-md' : 'text-gray-700 hover:bg-purple-50 hover:text-purple-700'}`}
            >
              <Icon name={item.icon} className={`w-4 h-4 ${active ? 'text-white' : 'text-gray-400 group-hover:text-purple-600'}`} />
              <span className="flex-1 text-left">{item.label}</span>
              {showBadge && (
                <span className={`text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full min-w-[20px] text-center ${active ? 'bg-white/25 text-white' : 'bg-purple-600 text-white'}`}>
                  {pendingApprovals}
                </span>
              )}
            </button>
          );
        })}

        <div className="mt-6 px-3">
          <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-2">Shortcuts</div>
          <div className="space-y-2 text-xs text-gray-500">
            <div className="flex items-center justify-between"><span>Start timer</span><kbd className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono border border-gray-200">T</kbd></div>
            <div className="flex items-center justify-between"><span>New to-do</span><kbd className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono border border-gray-200">N</kbd></div>
            <div className="flex items-center justify-between"><span>Search</span><kbd className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono border border-gray-200">/</kbd></div>
          </div>
        </div>
      </nav>

      {/* user switcher */}
      <div className="border-t border-gray-200 p-3 relative">
        {userMenu && (
          <div className="absolute bottom-full left-3 right-3 mb-2 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden">
            <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold px-3 pt-3 pb-1">View portal as</div>
            {users.map((u) => (
              <button key={u.id} onClick={() => { setMeId(u.id); setUserMenu(false); }} className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-purple-50 ${u.id === me.id ? 'text-purple-700 font-semibold' : 'text-gray-700'}`}>
                <Avatar user={u} size={24} /><span className="truncate">{u.name}</span>
                {u.id === me.id && <Icon name="check" className="w-4 h-4 ml-auto text-purple-600" />}
              </button>
            ))}
          </div>
        )}
        <button onClick={() => setUserMenu((v) => !v)} className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 transition-colors text-left">
          <Avatar user={me} size={32} />
          <div className="flex-1 min-w-0 leading-tight">
            <div className="text-sm font-semibold text-gray-900 truncate">{me.name}</div>
            <div className="text-[11px] text-gray-500 truncate">{me.role}</div>
          </div>
          <Icon name="chevronUp" className="w-4 h-4 text-gray-400" />
        </button>
      </div>
    </aside>
  );
}

Object.assign(window, { Sidebar, TimerBar, NAV_ITEMS });
