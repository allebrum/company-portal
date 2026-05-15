/* global React, Icon, useApp, byId, fmtMins, Card, Tile, Pill, Avatar, Eyebrow, Button, Section, Dot, Modal, Field, Input, Select, Textarea, TabStrip, Empty, projectsForClient, PRIORITY_DOT , parseLocalDate */
const { useState: useTodoState, useMemo: useTodoMemo } = React;

const PRI_PILL = { high: 'red', medium: 'yellow', low: 'gray' };

function PageTodos() {
  const { me, users, clients, projects, goals, todos, toggleTodo, addTodo, updateTodo, deleteTodo, startTimer, timer } = useApp();
  const [scope, setScope] = useTodoState('mine');
  const [pri, setPri] = useTodoState('all');
  const [q, setQ] = useTodoState('');
  const [showDone, setShowDone] = useTodoState(false);
  const [composer, setComposer] = useTodoState(false);
  const [privateNew, setPrivateNew] = useTodoState(false);
  const [editing, setEditing] = useTodoState(null);

  const filtered = useTodoMemo(() => todos.filter((t) => {
    // Privacy: private todos are ONLY visible to the assignee, regardless of scope filter.
    if (t.private && t.assignee !== me.id) return false;
    // Scope: "Private" = my private todos only; "Mine" = my non-private; "Team" = others'; "All" = everything visible to me
    if (scope === 'private' && (!t.private || t.assignee !== me.id)) return false;
    if (scope === 'mine'    && (t.assignee !== me.id || t.private)) return false;
    if (scope === 'team'    && (t.assignee === me.id || t.private)) return false;
    if (scope === 'all'     && false) return false; // visible-to-me set (already passed privacy gate)
    if (pri !== 'all' && t.priority !== pri) return false;
    if (!showDone && t.status === 'done') return false;
    if (q && !t.title.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [todos, scope, pri, showDone, q, me.id]);

  // group by due bucket
  const todayIso = new Date().toISOString().slice(0, 10);
  const tomorrowIso = (() => { const d = new Date(); d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); })();
  const buckets = { Overdue: [], Today: [], Tomorrow: [], 'This week': [], Later: [], Done: [] };
  filtered.forEach((t) => {
    if (t.status === 'done') { buckets.Done.push(t); return; }
    const due = t.due;
    if (!due) { buckets.Later.push(t); return; }
    if (due < todayIso) buckets.Overdue.push(t);
    else if (due === todayIso) buckets.Today.push(t);
    else if (due === tomorrowIso) buckets.Tomorrow.push(t);
    else {
      const d = new Date(due);
      const now = new Date();
      const diff = (d - now) / (1000 * 60 * 60 * 24);
      if (diff <= 7) buckets['This week'].push(t);
      else buckets.Later.push(t);
    }
  });

  const counts = {
    open: filtered.filter((t) => t.status !== 'done').length,
    done: filtered.filter((t) => t.status === 'done').length,
    overdue: buckets.Overdue.length,
  };

  const myPrivateCount = todos.filter((t) => t.private && t.assignee === me.id && t.status !== 'done').length;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <Eyebrow>To-dos</Eyebrow>
          <h1 className="text-3xl font-bold text-gray-900 mt-1">
            {scope === 'private' ? 'Your private list' : "Today's load, line by line"}
          </h1>
          <p className="text-gray-500 mt-1">
            {scope === 'private'
              ? <>These are <span className="font-semibold text-gray-700">only visible to you</span>. Keep your prep work, learning queue, and personal reminders here.</>
              : <>{counts.open} open · {counts.done} done
                  {counts.overdue > 0 && <span className="text-red-600 font-semibold"> · {counts.overdue} overdue</span>}
                </>}
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => { setPrivateNew(scope === 'private'); setComposer(true); }}>
          <Icon name="plus" className="w-4 h-4" />New {scope === 'private' ? 'private to-do' : 'to-do'}
        </Button>
      </div>

      {/* Filter row */}
      <Card className="p-3 flex flex-wrap items-center gap-2">
        <TabStrip
          tabs={[
            { value: 'mine',    label: 'Assigned to me' },
            { value: 'team',    label: 'Team' },
            { value: 'all',     label: 'All' },
            { value: 'private', label: `🔒 Private${myPrivateCount > 0 ? ` (${myPrivateCount})` : ''}` },
          ]}
          value={scope}
          onChange={setScope}
        />
        <div className="h-6 w-px bg-gray-200 mx-1"></div>
        <TabStrip
          tabs={[
            { value: 'all',    label: 'Any priority' },
            { value: 'high',   label: 'High' },
            { value: 'medium', label: 'Med' },
            { value: 'low',    label: 'Low' },
          ]}
          value={pri}
          onChange={setPri}
        />
        <div className="flex-1"></div>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="rounded text-purple-600 focus:ring-purple-500" />
          Show done
        </label>
        <div className="relative">
          <Icon name="search" className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="pl-8 w-56" />
        </div>
      </Card>

      {/* List */}
      <div className="space-y-4">
        {Object.keys(buckets).map((b) => {
          if (b === 'Done' && !showDone) return null;
          if (buckets[b].length === 0) return null;
          return (
            <Card key={b} className="overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-gray-900 text-sm">{b}</h3>
                  <Pill color={b === 'Overdue' ? 'red' : b === 'Today' ? 'purple' : 'gray'}>{buckets[b].length}</Pill>
                </div>
              </div>
              <div className="divide-y divide-gray-100">
                {buckets[b].map((t) => (
                  <TodoRow key={t.id} todo={t} onEdit={() => setEditing(t)} />
                ))}
              </div>
            </Card>
          );
        })}
        {Object.values(buckets).every((b) => b.length === 0) && (
          <Card><Empty icon="check" title="Nothing here yet" hint="Make a to-do — even the small wins count." action={<Button variant="primary" onClick={() => setComposer(true)}><Icon name="plus" className="w-4 h-4" />New to-do</Button>} /></Card>
        )}
      </div>

      {(composer || editing) && <TodoComposer todo={editing} defaultPrivate={privateNew} onClose={() => { setComposer(false); setEditing(null); setPrivateNew(false); }} />}
    </div>
  );
}

function TodoRow({ todo, onEdit }) {
  const { users, clients, projects, goals, toggleTodo, startTimer, stopTimer, timer, deleteTodo } = useApp();
  const assignee = byId(users, todo.assignee);
  const project = byId(projects, todo.projectId);
  const client = project ? byId(clients, project.clientId) : null;
  const goal = todo.goalId ? byId(goals, todo.goalId) : null;
  const done = todo.status === 'done';
  const overdue = !done && todo.due && todo.due < new Date().toISOString().slice(0, 10);
  const isTiming = timer && timer.todoId === todo.id;

  const progress = todo.estimateMin ? Math.min(100, Math.round(((todo.loggedMin || 0) / todo.estimateMin) * 100)) : 0;

  return (
    <div className={`group px-5 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors ${isTiming ? 'bg-purple-50/60' : ''}`}>
      <button
        onClick={() => toggleTodo(todo.id)}
        className={`w-5 h-5 shrink-0 rounded-md border-2 flex items-center justify-center transition-colors ${done ? 'bg-purple-600 border-purple-600' : 'border-gray-300 hover:border-purple-500'}`}
        aria-label={done ? 'Mark open' : 'Mark done'}
      >
        {done && <Icon name="check" className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
      </button>

      <button onClick={onEdit} className="flex-1 min-w-0 text-left">
        <div className={`text-sm font-semibold flex items-center gap-2 ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
          {todo.private && <span title="Private — only you can see this" className="inline-flex items-center justify-center w-4 h-4 rounded bg-gray-900 text-white shrink-0"><Icon name="shield" className="w-2.5 h-2.5" strokeWidth={3} /></span>}
          <span className="truncate">{todo.title}</span>
        </div>
        <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
          {todo.private ? (
            <span className="inline-flex items-center gap-1 font-semibold text-gray-700">Private</span>
          ) : (
            client && (<span className="inline-flex items-center gap-1"><Dot color={client.color} /> {client.name}</span>)
          )}
          {!todo.private && (<>
            <span className="text-gray-300">·</span>
            <span className="truncate">{project ? project.name : '—'}</span>
          </>)}
          {todo.private && client && (<>
            <span className="text-gray-300">·</span>
            <span className="inline-flex items-center gap-1 opacity-70"><Dot color={client.color} /> {client.name}</span>
          </>)}
          {goal && (<>
            <span className="text-gray-300">·</span>
            <span className="inline-flex items-center gap-1 text-purple-700 font-medium"><Icon name="target" className="w-3 h-3" />{goal.title}</span>
          </>)}
        </div>
      </button>

      {/* tags */}
      <div className="hidden lg:flex items-center gap-1">
        {(todo.tags || []).slice(0, 2).map((tag) => <Pill key={tag} color="gray">#{tag}</Pill>)}
      </div>

      {/* progress / logged */}
      {todo.estimateMin > 0 && (
        <div className="hidden md:flex items-center gap-2 min-w-[120px]">
          <div className="text-xs text-gray-500 tabular-nums whitespace-nowrap">{fmtMins(todo.loggedMin || 0)} / {fmtMins(todo.estimateMin)}</div>
          <div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div className={`h-full rounded-full ${progress > 100 ? 'bg-red-500' : 'bg-purple-500'}`} style={{ width: `${Math.min(100, progress)}%` }}></div>
          </div>
        </div>
      )}

      {todo.due && (
        <div className={`text-xs whitespace-nowrap font-semibold ${overdue ? 'text-red-600' : 'text-gray-500'}`}>
          {parseLocalDate(todo.due).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </div>
      )}

      <Pill color={PRI_PILL[todo.priority] || 'gray'}>{todo.priority}</Pill>
      {assignee && <Avatar user={assignee} size={28} />}

      {/* timer button */}
      {isTiming ? (
        <Button variant="danger" size="sm" onClick={() => stopTimer()}>
          <Icon name="stop" className="w-3.5 h-3.5" />Running
        </Button>
      ) : (
        <Button
          variant="secondary" size="sm"
          onClick={() => startTimer({ projectId: todo.projectId, note: todo.title, todoId: todo.id })}
          disabled={done}
        >
          <Icon name="play" className="w-3.5 h-3.5" />Start
        </Button>
      )}

      <button onClick={() => deleteTodo(todo.id)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-gray-400 hover:bg-red-100 hover:text-red-600 transition-all" title="Delete">
        <Icon name="trash" className="w-4 h-4" />
      </button>
    </div>
  );
}

function TodoComposer({ todo, defaultPrivate = false, onClose }) {
  const { me, clients, projects, users, goals, addTodo, updateTodo } = useApp();
  const isEdit = !!todo;
  const initialPrivate = isEdit ? !!todo.private : defaultPrivate;
  const [title, setTitle] = useTodoState(todo?.title || '');
  const [isPrivate, setIsPrivate] = useTodoState(initialPrivate);
  const [clientId, setClientId] = useTodoState(todo?.clientId || clients[0]?.id);
  const projOpts = projectsForClient(projects, clientId);
  const [projectId, setProjectId] = useTodoState(todo?.projectId || projOpts[0]?.id);
  const [goalId, setGoalId] = useTodoState(todo?.goalId || '');
  // private todos are always assigned to me
  const [assignee, setAssignee] = useTodoState(todo?.assignee || (initialPrivate ? me.id : users[0].id));
  const [due, setDue] = useTodoState(todo?.due || new Date().toISOString().slice(0, 10));
  const [priority, setPriority] = useTodoState(todo?.priority || 'medium');
  const [estimate, setEstimate] = useTodoState((todo?.estimateMin || 60) / 60);

  const goalOpts = goals.filter((g) => !projectId || g.projectId === projectId);

  const submit = () => {
    if (!title.trim()) return;
    const payload = {
      title: title.trim(), clientId, projectId, goalId: goalId || null,
      assignee: isPrivate ? me.id : assignee, due, priority,
      private: isPrivate,
      estimateMin: Math.max(15, Math.round(parseFloat(estimate || '0') * 60)),
    };
    if (isEdit) updateTodo(todo.id, payload);
    else addTodo(payload);
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Edit to-do' : (isPrivate ? 'New private to-do' : 'New to-do')} size="md"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit}><Icon name="check" className="w-4 h-4" />{isEdit ? 'Save' : 'Create'}</Button>
      </>}>
      <div className="space-y-4">
        {/* Privacy toggle */}
        <button
          type="button"
          onClick={() => { setIsPrivate(!isPrivate); if (!isPrivate) setAssignee(me.id); }}
          className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-colors text-left ${isPrivate ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}
        >
          <div className={`p-1.5 rounded-lg ${isPrivate ? 'bg-white/15' : 'bg-gray-100'}`}>
            <Icon name="shield" className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <div className="font-bold text-sm">{isPrivate ? 'Private to-do' : 'Team to-do'}</div>
            <div className={`text-xs ${isPrivate ? 'text-white/70' : 'text-gray-500'}`}>
              {isPrivate
                ? 'Only you will see this. Assigned to you automatically.'
                : 'Visible to teammates. Can be reassigned.'}
            </div>
          </div>
          <div className={`w-10 h-5 rounded-full relative transition-colors ${isPrivate ? 'bg-white' : 'bg-gray-300'}`}>
            <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${isPrivate ? 'left-5 bg-gray-900' : 'left-0.5 bg-white'}`}></div>
          </div>
        </button>

        <Field label="Title"><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isPrivate ? 'e.g. Block 90 min for deep work' : 'What needs to happen?'} /></Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={isPrivate ? 'Client (optional)' : 'Client'}>
            <Select value={clientId} onChange={(e) => { setClientId(e.target.value); const ps = projectsForClient(projects, e.target.value); setProjectId(ps[0]?.id); }}>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Project">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projOpts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
        {!isPrivate && (
          <Field label="Link to a roadmap goal (optional)">
            <Select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">— none —</option>
              {goalOpts.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-3 gap-3">
          {isPrivate ? (
            <Field label="Assignee">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 border border-gray-200 text-sm text-gray-700">
                <Icon name="shield" className="w-3.5 h-3.5 text-gray-500" />Only you
              </div>
            </Field>
          ) : (
            <Field label="Assignee">
              <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Due">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </Select>
          </Field>
        </div>
        <Field label="Estimate (hours)" hint="Used to gauge progress while the timer runs.">
          <Input type="number" min="0.25" step="0.25" value={estimate} onChange={(e) => setEstimate(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

window.PageTodos = PageTodos;
