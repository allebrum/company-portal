/* global React, Icon, useApp, byId, fmtMins, fmtMoney, Card, Tile, Pill, Avatar, Eyebrow, Button, Section, Dot, Modal, Field, Input, Select, Textarea, projectsForClient, ENTRY_STATUS_LABEL, ENTRY_STATUS_PILL, PAY_PERIOD_STATUS_LABEL */
const { useState: useTimeState, useMemo: useTimeMemo } = React;

function PageTime() {
  const { me, users, clients, projects, entries, payPeriods, addManualEntry, startTimer, submitEntries, timer } = useApp();
  const [filterUser, setFilterUser] = useTimeState('me');
  const [filterClient, setFilterClient] = useTimeState('all');
  const [filterPeriod, setFilterPeriod] = useTimeState('all');
  const [manual, setManual] = useTimeState(false);

  // 7-day window for the chart
  const days = useTimeMemo(() => {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      out.push({ iso: d.toISOString().slice(0, 10), label: d.toLocaleDateString('en-US', { weekday: 'short' }), date: d });
    }
    return out;
  }, []);

  const filtered = useTimeMemo(() => entries.filter((e) => {
    if (filterUser === 'me' && e.userId !== me.id) return false;
    if (filterUser !== 'me' && filterUser !== 'all' && e.userId !== filterUser) return false;
    if (filterClient !== 'all') {
      const p = byId(projects, e.projectId);
      if (!p || p.clientId !== filterClient) return false;
    }
    if (filterPeriod !== 'all' && e.payPeriodId !== filterPeriod) return false;
    return true;
  }), [entries, filterUser, filterClient, filterPeriod, me.id, projects]);

  // bucket by day for chart
  const dayBuckets = days.map((d) => {
    const min = filtered.filter((e) => e.startIso.slice(0, 10) === d.iso).reduce((s, e) => s + e.durationMin, 0);
    return { ...d, min };
  });
  const maxDay = Math.max(60, ...dayBuckets.map((d) => d.min));
  const weekTotal = dayBuckets.reduce((s, d) => s + d.min, 0);

  // ---- Group by date for entry list ----
  const recent = filtered.slice(0, 60);
  const grouped = {};
  recent.forEach((e) => {
    const key = e.startIso.slice(0, 10);
    (grouped[key] = grouped[key] || []).push(e);
  });
  const groupKeys = Object.keys(grouped).sort((a, b) => b.localeCompare(a)).slice(0, 5);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <Eyebrow>Time tracking</Eyebrow>
          <h1 className="text-3xl font-bold text-gray-900 mt-1">Every minute counted</h1>
          <p className="text-gray-500 mt-1">Real load means real timesheets. Track it as you go, log a missed entry, ship the invoice.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="md" onClick={() => setManual(true)}><Icon name="plus" className="w-4 h-4" />Log entry</Button>
          <Button variant="primary" size="md" onClick={() => document.querySelector('[data-start-shortcut]')?.click()} disabled={!!timer}>
            <Icon name="play" className="w-4 h-4" />{timer ? 'Timer running' : 'Quick start'}
          </Button>
        </div>
      </div>

      {/* Filters + chart card */}
      <Card className="p-5">
        <div className="flex flex-wrap gap-3 items-end justify-between mb-5">
          <div className="flex flex-wrap gap-3">
            <Field label="Person" className="min-w-[180px]">
              <Select value={filterUser} onChange={(e) => setFilterUser(e.target.value)}>
                <option value="me">Me ({me.name.split(' ')[0]})</option>
                <option value="all">Entire team</option>
                <optgroup label="By person">
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </optgroup>
              </Select>
            </Field>
            <Field label="Client" className="min-w-[180px]">
              <Select value={filterClient} onChange={(e) => setFilterClient(e.target.value)}>
                <option value="all">All clients</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Pay period" className="min-w-[220px]">
              <Select value={filterPeriod} onChange={(e) => setFilterPeriod(e.target.value)}>
                <option value="all">All periods</option>
                {payPeriods.slice().reverse().map((p) => (
                  <option key={p.id} value={p.id}>{p.label} · {PAY_PERIOD_STATUS_LABEL[p.status]}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="text-right">
            <Eyebrow>Last 7 days</Eyebrow>
            <div className="text-3xl font-bold text-gray-900 mt-1 tabular-nums">{fmtMins(weekTotal)}</div>
          </div>
        </div>

        {/* Bar chart */}
        <div className="flex items-stretch gap-2 h-44 px-2">
          {dayBuckets.map((d) => {
            const isToday = d.iso === new Date().toISOString().slice(0, 10);
            return (
              <div key={d.iso} className="flex-1 flex flex-col items-center gap-2 group">
                <div className="flex-1 w-full flex items-end justify-center">
                  <div className="w-full rounded-lg transition-all hover:opacity-90 relative"
                       style={{ height: `${Math.max(2, (d.min/maxDay)*100)}%`, background: isToday ? 'linear-gradient(180deg, #9333ea, #7e22ce)' : '#e9d5ff' }}>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-7 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[11px] font-semibold px-2 py-1 rounded-md whitespace-nowrap">{fmtMins(d.min)}</div>
                  </div>
                </div>
                <div className={`text-xs ${isToday ? 'text-purple-700 font-bold' : 'text-gray-500'}`}>{d.label}</div>
                <div className={`text-[10px] tabular-nums ${isToday ? 'text-purple-700 font-semibold' : 'text-gray-400'}`}>{d.date.getDate()}</div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Submit-for-approval banner */}
      {(() => {
        const myDrafts = entries.filter((e) => e.userId === me.id && e.status === 'draft');
        if (myDrafts.length === 0) return null;
        const draftMin = myDrafts.reduce((s, e) => s + e.durationMin, 0);
        return (
          <Card className="p-4 bg-gradient-to-r from-purple-50 to-purple-100 border-purple-200 flex items-center gap-4 flex-wrap">
            <div className="p-2 rounded-lg bg-purple-600 text-white"><Icon name="send" className="w-4 h-4" /></div>
            <div className="flex-1 min-w-[200px]">
              <div className="font-bold text-gray-900">{myDrafts.length} draft entries · {fmtMins(draftMin)} ready to submit</div>
              <div className="text-sm text-gray-600">Submit them for admin approval — they'll get a notification.</div>
            </div>
            <Button variant="primary" onClick={() => submitEntries(myDrafts.map((e) => e.id))}>
              <Icon name="send" className="w-4 h-4" />Submit all drafts
            </Button>
          </Card>
        );
      })()}

      {/* Entry log */}
      <Card>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Time entries</h2>
          <span className="text-xs text-gray-500">{filtered.length} entries</span>
        </div>
        <div className="divide-y divide-gray-100">
          {groupKeys.map((key) => {
            const day = new Date(key);
            const isToday = key === new Date().toISOString().slice(0, 10);
            const dayMin = grouped[key].reduce((s, e) => s + e.durationMin, 0);
            return (
              <div key={key}>
                <div className="px-5 py-3 bg-gray-50 flex items-center justify-between sticky">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-bold text-gray-900">
                      {isToday ? 'Today' : day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                    </div>
                    {isToday && <Pill color="purple">Today</Pill>}
                  </div>
                  <div className="text-xs text-gray-500 tabular-nums font-semibold">{fmtMins(dayMin)}</div>
                </div>
                {grouped[key].slice(0, 10).map((e) => {
                  const proj = byId(projects, e.projectId);
                  const client = proj ? byId(clients, proj.clientId) : null;
                  const user = byId(users, e.userId);
                  const start = new Date(e.startIso);
                  return (
                    <div key={e.id} className="px-5 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors">
                      <Avatar user={user} size={32} />
                      <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-center">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-900 truncate">{e.note}</div>
                          <div className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5">
                            {client && <Dot color={client.color} />}
                            <span className="truncate">{client ? client.name : ''} · {proj ? proj.name : ''}</span>
                          </div>
                          {e.rejectionNote && <div className="text-xs text-red-600 mt-1 italic">⤷ {e.rejectionNote}</div>}
                        </div>
                        <div className="text-xs text-gray-500 tabular-nums whitespace-nowrap">
                          {start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        </div>
                        {proj && (
                          <Pill color={proj.billable ? 'green' : 'gray'}>{proj.billable ? 'Billable' : 'Internal'}</Pill>
                        )}
                        <Pill color={ENTRY_STATUS_PILL[e.status]}>{ENTRY_STATUS_LABEL[e.status]}</Pill>
                        <div className="text-sm font-bold text-gray-900 tabular-nums whitespace-nowrap min-w-[60px] text-right">{fmtMins(e.durationMin)}</div>
                      </div>
                      {e.status === 'draft' && e.userId === me.id && (
                        <button onClick={() => submitEntries([e.id])} title="Submit for approval" className="p-2 rounded-lg text-gray-400 hover:bg-purple-100 hover:text-purple-700 transition-colors">
                          <Icon name="send" className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => startTimer({ projectId: e.projectId, note: e.note })} title="Resume this work" className="p-2 rounded-lg text-gray-400 hover:bg-purple-100 hover:text-purple-700 transition-colors">
                        <Icon name="refresh" className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Card>

      {manual && <ManualEntryModal onClose={() => setManual(false)} onSubmit={(payload) => { addManualEntry(payload); setManual(false); }} />}
    </div>
  );
}

function ManualEntryModal({ onClose, onSubmit }) {
  const { clients, projects } = useApp();
  const [clientId, setClientId] = useTimeState(clients[0]?.id);
  const projOpts = projectsForClient(projects, clientId);
  const [projectId, setProjectId] = useTimeState(projOpts[0]?.id);
  const [note, setNote] = useTimeState('');
  const [hours, setHours] = useTimeState('1');
  const [date, setDate] = useTimeState(new Date().toISOString().slice(0, 10));

  const submit = () => {
    if (!projectId || !note) return;
    const durationMin = Math.max(1, Math.round(parseFloat(hours || '0') * 60));
    onSubmit({ projectId, note, startIso: `${date}T09:00:00`, durationMin });
  };

  return (
    <Modal open onClose={onClose} title="Log a time entry" size="md"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save entry</Button>
      </>}>
      <div className="space-y-4">
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
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you work on?" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Hours" hint="e.g. 1.5"><Input type="number" min="0.25" step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}

window.PageTime = PageTime;
