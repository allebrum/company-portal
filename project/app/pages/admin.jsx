/* global React, Icon, useApp, byId, fmtMins, fmtMoney, Card, Tile, Pill, Avatar, Eyebrow, Button, Section, Dot, Modal, Field, Input, Select, Textarea, TabStrip, Empty, PAY_PERIOD_STATUS_LABEL, PAY_PERIOD_STATUS_PILL, generatePeriodSchedule, cadenceLabel, dayOfMonthLabel, describePaySchedule, parseLocalDate, RESOURCE_TYPES, SEED_DRIVE_ITEMS, IntegrationsTab */
const { useState: useAdminState } = React;

const ROLES = ['Owner', 'Admin', 'Project Manager', 'Member', 'Contractor'];
const ROLE_PILL = { Owner: 'purple', Admin: 'blue', 'Project Manager': 'pink', Member: 'gray', Contractor: 'yellow' };

function PageAdmin() {
  const [tab, setTab] = useAdminState('team');
  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div>
        <Eyebrow>Admin</Eyebrow>
        <h1 className="text-3xl font-bold text-gray-900 mt-1">The bones of the studio</h1>
        <p className="text-gray-500 mt-1">Invite teammates, set roles, wire up clients & projects. Lightweight on purpose.</p>
      </div>

      <TabStrip
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'team',     label: 'Team',         icon: 'users' },
          { value: 'clients',  label: 'Clients',      icon: 'building' },
          { value: 'projects', label: 'Projects',     icon: 'folder' },
          { value: 'periods',  label: 'Pay periods',  icon: 'calendar' },
          { value: 'integrations', label: 'Integrations', icon: 'link' },
          { value: 'company',  label: 'Company',      icon: 'briefcase' },
        ]}
      />

      {tab === 'team'     && <TeamTab />}
      {tab === 'clients'  && <ClientsTab />}
      {tab === 'projects' && <ProjectsTab />}
      {tab === 'periods'  && <PeriodsTab />}
      {tab === 'integrations' && <IntegrationsTab />}
      {tab === 'company'  && <CompanyTab />}
    </div>
  );
}

// ===========================================================================
// Team — invite, roles, billable rates
// ===========================================================================
function TeamTab() {
  const { users, updateUser, removeUser, inviteUser, entries, projects } = useApp();
  const [invite, setInvite] = useAdminState(false);

  // hours per user last 14d
  const hrsByUser = {};
  const since = new Date(); since.setDate(since.getDate() - 14);
  entries.forEach((e) => {
    if (new Date(e.startIso) < since) return;
    hrsByUser[e.userId] = (hrsByUser[e.userId] || 0) + e.durationMin;
  });

  return (
    <div className="space-y-4">
      <Card className="p-5 bg-gradient-to-r from-purple-50 to-purple-100 border-purple-200">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-600 text-white"><Icon name="users" className="w-5 h-5" /></div>
            <div>
              <div className="font-bold text-gray-900">Invite a teammate</div>
              <div className="text-sm text-gray-600">Send a magic-link invitation. They'll join with the role you pick — bump it later if needed.</div>
            </div>
          </div>
          <Button variant="primary" onClick={() => setInvite(true)}><Icon name="send" className="w-4 h-4" />Send invite</Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-[11px] uppercase tracking-widest text-gray-500 font-bold text-left">
              <th className="px-5 py-3">Member</th>
              <th className="px-5 py-3">Email</th>
              <th className="px-5 py-3">Role</th>
              <th className="px-5 py-3">Bill rate</th>
              <th className="px-5 py-3">Last 14d</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar user={u} size={36} />
                    <div>
                      <div className="font-semibold text-gray-900">{u.name}</div>
                      <div className="text-xs text-gray-500">{u.role}</div>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3 text-gray-700">{u.email}</td>
                <td className="px-5 py-3">
                  <Select value={u.role} onChange={(e) => updateUser(u.id, { role: e.target.value })} className="!py-1 !w-auto">
                    {ROLES.map((r) => <option key={r}>{r}</option>)}
                  </Select>
                </td>
                <td className="px-5 py-3 text-gray-900 font-semibold tabular-nums">${u.billable}/hr</td>
                <td className="px-5 py-3 text-gray-700 tabular-nums">{fmtMins(hrsByUser[u.id] || 0)}</td>
                <td className="px-5 py-3">
                  <Pill color={u.status === 'invited' ? 'yellow' : 'green'}>
                    {u.status === 'invited' ? 'Invited' : 'Active'}
                  </Pill>
                </td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => removeUser(u.id)} className="p-1.5 rounded-lg text-gray-400 hover:bg-red-100 hover:text-red-600 transition-colors" title="Remove">
                    <Icon name="trash" className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {invite && <InviteModal onClose={() => setInvite(false)} onSend={(payload) => { inviteUser(payload); setInvite(false); }} />}
    </div>
  );
}

function InviteModal({ onClose, onSend }) {
  const [email, setEmail] = useAdminState('');
  const [name, setName]   = useAdminState('');
  const [role, setRole]   = useAdminState('Member');
  const [rate, setRate]   = useAdminState(150);
  const submit = () => {
    if (!email.includes('@')) return;
    onSend({ email, name: name || email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), role, billable: Number(rate) || 150 });
  };
  return (
    <Modal open onClose={onClose} title="Invite a teammate" size="md"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit}><Icon name="mail" className="w-4 h-4" />Send invite</Button>
      </>}>
      <div className="space-y-4">
        <Field label="Work email" hint="They'll get a magic-link sign-in.">
          <Input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="casey@allebrum.com" />
        </Field>
        <Field label="Full name (optional)">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Casey Murphy" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => <option key={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Bill rate ($/hr)">
            <Input type="number" min="0" step="5" value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
        </div>
        <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 text-xs text-purple-800">
          <div className="font-semibold mb-1 flex items-center gap-1"><Icon name="shield" className="w-3.5 h-3.5" />Permissions</div>
          <div className="text-purple-700">
            {role === 'Owner' && 'Full access including billing and ownership transfer.'}
            {role === 'Admin' && 'Manage team, clients, projects, and billing. Cannot transfer ownership.'}
            {role === 'Project Manager' && 'Assign work, edit roadmaps, see reports for assigned clients.'}
            {role === 'Member' && 'Track time, complete to-dos, see assigned work.'}
            {role === 'Contractor' && 'External — limited to their assigned project only.'}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ===========================================================================
// Clients
// ===========================================================================
function ClientsTab() {
  const { clients, projects, addClient } = useApp();
  const [composer, setComposer] = useAdminState(false);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setComposer(true)}><Icon name="plus" className="w-4 h-4" />New client</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {clients.map((c) => {
          const clientProjects = projects.filter((p) => p.clientId === c.id);
          return (
            <Card key={c.id} className="p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold" style={{ background: c.color }}>
                  {c.name.split(' ').map((w) => w[0]).slice(0,2).join('')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-gray-900 truncate">{c.name}</div>
                  <Pill color={ { gov: 'purple', edu: 'blue', agency: 'pink', finance: 'teal', internal: 'gray' }[c.kind] || 'gray'}>{c.kind}</Pill>
                </div>
              </div>
              <div className="mt-4 text-xs text-gray-500">{clientProjects.length} active project{clientProjects.length === 1 ? '' : 's'}</div>
              <div className="mt-2 space-y-1">
                {clientProjects.slice(0, 3).map((p) => (
                  <div key={p.id} className="text-sm text-gray-700 flex items-center gap-2">
                    <Icon name="folder" className="w-3.5 h-3.5 text-gray-400" />
                    <span className="truncate">{p.name}</span>
                    {p.billable && <Pill color="green">$</Pill>}
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>

      {composer && (
        <ClientComposer onClose={() => setComposer(false)} onSubmit={(c) => { addClient(c); setComposer(false); }} />
      )}
    </div>
  );
}

function ClientComposer({ onClose, onSubmit }) {
  const [name, setName] = useAdminState('');
  const [kind, setKind] = useAdminState('agency');
  const [color, setColor] = useAdminState('#7e22ce');
  const palette = ['#9333ea', '#7e22ce', '#2563eb', '#0d9488', '#db2777', '#f97316', '#dc2626', '#22c55e'];
  return (
    <Modal open onClose={onClose} title="New client" size="md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => name && onSubmit({ name, kind, color })}>Create</Button></>}>
      <div className="space-y-4">
        <Field label="Client name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. State of California, Health Dept." /></Field>
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="gov">Government</option>
            <option value="edu">Education</option>
            <option value="agency">Agency</option>
            <option value="finance">Finance</option>
            <option value="internal">Internal</option>
          </Select>
        </Field>
        <Field label="Accent color">
          <div className="flex gap-2">
            {palette.map((c) => (
              <button key={c} onClick={() => setColor(c)} className={`w-8 h-8 rounded-lg transition-transform ${color === c ? 'ring-2 ring-offset-2 ring-gray-900 scale-110' : ''}`} style={{ background: c }} />
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

// ===========================================================================
// Projects
// ===========================================================================
function ProjectsTab() {
  const { projects, clients, entries, addProject } = useApp();
  const [composer, setComposer] = useAdminState(false);

  // hours logged per project
  const hrsByProj = {};
  entries.forEach((e) => { hrsByProj[e.projectId] = (hrsByProj[e.projectId] || 0) + e.durationMin; });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setComposer(true)}><Icon name="plus" className="w-4 h-4" />New project</Button>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-[11px] uppercase tracking-widest text-gray-500 font-bold text-left">
              <th className="px-5 py-3">Project</th>
              <th className="px-5 py-3">Client</th>
              <th className="px-5 py-3">Code</th>
              <th className="px-5 py-3">Billable</th>
              <th className="px-5 py-3">Budget</th>
              <th className="px-5 py-3">Logged</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {projects.map((p) => {
              const c = byId(clients, p.clientId);
              const logged = (hrsByProj[p.id] || 0) / 60;
              const pct = Math.min(100, Math.round((logged / Math.max(1, p.budgetHrs)) * 100));
              return (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2"><Dot color={p.color} /><span className="font-semibold text-gray-900">{p.name}</span></div>
                  </td>
                  <td className="px-5 py-3 text-gray-700">{c?.name}</td>
                  <td className="px-5 py-3 font-mono text-xs text-gray-500">{p.code}</td>
                  <td className="px-5 py-3"><Pill color={p.billable ? 'green' : 'gray'}>{p.billable ? 'Billable' : 'Internal'}</Pill></td>
                  <td className="px-5 py-3 text-gray-700 tabular-nums">{p.budgetHrs}h</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2 min-w-[160px]">
                      <span className="text-xs text-gray-500 tabular-nums w-16">{Math.round(logged)}h ({pct}%)</span>
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pct > 100 ? 'bg-red-500' : 'bg-purple-500'}`} style={{ width: `${pct}%` }}></div>
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {composer && <ProjectComposer onClose={() => setComposer(false)} onSubmit={(p) => { addProject(p); setComposer(false); }} />}
    </div>
  );
}

function ProjectComposer({ onClose, onSubmit }) {
  const { clients } = useApp();
  const [name, setName] = useAdminState('');
  const [clientId, setClientId] = useAdminState(clients[0]?.id);
  const [code, setCode] = useAdminState('');
  const [billable, setBillable] = useAdminState(true);
  const [budget, setBudget] = useAdminState(120);
  return (
    <Modal open onClose={onClose} title="New project" size="md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => name && onSubmit({ name, clientId, code: code || name.slice(0,6).toUpperCase(), billable, budgetHrs: Number(budget) })}>Create</Button></>}>
      <div className="space-y-4">
        <Field label="Project name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Project code"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="GG-24" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Budget (hours)"><Input type="number" min="0" step="10" value={budget} onChange={(e) => setBudget(e.target.value)} /></Field>
          <Field label="Billable">
            <Select value={billable ? 'y' : 'n'} onChange={(e) => setBillable(e.target.value === 'y')}>
              <option value="y">Yes — billable</option>
              <option value="n">No — internal</option>
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

// ===========================================================================
// Pay periods
// ===========================================================================
function PeriodsTab() {
  const { payPeriods, payConfig, entries, users, projects, closePeriod, reopenPeriod, moveToReview, generatePeriods, updatePayConfig, setRoute } = useApp();
  const [scheduleModal, setScheduleModal] = useAdminState(false);
  const [generator, setGenerator] = useAdminState(false);

  const approver = byId(users, payConfig.approverId);
  const today = new Date(); today.setHours(0,0,0,0);

  // stats per period
  const periodStats = payPeriods.map((p) => {
    const es = entries.filter((e) => e.payPeriodId === p.id);
    const min = es.reduce((s, e) => s + e.durationMin, 0);
    const submitted = es.filter((e) => e.status === 'submitted').length;
    const approved = es.filter((e) => e.status === 'approved').length;
    const draft = es.filter((e) => e.status === 'draft').length;
    // revenue for this period (billable hours × user bill rate)
    const revenue = es.reduce((s, e) => {
      const proj = byId(projects, e.projectId);
      const u = byId(users, e.userId);
      if (!proj || !proj.billable || !u) return s;
      return s + (e.durationMin / 60) * u.billable;
    }, 0);
    return { period: p, count: es.length, min, submitted, approved, draft, revenue };
  }).sort((a, b) => b.period.start.localeCompare(a.period.start));

  // upcoming payroll runs — next 4 pay dates
  const upcomingRuns = [...payPeriods]
    .filter((p) => p.payDate && parseLocalDate(p.payDate) >= today)
    .sort((a, b) => a.payDate.localeCompare(b.payDate))
    .slice(0, 4)
    .map((p) => {
      const stats = periodStats.find((s) => s.period.id === p.id) || { min: 0, revenue: 0, submitted: 0, approved: 0, count: 0 };
      const daysAway = Math.round((parseLocalDate(p.payDate) - today) / 86400000);
      const cutoffDaysAway = p.approvalCutoff ? Math.round((parseLocalDate(p.approvalCutoff) - today) / 86400000) : null;
      return { period: p, daysAway, cutoffDaysAway, ...stats };
    });

  return (
    <div className="space-y-4">
      {/* === Schedule config card === */}
      <Card className="overflow-hidden">
        <div className="p-5 bg-gradient-to-r from-purple-600 to-purple-700 text-white">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-white/15 backdrop-blur-sm"><Icon name="calendar" className="w-5 h-5 text-white" /></div>
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold text-purple-200">Pay schedule</p>
                <div className="text-xl font-bold mt-0.5">{describePaySchedule(payConfig)}</div>
                <div className="text-sm text-purple-100 mt-0.5">{payConfig.processingBufferDays}-day processing buffer · pay date {payConfig.payDelayDays} days after period end</div>
              </div>
            </div>
            <Button variant="outline" onClick={() => setScheduleModal(true)} className="!bg-white !text-purple-700 !border-white hover:!bg-purple-50">
              <Icon name="edit" className="w-4 h-4" />Edit schedule
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-gray-100 border-t border-gray-100">
          <ConfigStat label="Cadence" value={cadenceLabel(payConfig.cadence)} />
          <ConfigStat label="Approval cutoff" value={`+${payConfig.processingBufferDays} days`} hint="after period ends" />
          <ConfigStat label="Pay date" value={`+${payConfig.payDelayDays} days`} hint="after period ends" />
          <ConfigStat label="Approver" value={approver ? approver.name : '—'} hint={approver ? approver.role : ''} />
        </div>
      </Card>

      {/* === Upcoming payroll runs === */}
      <Card className="p-5">
        <Section title="Upcoming payroll runs" eyebrow="Bookkeeper's calendar"
          action={
            <Button variant="ghost" size="sm" onClick={() => setRoute('approvals')}>
              Open approvals <Icon name="arrowRight" className="w-4 h-4" />
            </Button>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {upcomingRuns.length === 0 && (
              <div className="col-span-full text-sm text-gray-500 text-center py-6">
                No upcoming runs scheduled. <button onClick={() => setGenerator(true)} className="text-purple-700 font-semibold underline">Generate more periods</button>
              </div>
            )}
            {upcomingRuns.map(({ period, daysAway, cutoffDaysAway, min, revenue, submitted, approved, count }) => {
              const isImminent = daysAway <= 7;
              const cutoffPast = cutoffDaysAway !== null && cutoffDaysAway < 0;
              const cutoffSoon = cutoffDaysAway !== null && cutoffDaysAway >= 0 && cutoffDaysAway <= 3;
              return (
                <Tile key={period.id} className={`p-4 ${isImminent ? 'bg-purple-50 border-purple-200' : ''}`} hover>
                  <div className="flex items-start justify-between">
                    <div>
                      <Eyebrow>Pay date</Eyebrow>
                      <div className="text-xl font-bold text-gray-900 mt-0.5">{parseLocalDate(period.payDate).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{daysAway === 0 ? 'Today' : `${daysAway} ${daysAway === 1 ? 'day' : 'days'} away`}</div>
                    </div>
                    <Pill color={PAY_PERIOD_STATUS_PILL[period.status]}>{PAY_PERIOD_STATUS_LABEL[period.status]}</Pill>
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-gray-600">
                      <span>Work period</span>
                      <span className="font-semibold text-gray-900 tabular-nums">{period.label}</span>
                    </div>
                    <div className="flex items-center justify-between text-gray-600">
                      <span>Hours</span>
                      <span className="font-semibold text-gray-900 tabular-nums">{fmtMins(min)}</span>
                    </div>
                    <div className="flex items-center justify-between text-gray-600">
                      <span>Billable</span>
                      <span className="font-semibold text-purple-700 tabular-nums">{revenue > 0 ? fmtMoney(revenue) : '—'}</span>
                    </div>
                    {period.approvalCutoff && (
                      <div className={`flex items-center justify-between font-semibold mt-2 pt-2 border-t border-gray-100 ${cutoffPast ? 'text-red-600' : cutoffSoon ? 'text-orange-600' : 'text-gray-600'}`}>
                        <span className="flex items-center gap-1">
                          {cutoffPast || cutoffSoon ? <Icon name="bell" className="w-3 h-3" /> : <Icon name="clock" className="w-3 h-3" />}
                          Approval cutoff
                        </span>
                        <span className="tabular-nums">
                          {parseLocalDate(period.approvalCutoff).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                          {cutoffDaysAway !== null && (
                            <span className="ml-1 text-[10px]">
                              ({cutoffPast ? `${-cutoffDaysAway}d late` : cutoffDaysAway === 0 ? 'today' : `${cutoffDaysAway}d`})
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                    {submitted > 0 && (
                      <div className="text-yellow-700 font-semibold pt-1">⤷ {submitted} pending approval</div>
                    )}
                  </div>
                </Tile>
              );
            })}
          </div>
        </Section>
      </Card>

      {/* === Period schedule table === */}
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">All periods</h2>
            <p className="text-xs text-gray-500 mt-0.5">Latest first. Approval cutoff & pay date reflect current schedule.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setGenerator(true)}>
            <Icon name="plus" className="w-4 h-4" />Generate more
          </Button>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-[11px] uppercase tracking-widest text-gray-500 font-bold text-left">
              <th className="px-5 py-3">Period</th>
              <th className="px-5 py-3">Work range</th>
              <th className="px-5 py-3">Approval cutoff</th>
              <th className="px-5 py-3">Pay date</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Hours</th>
              <th className="px-5 py-3">Approval</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {periodStats.map(({ period, count, min, submitted, approved, draft }) => {
              const progress = count > 0 ? Math.round((approved / count) * 100) : 0;
              const cutoffDays = period.approvalCutoff ? Math.round((parseLocalDate(period.approvalCutoff) - today) / 86400000) : null;
              return (
                <tr key={period.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <div className="font-semibold text-gray-900">{period.label}</div>
                    <div className="text-xs text-gray-500 font-mono">{period.id}</div>
                  </td>
                  <td className="px-5 py-3 text-gray-700 whitespace-nowrap tabular-nums">
                    {parseLocalDate(period.start).toLocaleDateString('en-US',{month:'short',day:'numeric'})} – {parseLocalDate(period.end).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    {period.approvalCutoff ? (
                      <div>
                        <div className="text-gray-900 font-semibold tabular-nums">{parseLocalDate(period.approvalCutoff).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>
                        {cutoffDays !== null && period.status !== 'closed' && (
                          <div className={`text-[11px] font-semibold ${cutoffDays < 0 ? 'text-red-600' : cutoffDays <= 3 ? 'text-orange-600' : 'text-gray-500'}`}>
                            {cutoffDays < 0 ? `${-cutoffDays} days overdue` : cutoffDays === 0 ? 'Due today' : `in ${cutoffDays} days`}
                          </div>
                        )}
                      </div>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    {period.payDate ? (
                      <div className="font-bold text-purple-700 tabular-nums">{parseLocalDate(period.payDate).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-5 py-3"><Pill color={PAY_PERIOD_STATUS_PILL[period.status]}>{PAY_PERIOD_STATUS_LABEL[period.status]}</Pill></td>
                  <td className="px-5 py-3 text-gray-900 font-semibold tabular-nums whitespace-nowrap">{fmtMins(min)}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2 min-w-[140px]">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-purple-500" style={{ width: `${progress}%` }}></div>
                      </div>
                      <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">{approved}/{count}</span>
                    </div>
                    {(submitted > 0 || draft > 0) && (
                      <div className="flex items-center gap-2 text-[11px] mt-1">
                        {submitted > 0 && <span className="text-yellow-700 font-semibold">{submitted} pending</span>}
                        {draft > 0 && <span className="text-gray-500">{draft} draft</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setRoute('approvals')}>Review</Button>
                      {period.status === 'open' && submitted > 0 && (
                        <Button variant="outline" size="sm" onClick={() => moveToReview(period.id)}>Lock</Button>
                      )}
                      {period.status === 'review' && (
                        <Button variant="primary" size="sm" onClick={() => closePeriod(period.id)}>
                          <Icon name="shield" className="w-3.5 h-3.5" />Close
                        </Button>
                      )}
                      {period.status === 'closed' && (
                        <Button variant="ghost" size="sm" onClick={() => reopenPeriod(period.id)}>
                          <Icon name="refresh" className="w-3.5 h-3.5" />Reopen
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </Card>

      {scheduleModal && <ScheduleModal onClose={() => setScheduleModal(false)} />}
      {generator && <GeneratePeriodsModal onClose={() => setGenerator(false)} onSubmit={(payload) => { generatePeriods(payload); setGenerator(false); }} />}
    </div>
  );
}

const ConfigStat = ({ label, value, hint }) => (
  <div className="px-5 py-4">
    <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">{label}</div>
    <div className="text-base font-bold text-gray-900 mt-0.5">{value}</div>
    {hint && <div className="text-xs text-gray-500 mt-0.5">{hint}</div>}
  </div>
);

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// ===========================================================================
// Schedule editor — full pay-config form
// ===========================================================================
function ScheduleModal({ onClose }) {
  const { payConfig, users, updatePayConfig } = useApp();
  const [cfg, setCfg] = useAdminState({ ...payConfig, payDates: [...(payConfig.payDates || [15, 'last'])] });
  const set = (patch) => setCfg((c) => ({ ...c, ...patch }));

  // live preview — next 4 periods
  const preview = generatePeriodSchedule(cfg, 4);

  const submit = () => {
    updatePayConfig(cfg);
    onClose();
  };

  const sortedPayDates = [...(cfg.payDates || [])].sort((a, b) => (a === 'last' ? 31 : a) - (b === 'last' ? 31 : b));

  const setPayDateAt = (idx, value) => {
    const v = value === 'last' ? 'last' : Number(value);
    const next = [...cfg.payDates];
    next[idx] = v;
    set({ payDates: next });
  };
  const setPaydaysCount = (n) => {
    const current = cfg.payDates || [];
    let next;
    if (n === 1) next = [15];
    else if (n === 2) next = [1, 15];
    else if (n === 3) next = [1, 11, 21];
    else if (n === 4) next = [1, 8, 15, 22];
    else next = current;
    // preserve user's existing selections if count matches
    if (current.length === n) next = current;
    set({ payDates: next });
  };

  return (
    <Modal open onClose={onClose} title="Pay schedule" size="xl"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit}><Icon name="check" className="w-4 h-4" />Save schedule</Button>
      </>}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT: config */}
        <div className="space-y-5">
          {/* Cadence */}
          <div>
            <div className="text-[10px] uppercase tracking-widest font-semibold text-purple-600 mb-2">1 · How does payroll run?</div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { v: 'by-date',     label: 'Monthly dates', hint: '1st, 15th, etc' },
                { v: 'bi-weekly',   label: 'Bi-weekly',     hint: 'Every 14 days' },
                { v: 'weekly',      label: 'Weekly',        hint: 'Every 7 days' },
              ].map((opt) => (
                <button key={opt.v} onClick={() => set({ cadence: opt.v })}
                  className={`text-left p-3 rounded-xl border-2 transition-colors ${cfg.cadence === opt.v ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <div className="font-bold text-sm text-gray-900">{opt.label}</div>
                  <div className="text-xs text-gray-500">{opt.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {/* By-date: pick number of paydays + specific dates */}
          {cfg.cadence === 'by-date' && (
            <>
              <div>
                <div className="text-[10px] uppercase tracking-widest font-semibold text-purple-600 mb-2">2 · Pay days per month</div>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4].map((n) => (
                    <button key={n} onClick={() => setPaydaysCount(n)}
                      className={`p-3 rounded-xl border-2 transition-colors text-center ${cfg.payDates.length === n ? 'border-purple-500 bg-purple-50 text-purple-900' : 'border-gray-200 hover:border-gray-300 text-gray-700'}`}>
                      <div className="font-bold text-xl">{n}</div>
                      <div className="text-[10px] uppercase tracking-widest font-semibold">{n === 1 ? 'time' : 'times'}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-widest font-semibold text-purple-600 mb-2">3 · Pick the {cfg.payDates.length > 1 ? 'dates' : 'date'}</div>
                <div className="space-y-2">
                  {cfg.payDates.map((d, idx) => (
                    <div key={idx} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">
                      <div className="w-7 h-7 rounded-full bg-purple-600 text-white flex items-center justify-center text-sm font-bold">{idx + 1}</div>
                      <span className="text-sm text-gray-600">Pay day {idx + 1} is the</span>
                      <Select value={d} onChange={(e) => setPayDateAt(idx, e.target.value)} className="!w-auto flex-1 max-w-[180px]">
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>{dayOfMonthLabel(n)}</option>
                        ))}
                        <option value="last">Last day of month</option>
                      </Select>
                      <span className="text-sm text-gray-500">of each month</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-2">
                  <Icon name="bolt" className="w-3.5 h-3.5 inline text-purple-600 mr-1" />
                  Pays on the {sortedPayDates.map(dayOfMonthLabel).join(' and ')} of every month.
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-widest font-semibold text-purple-600 mb-2">4 · If pay date lands on a weekend</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { v: 'prior', label: 'Pay Friday before' },
                    { v: 'after', label: 'Pay Monday after' },
                    { v: 'as-is', label: 'Leave as-is' },
                  ].map((opt) => (
                    <button key={opt.v} onClick={() => set({ weekendRule: opt.v })}
                      className={`px-3 py-2 rounded-lg border-2 text-sm transition-colors ${cfg.weekendRule === opt.v ? 'border-purple-500 bg-purple-50 text-purple-900 font-semibold' : 'border-gray-200 text-gray-700 hover:border-gray-300'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {(cfg.cadence === 'weekly' || cfg.cadence === 'bi-weekly') && (
            <div>
              <div className="text-[10px] uppercase tracking-widest font-semibold text-purple-600 mb-2">2 · Anchor date</div>
              <Field label="Period 1 starts on" hint="All future periods follow from this date.">
                <Input type="date" value={cfg.anchor} onChange={(e) => set({ anchor: e.target.value })} />
              </Field>
            </div>
          )}

          {/* Processing config */}
          <div>
            <div className="text-[10px] uppercase tracking-widest font-semibold text-purple-600 mb-2">{cfg.cadence === 'by-date' ? '5' : '3'} · Processing</div>
            <div className="space-y-4">
              <Field label="Pay delay" hint="Gap between when work ends and when payroll runs. Set to 0 if you pay on the period end date.">
                <div className="flex items-center gap-3">
                  <Input type="number" min="0" max="30" value={cfg.payDelayDays} onChange={(e) => set({ payDelayDays: Number(e.target.value) })} className="!w-24" />
                  <span className="text-sm text-gray-500">days from period end → pay date</span>
                </div>
              </Field>
              <Field label="Approval cutoff" hint="Days after period ends before entries lock for editing.">
                <div className="flex items-center gap-3">
                  <Input type="number" min="0" max="14" value={cfg.processingBufferDays} onChange={(e) => set({ processingBufferDays: Number(e.target.value) })} className="!w-24" />
                  <span className="text-sm text-gray-500">days from period end → cutoff</span>
                </div>
              </Field>
            </div>
          </div>

          {/* Approver */}
          <div>
            <div className="text-[10px] uppercase tracking-widest font-semibold text-purple-600 mb-2">{cfg.cadence === 'by-date' ? '6' : '4'} · Approver</div>
            <Field label="Primary approver" hint="Notified when periods enter review.">
              <Select value={cfg.approverId} onChange={(e) => set({ approverId: e.target.value })}>
                {users.filter((u) => ['Owner','Admin','Project Manager'].includes(u.role)).map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
              </Select>
            </Field>
            <label className="flex items-center gap-2 mt-3 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={cfg.autoClose} onChange={(e) => set({ autoClose: e.target.checked })} className="rounded text-purple-600 focus:ring-purple-500" />
              Auto-close periods when the approval cutoff passes
            </label>
          </div>
        </div>

        {/* RIGHT: preview */}
        <div className="lg:sticky lg:top-0 lg:self-start space-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-widest font-semibold text-purple-600 mb-2">Preview · Next 4 pay dates</div>
            <p className="text-xs text-gray-500 mb-3">Based on your settings. Save the schedule, then generate periods to apply.</p>
          </div>
          <div className="space-y-2.5">
            {preview.map((p, i) => {
              const payDateObj = parseLocalDate(p.payDate);
              const isWeekend = payDateObj.getDay() === 0 || payDateObj.getDay() === 6;
              return (
                <div key={i} className="border border-gray-200 rounded-xl p-4 bg-gradient-to-br from-white to-purple-50/30">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-bold text-gray-900">{p.label}</div>
                    <Pill color="purple">Pay run {i + 1}</Pill>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div>
                      <div className="text-gray-400 uppercase tracking-widest text-[10px] font-semibold">Work ends</div>
                      <div className="text-gray-900 font-semibold mt-0.5 tabular-nums">{parseLocalDate(p.end).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</div>
                    </div>
                    <div>
                      <div className="text-gray-400 uppercase tracking-widest text-[10px] font-semibold">Lock</div>
                      <div className="text-orange-700 font-semibold mt-0.5 tabular-nums">{parseLocalDate(p.approvalCutoff).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</div>
                    </div>
                    <div>
                      <div className="text-gray-400 uppercase tracking-widest text-[10px] font-semibold flex items-center gap-1">Pay date {isWeekend && <span className="text-red-600">⚠</span>}</div>
                      <div className="text-purple-700 font-bold mt-0.5 tabular-nums">{payDateObj.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ===========================================================================
// Generate-more-periods modal (uses current config)
// ===========================================================================
function GeneratePeriodsModal({ onClose, onSubmit }) {
  const { payConfig } = useApp();
  const [count, setCount] = useAdminState(6);
  const [fromDate, setFromDate] = useAdminState(new Date().toISOString().slice(0, 10));
  const preview = generatePeriodSchedule(payConfig, Math.min(Number(count) || 1, 12), fromDate);

  return (
    <Modal open onClose={onClose} title="Generate more pay periods" size="md"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => onSubmit({ count: Number(count), fromDate })}>
          <Icon name="plus" className="w-4 h-4" />Generate {count} periods
        </Button>
      </>}>
      <div className="space-y-4">
        <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 text-xs text-purple-800">
          <Icon name="bolt" className="w-3.5 h-3.5 inline-block mr-1" />
          Using current schedule: <span className="font-bold">{cadenceLabel(payConfig.cadence)}</span> · {payConfig.processingBufferDays}-day buffer · pay {payConfig.payDelayDays} days after period end.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starting from"><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></Field>
          <Field label="How many"><Input type="number" min="1" max="24" value={count} onChange={(e) => setCount(e.target.value)} /></Field>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest font-semibold text-gray-500 mb-2">Preview · First {Math.min(Number(count) || 1, 4)} periods</div>
          <div className="space-y-1.5">
            {preview.slice(0, 4).map((p, i) => (
              <div key={i} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                <span className="font-semibold text-gray-900">{p.label}</span>
                <span className="text-xs text-gray-500">Pay <span className="font-bold text-purple-700">{parseLocalDate(p.payDate).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ===========================================================================
// Company
// ===========================================================================
function CompanyTab() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="p-6">
        <Section title="Company profile" eyebrow="The studio">
          <div className="space-y-3 text-sm">
            <Row label="Legal name" value="Allebrum, LLC" />
            <Row label="Founded" value="2010" />
            <Row label="HQ" value="Sacramento, CA 95816" />
            <Row label="Roseville" value="2281 Lava Ridge Court, Suite 200" />
            <Row label="Email" value="hello@allebrum.com" />
            <Row label="Phone" value="(916) 633-4366" />
          </div>
        </Section>
      </Card>
      <Card className="p-6">
        <Section title="Govcon credentials" eyebrow="Always in the footer">
          <div className="space-y-3">
            <Cred label="SAM" value="Registered" />
            <Cred label="Small/Micro Business" value="DGS# 2009291" />
            <Cred label="CAGE" value="82TS2" />
            <Cred label="DUNS" value="065729366" />
          </div>
          <div className="mt-5 p-3 rounded-xl bg-gray-50 text-xs text-gray-600">
            These credentials appear in PDF report headers and exported invoices automatically.
          </div>
        </Section>
      </Card>
    </div>
  );
}

const Row = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-4 py-2 border-b border-gray-100 last:border-0">
    <span className="text-xs uppercase tracking-widest font-semibold text-gray-500">{label}</span>
    <span className="text-sm text-gray-900 font-semibold">{value}</span>
  </div>
);
const Cred = ({ label, value }) => (
  <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
    <span className="text-sm text-gray-700">{label}</span>
    <span className="font-mono text-sm font-bold text-purple-700">{value}</span>
  </div>
);

window.PageAdmin = PageAdmin;
