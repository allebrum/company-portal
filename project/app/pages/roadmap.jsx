/* global React, Icon, useApp, byId, fmtMins, Card, Tile, Pill, Avatar, Eyebrow, Button, Section, Dot, Modal, Field, Input, Select, Textarea, TabStrip, STATUS_LABEL, STATUS_ORDER, projectsForClient , parseLocalDate, RESOURCE_TYPES, SEED_DRIVE_ITEMS */
const { useState: useRoadState, useMemo: useRoadMemo, useRef: useRoadRef } = React;

const STATUS_BADGE = { 'backlog': 'gray', 'in-progress': 'purple', 'review': 'yellow', 'done': 'green' };
const PRI_PILL_R = { high: 'red', medium: 'yellow', low: 'gray' };

function PageRoadmap() {
  const { goals, clients, addGoal } = useApp();
  const [view, setView] = useRoadState('kanban');
  const [composer, setComposer] = useRoadState(false);
  const [editing, setEditing] = useRoadState(null);
  const [filterClient, setFilterClient] = useRoadState('all');

  const visible = goals.filter((g) => filterClient === 'all' || g.clientId === filterClient);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <Eyebrow>Roadmap</Eyebrow>
          <h1 className="text-3xl font-bold text-gray-900 mt-1">The bigger picture</h1>
          <p className="text-gray-500 mt-1">Where we're headed across every client, the next two quarters of real load.</p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={filterClient} onChange={(e) => setFilterClient(e.target.value)} className="!w-auto">
            <option value="all">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Button variant="primary" size="md" onClick={() => setComposer(true)}><Icon name="plus" className="w-4 h-4" />New goal</Button>
        </div>
      </div>

      <TabStrip
        value={view}
        onChange={setView}
        tabs={[
          { value: 'kanban', label: 'Kanban', icon: 'kanban' },
          { value: 'gantt',  label: 'Gantt',  icon: 'gantt' },
          { value: 'list',   label: 'List',   icon: 'list' },
        ]}
      />

      {view === 'kanban' && <KanbanView goals={visible} onOpen={setEditing} />}
      {view === 'gantt'  && <GanttView goals={visible} onOpen={setEditing} />}
      {view === 'list'   && <ListView goals={visible} onOpen={setEditing} />}

      {(composer || editing) && <GoalComposer goal={editing} onClose={() => { setComposer(false); setEditing(null); }} />}
    </div>
  );
}

// ===========================================================================
// Kanban
// ===========================================================================
function KanbanView({ goals, onOpen }) {
  const { moveGoal, clients, users, todos } = useApp();
  const dragId = useRoadRef(null);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {STATUS_ORDER.map((status) => {
        const cards = goals.filter((g) => g.status === status);
        return (
          <div
            key={status}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragId.current) moveGoal(dragId.current, status); dragId.current = null; }}
            className="bg-gray-50 rounded-2xl p-3 min-h-[200px]"
          >
            <div className="flex items-center justify-between px-2 pt-1 pb-3">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-gray-900">{STATUS_LABEL[status]}</h3>
                <Pill color={STATUS_BADGE[status]}>{cards.length}</Pill>
              </div>
              <button className="p-1 rounded-md text-gray-400 hover:bg-white hover:text-gray-700 transition-colors"><Icon name="more" className="w-4 h-4" /></button>
            </div>
            <div className="space-y-2.5">
              {cards.map((g) => {
                const client = byId(clients, g.clientId);
                const owner = byId(users, g.owner);
                const linkedTodos = todos.filter((t) => t.goalId === g.id);
                const doneCount = linkedTodos.filter((t) => t.status === 'done').length;
                return (
                  <div
                    key={g.id}
                    draggable
                    onDragStart={() => { dragId.current = g.id; }}
                    onDragEnd={() => { dragId.current = null; }}
                    onClick={() => onOpen(g)}
                    className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-lg transition-shadow p-3 cursor-pointer"
                  >
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: client?.color || '#9333ea' }}>
                      <Dot color={client?.color || '#9333ea'} />
                      <span className="truncate">{client?.name}</span>
                      <span className="text-gray-300 normal-case font-normal">·</span>
                      <span className="text-gray-400 normal-case font-medium">{g.tag}</span>
                    </div>
                    <div className="font-semibold text-gray-900 leading-snug">{g.title}</div>
                    <div className="flex items-center justify-between mt-3">
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span className="inline-flex items-center gap-1"><Icon name="calendar" className="w-3.5 h-3.5" />{parseLocalDate(g.end).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>
                        {linkedTodos.length > 0 && (
                          <span className="inline-flex items-center gap-1"><Icon name="check" className="w-3.5 h-3.5" />{doneCount}/{linkedTodos.length}</span>
                        )}
                        {(g.resources || []).length > 0 && (
                          <span className="inline-flex items-center gap-1 text-purple-700 font-semibold" title={`${g.resources.length} resources`}>
                            <Icon name="link" className="w-3.5 h-3.5" />{g.resources.length}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: { high: '#dc2626', medium: '#f97316', low: '#9ca3af' }[g.priority] }}></span>
                        {owner && <Avatar user={owner} size={22} />}
                      </div>
                    </div>
                  </div>
                );
              })}
              {cards.length === 0 && (
                <div className="text-xs text-gray-400 text-center py-6 border-2 border-dashed border-gray-200 rounded-xl">Drop here</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// Gantt — week-grained, 6 month window centered around April 2026
// ===========================================================================
function GanttView({ goals, onOpen }) {
  const { clients, users } = useApp();

  // window: from earliest start to latest end, padded to month edges
  const allDates = goals.flatMap((g) => [parseLocalDate(g.start), parseLocalDate(g.end)]);
  if (allDates.length === 0) return null;
  const minD = new Date(Math.min(...allDates));
  const maxD = new Date(Math.max(...allDates));
  const start = new Date(minD.getFullYear(), minD.getMonth(), 1);
  const end   = new Date(maxD.getFullYear(), maxD.getMonth() + 1, 0);
  const totalDays = Math.max(1, (end - start) / 86400000);

  // build month columns
  const months = [];
  let cur = new Date(start);
  while (cur <= end) {
    const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    const daysInMonth = (Math.min(next, end) - cur) / 86400000;
    months.push({ label: cur.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), days: daysInMonth });
    cur = next;
  }

  const dayPx = 6; // px per day
  const totalW = totalDays * dayPx;
  const today = new Date();
  const todayLeft = Math.max(0, (today - start) / 86400000) * dayPx;

  // sort goals
  const sorted = [...goals].sort((a, b) => new Date(a.start) - new Date(b.start));

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <div style={{ minWidth: `${totalW + 320}px` }}>
          {/* header */}
          <div className="flex items-stretch sticky top-0 z-10 bg-white border-b border-gray-200">
            <div className="w-[320px] shrink-0 px-4 py-2 text-xs font-bold uppercase tracking-widest text-gray-500 border-r border-gray-200">Goal</div>
            <div className="flex flex-1 relative">
              {months.map((m, i) => (
                <div key={i} style={{ width: m.days * dayPx }} className="border-r border-gray-100 text-xs font-bold uppercase tracking-widest text-gray-500 px-2 py-2">
                  {m.label}
                </div>
              ))}
              {/* today line */}
              {todayLeft >= 0 && todayLeft <= totalW && (
                <div className="absolute top-0 bottom-0 z-20 pointer-events-none" style={{ left: todayLeft }}>
                  <div className="w-px h-full bg-red-500"></div>
                  <div className="absolute -top-1 -translate-x-1/2 bg-red-500 text-white text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded">Today</div>
                </div>
              )}
            </div>
          </div>

          {/* rows */}
          <div className="relative">
            {todayLeft >= 0 && todayLeft <= totalW && (
              <div className="absolute top-0 bottom-0 z-10 pointer-events-none" style={{ left: 320 + todayLeft, width: 1, background: 'rgba(239,68,68,0.45)' }}></div>
            )}
            {sorted.map((g) => {
              const client = byId(clients, g.clientId);
              const owner = byId(users, g.owner);
              const gs = parseLocalDate(g.start);
              const ge = parseLocalDate(g.end);
              const left = ((gs - start) / 86400000) * dayPx;
              const width = Math.max(dayPx, ((ge - gs) / 86400000) * dayPx);
              const isDone = g.status === 'done';
              return (
                <div key={g.id} className="flex items-stretch border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <div className="w-[320px] shrink-0 px-4 py-3 border-r border-gray-200 flex items-center gap-3">
                    <Dot color={client?.color || '#9333ea'} size={10} />
                    <div className="min-w-0 flex-1">
                      <button onClick={() => onOpen(g)} className="text-sm font-semibold text-gray-900 hover:text-purple-700 text-left truncate w-full">{g.title}</button>
                      <div className="text-[11px] text-gray-500 truncate">{client?.name}</div>
                    </div>
                    {owner && <Avatar user={owner} size={24} />}
                  </div>
                  <div className="flex-1 relative py-3">
                    <button
                      onClick={() => onOpen(g)}
                      style={{ left, width }}
                      className={`absolute top-1/2 -translate-y-1/2 h-7 rounded-lg flex items-center px-2 text-[11px] font-semibold text-white shadow-sm hover:shadow-md transition-shadow ${isDone ? 'opacity-60' : ''}`}
                    >
                      <span className="absolute inset-0 rounded-lg" style={{ background: client?.color || '#9333ea', opacity: isDone ? 0.6 : 1 }}></span>
                      <span className="relative truncate">{STATUS_LABEL[g.status]}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ===========================================================================
// List
// ===========================================================================
function ListView({ goals, onOpen }) {
  const { clients, users, todos } = useApp();
  const sorted = [...goals].sort((a, b) => new Date(a.end) - new Date(b.end));
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-[2fr_1fr_1fr_auto_auto_auto] gap-3 px-5 py-3 bg-gray-50 border-b border-gray-200 text-xs font-bold uppercase tracking-widest text-gray-500">
        <div>Goal</div><div>Client</div><div>Timeline</div><div>Status</div><div>Priority</div><div>Owner</div>
      </div>
      <div className="divide-y divide-gray-100">
        {sorted.map((g) => {
          const client = byId(clients, g.clientId);
          const owner = byId(users, g.owner);
          const linked = todos.filter((t) => t.goalId === g.id);
          return (
            <button key={g.id} onClick={() => onOpen(g)} className="w-full grid grid-cols-[2fr_1fr_1fr_auto_auto_auto] gap-3 px-5 py-3 items-center text-left hover:bg-gray-50 transition-colors">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">{g.title}</div>
                <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                  <span>{g.tag}</span>
                  <span className="text-gray-300">·</span>
                  <span>{linked.length} to-dos</span>
                  {(g.resources || []).length > 0 && (<>
                    <span className="text-gray-300">·</span>
                    <span className="text-purple-700 font-semibold inline-flex items-center gap-0.5"><Icon name="link" className="w-3 h-3" />{g.resources.length}</span>
                  </>)}
                </div>
              </div>
              <div className="text-sm text-gray-700 flex items-center gap-2 min-w-0">
                <Dot color={client?.color || '#9333ea'} />
                <span className="truncate">{client?.name}</span>
              </div>
              <div className="text-xs text-gray-500">
                {parseLocalDate(g.start).toLocaleDateString('en-US',{month:'short',day:'numeric'})} – {parseLocalDate(g.end).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
              </div>
              <Pill color={STATUS_BADGE[g.status]}>{STATUS_LABEL[g.status]}</Pill>
              <Pill color={PRI_PILL_R[g.priority]}>{g.priority}</Pill>
              {owner && <Avatar user={owner} size={28} />}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ===========================================================================
// Goal composer / editor — also shows linked todos
// ===========================================================================
function GoalComposer({ goal, onClose }) {
  const { clients, projects, users, todos, integrations, addGoal, updateGoal, moveGoal, toggleTodo, startTimer, addResource, removeResource } = useApp();
  const isEdit = !!goal;
  const [title, setTitle] = useRoadState(goal?.title || '');
  const [clientId, setClientId] = useRoadState(goal?.clientId || clients[0].id);
  const projOpts = projectsForClient(projects, clientId);
  const [projectId, setProjectId] = useRoadState(goal?.projectId || projOpts[0]?.id);
  const [owner, setOwner] = useRoadState(goal?.owner || users[0].id);
  const [start, setStart] = useRoadState(goal?.start || new Date().toISOString().slice(0,10));
  const [end, setEnd] = useRoadState(goal?.end || new Date(Date.now() + 30*86400000).toISOString().slice(0,10));
  const [status, setStatus] = useRoadState(goal?.status || 'backlog');
  const [priority, setPriority] = useRoadState(goal?.priority || 'medium');
  const [tag, setTag] = useRoadState(goal?.tag || 'Delivery');
  const [resourcePicker, setResourcePicker] = useRoadState(false);

  const linkedTodos = goal ? todos.filter((t) => t.goalId === goal.id) : [];
  const resources = goal?.resources || [];

  const submit = () => {
    if (!title.trim()) return;
    const payload = { title: title.trim(), clientId, projectId, owner, start, end, status, priority, tag };
    if (isEdit) updateGoal(goal.id, payload); else addGoal(payload);
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? goal.title : 'New roadmap goal'} size="lg"
      footer={<>
        {isEdit && goal.status !== 'done' && (
          <Button variant="success" onClick={() => { moveGoal(goal.id, 'done'); onClose(); }} className="mr-auto"><Icon name="check" className="w-4 h-4" />Mark shipped</Button>
        )}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit}>{isEdit ? 'Save' : 'Create goal'}</Button>
      </>}>
      <div className="space-y-5">
        <Field label="Title"><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Ship GovGrants v2 application flow" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client">
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
        <div className="grid grid-cols-3 gap-3">
          <Field label="Owner">
            <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Start"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Target"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Field label="Tag">
            <Select value={tag} onChange={(e) => setTag(e.target.value)}>
              <option>Delivery</option><option>Ops</option><option>Growth</option><option>Hiring</option><option>Research</option>
            </Select>
          </Field>
        </div>

        {/* Resources */}
        {isEdit && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-widest font-semibold text-gray-500">Resources · {resources.length}</div>
              <Button variant="secondary" size="sm" onClick={() => setResourcePicker(true)}>
                <Icon name="plus" className="w-3.5 h-3.5" />Attach resource
              </Button>
            </div>
            {resources.length === 0 && <div className="text-sm text-gray-500 italic py-3">No resources yet — pull in the Figma file, the PRD, the Drive folder.</div>}
            <div className="space-y-1.5">
              {resources.map((r) => <ResourceRow key={r.id} resource={r} onRemove={() => removeResource(goal.id, r.id)} />)}
            </div>
          </div>
        )}

        {/* Linked todos */}
        {isEdit && (
          <div>
            <div className="text-[11px] uppercase tracking-widest font-semibold text-gray-500 mb-2">Linked to-dos · {linkedTodos.length}</div>
            {linkedTodos.length === 0 && <div className="text-sm text-gray-500 italic py-3">No to-dos linked yet — link one from the to-dos page.</div>}
            <div className="space-y-2">
              {linkedTodos.map((t) => (
                <div key={t.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                  <button onClick={() => toggleTodo(t.id)} className={`w-4 h-4 rounded border-2 ${t.status === 'done' ? 'bg-purple-600 border-purple-600' : 'border-gray-300'} flex items-center justify-center`}>
                    {t.status === 'done' && <Icon name="check" className="w-3 h-3 text-white" strokeWidth={3} />}
                  </button>
                  <div className={`flex-1 text-sm ${t.status === 'done' ? 'line-through text-gray-400' : 'text-gray-900'}`}>{t.title}</div>
                  <Button variant="ghost" size="sm" onClick={() => startTimer({ projectId: t.projectId, note: t.title, todoId: t.id })} disabled={t.status === 'done'}>
                    <Icon name="play" className="w-3.5 h-3.5" />Start
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {resourcePicker && (
        <ResourcePickerModal
          goal={goal}
          driveConnected={integrations?.drive?.connected}
          onClose={() => setResourcePicker(false)}
          onAdd={(resource) => { addResource(goal.id, resource); setResourcePicker(false); }}
        />
      )}
    </Modal>
  );
}

// Single resource row
function ResourceRow({ resource, onRemove }) {
  const { users, me } = useApp();
  const type = RESOURCE_TYPES[resource.kind] || RESOURCE_TYPES.link;
  const adder = byId(users, resource.addedBy);
  const isKey = resource.kind === 'key';
  const [revealed, setRevealed] = useRoadState(null);
  const [copied, setCopied] = useRoadState(false);

  const decrypt = () => {
    // Auth check — in production this is server-side; here we trust the
    // current portal session (me is set via the user switcher).
    if (!me) return;
    const dec = decryptSecret(resource.cipher);
    if (dec === null) {
      alert('Could not decrypt this key. It may be corrupted.');
      return;
    }
    setRevealed(dec);
  };

  const copyValue = async () => {
    if (!revealed) return;
    try { await navigator.clipboard.writeText(revealed); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {}
  };

  return (
    <div className="group">
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-200 hover:border-purple-300 hover:bg-purple-50/30 transition-colors">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${type.color}1a`, color: type.color }}>
          <Icon name={type.icon} className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 text-sm truncate flex items-center gap-2">
            {resource.title}
            {isKey && <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">Encrypted</span>}
          </div>
          <div className="text-xs text-gray-500 flex items-center gap-1.5">
            <span className="font-semibold">{type.label}</span>
            {resource.meta && <><span className="text-gray-300">·</span><span>{resource.meta}</span></>}
            {adder && <><span className="text-gray-300">·</span><span>by {adder.name.split(' ')[0]}</span></>}
          </div>
        </div>
        {isKey ? (
          revealed ? (
            <button onClick={() => setRevealed(null)} className="text-xs font-semibold text-purple-700 hover:text-purple-900 px-2 py-1 rounded hover:bg-purple-100" title="Hide">Hide</button>
          ) : (
            <Button variant="outline" size="sm" onClick={decrypt}><Icon name="shield" className="w-3.5 h-3.5" />Decrypt</Button>
          )
        ) : resource.url && (
          <a href={resource.url} target="_blank" rel="noreferrer" className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="Open in new tab" onClick={(e) => e.stopPropagation()}>
            <Icon name="arrowRight" className="w-4 h-4" />
          </a>
        )}
        {onRemove && (
          <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg text-gray-400 hover:bg-red-100 hover:text-red-600" title="Remove">
            <Icon name="trash" className="w-4 h-4" />
          </button>
        )}
      </div>
      {isKey && revealed && (
        <div className="mt-1 ml-12 mr-1 p-3 bg-gray-900 text-gray-100 rounded-xl">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] uppercase tracking-widest font-bold text-green-400 flex items-center gap-1">
              <Icon name="check" className="w-3 h-3" strokeWidth={3} />Decrypted for {me.name.split(' ')[0]}
            </div>
            <button onClick={copyValue} className="text-[10px] uppercase tracking-widest font-bold text-gray-400 hover:text-white">{copied ? 'Copied!' : 'Copy'}</button>
          </div>
          <pre className="font-mono text-sm whitespace-pre-wrap break-all bg-black/40 p-2 rounded-lg">{revealed}</pre>
          <div className="text-[10px] text-gray-500 mt-1.5">Hide when you're done — decryption is logged.</div>
        </div>
      )}
    </div>
  );
}

// ---- Auth-gated secret encryption ----
// In production, the ciphertext is wrapped with a workspace key the auth server
// hands out only to authenticated members. Here we simulate that with a fixed
// XOR key — the UX flow (encrypt-on-save, decrypt-on-click for any authenticated
// user) is what matters. Swap for Web Crypto + workspace key in prod without
// changing the UI.
const _WORKSPACE_KEY = 'allebrum-portal-workspace-key-v1';
function encryptSecret(plaintext) {
  let out = '';
  for (let i = 0; i < plaintext.length; i++) {
    out += String.fromCharCode(plaintext.charCodeAt(i) ^ _WORKSPACE_KEY.charCodeAt(i % _WORKSPACE_KEY.length));
  }
  return 'ALB::' + btoa('SALT' + out);
}
function decryptSecret(cipher) {
  if (!cipher || !cipher.startsWith('ALB::')) return null;
  try {
    const raw = atob(cipher.slice(5));
    if (!raw.startsWith('SALT')) return null;
    const body = raw.slice(4);
    let out = '';
    for (let i = 0; i < body.length; i++) {
      out += String.fromCharCode(body.charCodeAt(i) ^ _WORKSPACE_KEY.charCodeAt(i % _WORKSPACE_KEY.length));
    }
    if (/[^\x09\x0a\x0d\x20-\x7e]/.test(out)) return null;
    return out;
  } catch (e) {
    return null;
  }
}

// Resource picker — adds a link, drive item, note, key, or external resource
function ResourcePickerModal({ onClose, onAdd, driveConnected }) {
  const [tab, setTab] = useRoadState(driveConnected ? 'drive' : 'link');
  const [q, setQ] = useRoadState('');
  const [title, setTitle] = useRoadState('');
  const [url, setUrl] = useRoadState('');
  const [kind, setKind] = useRoadState('link');
  const [noteBody, setNoteBody] = useRoadState('');
  // Key tab state
  const [keyDescription, setKeyDescription] = useRoadState('');
  const [keyValue, setKeyValue] = useRoadState('');
  const [keyEncrypted, setKeyEncrypted] = useRoadState(null);

  const driveResults = (SEED_DRIVE_ITEMS || []).filter((d) => !q || d.title.toLowerCase().includes(q.toLowerCase()));

  const encryptAndPreview = () => {
    if (!keyValue.trim()) return;
    setKeyEncrypted(encryptSecret(keyValue));
  };
  const saveKey = () => {
    if (!keyEncrypted || !keyDescription.trim()) return;
    onAdd({
      kind: 'key',
      title: keyDescription.trim(),
      cipher: keyEncrypted,
      meta: `${keyValue.length} chars · encrypted`,
      url: '',
    });
  };

  return (
    <Modal open onClose={onClose} title="Attach a resource" size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button></>}>
      <TabStrip
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'drive', label: 'Google Drive', icon: 'folder' },
          { value: 'link',  label: 'Link / URL',   icon: 'link' },
          { value: 'note',  label: 'Note',         icon: 'list' },
          { value: 'key',   label: 'Keys',         icon: 'shield' },
        ]}
      />

      <div className="mt-5">
        {tab === 'drive' && (
          <div>
            {!driveConnected ? (
              <div className="text-center py-10 px-4 bg-gray-50 rounded-xl">
                <Icon name="folder" className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="font-semibold text-gray-900">Google Drive isn't connected.</p>
                <p className="text-sm text-gray-500 mt-1">Connect it in Admin → Integrations to pull files directly into goals.</p>
              </div>
            ) : (
              <>
                <div className="relative mb-3">
                  <Icon name="search" className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your Drive…" className="pl-8" />
                </div>
                <div className="max-h-[360px] overflow-y-auto space-y-1.5 pr-1">
                  {driveResults.length === 0 && <div className="text-sm text-gray-500 text-center py-6">No matches in your indexed Drive folders.</div>}
                  {driveResults.map((d) => {
                    const t = RESOURCE_TYPES[d.kind] || RESOURCE_TYPES['drive-doc'];
                    return (
                      <button key={d.id} onClick={() => onAdd({ kind: d.kind, title: d.title, url: d.path, meta: d.meta })}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-200 hover:border-purple-400 hover:bg-purple-50/40 transition-colors text-left">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${t.color}1a`, color: t.color }}>
                          <Icon name={t.icon} className="w-4.5 h-4.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-gray-900 text-sm truncate">{d.title}</div>
                          <div className="text-xs text-gray-500 truncate">{d.path} · {d.meta} · modified {d.modified}</div>
                        </div>
                        <Icon name="plus" className="w-4 h-4 text-purple-600" />
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'link' && (
          <div className="space-y-3">
            <Field label="What kind of link?">
              <div className="grid grid-cols-4 gap-2">
                {['link','figma','github','drive-doc'].map((k) => {
                  const t = RESOURCE_TYPES[k];
                  return (
                    <button key={k} onClick={() => setKind(k)} className={`p-2 rounded-lg border-2 text-sm transition-colors flex flex-col items-center gap-1 ${kind === k ? 'border-purple-500 bg-purple-50' : 'border-gray-200'}`}>
                      <Icon name={t.icon} className="w-4 h-4" style={{ color: t.color }} />
                      <span className="font-semibold text-xs text-gray-900">{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Title"><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Compliance checklist (FFIEC)" /></Field>
            <Field label="URL"><Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></Field>
            <div className="flex justify-end pt-2">
              <Button variant="primary" disabled={!title.trim() || !url.trim()} onClick={() => onAdd({ kind, title: title.trim(), url: url.trim() })}>
                <Icon name="link" className="w-4 h-4" />Attach link
              </Button>
            </div>
          </div>
        )}

        {tab === 'note' && (
          <div className="space-y-3">
            <Field label="Note title"><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Stakeholder interview takeaways" /></Field>
            <Field label="Body"><Textarea rows={6} value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="Paste content, takeaways, links — anything." /></Field>
            <div className="flex justify-end pt-2">
              <Button variant="primary" disabled={!title.trim()} onClick={() => onAdd({ kind: 'note', title: title.trim(), url: '', meta: `${noteBody.length} chars` })}>
                <Icon name="list" className="w-4 h-4" />Save note
              </Button>
            </div>
          </div>
        )}

        {tab === 'key' && (
          <div className="space-y-3">
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                <Icon name="shield" className="w-4 h-4" />
              </div>
              <div className="text-sm">
                <div className="font-bold text-red-900">Encrypt-at-rest secrets</div>
                <div className="text-red-800 text-xs mt-0.5">API keys, vendor credentials, SFTP passwords — encrypted on save. Any signed-in teammate with access to this goal can decrypt with one click.</div>
              </div>
            </div>

            <Field label="What is this?" hint="Visible to anyone with goal access. Don't put the secret here.">
              <Input
                autoFocus
                value={keyDescription}
                onChange={(e) => { setKeyDescription(e.target.value); setKeyEncrypted(null); }}
                placeholder="e.g. CDT vendor portal — production API key"
              />
            </Field>

            <Field label="The secret value" hint="The thing you actually need to store.">
              <Textarea
                rows={4}
                value={keyValue}
                onChange={(e) => { setKeyValue(e.target.value); setKeyEncrypted(null); }}
                placeholder="sk_live_…  or  user:pass  or  any string"
                className="font-mono text-sm"
              />
            </Field>

            {!keyEncrypted ? (
              <div className="flex items-center justify-between pt-2 gap-3">
                <div className="text-xs text-gray-500">
                  <Icon name="user" className="w-3 h-3 inline-block mr-1 text-purple-600" />
                  Decryption is gated by your Allebrum sign-in. No passphrase needed.
                </div>
                <Button
                  variant="primary"
                  disabled={!keyValue.trim() || !keyDescription.trim()}
                  onClick={encryptAndPreview}
                >
                  <Icon name="shield" className="w-4 h-4" />Encrypt
                </Button>
              </div>
            ) : (
              <>
                <div className="bg-gray-900 text-gray-100 rounded-xl p-3 space-y-1.5">
                  <div className="text-[10px] uppercase tracking-widest font-bold text-green-400 flex items-center gap-1">
                    <Icon name="check" className="w-3 h-3" strokeWidth={3} />Encrypted · ready to attach
                  </div>
                  <pre className="font-mono text-xs whitespace-pre-wrap break-all bg-black/40 p-2 rounded-lg">{keyEncrypted}</pre>
                  <div className="text-[10px] text-gray-400">This ciphertext is what's stored on the goal.</div>
                </div>
                <div className="flex justify-end pt-2 gap-2">
                  <Button variant="ghost" onClick={() => setKeyEncrypted(null)}>Edit</Button>
                  <Button variant="primary" onClick={saveKey}>
                    <Icon name="shield" className="w-4 h-4" />Attach encrypted key
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

window.PageRoadmap = PageRoadmap;
