/* global React, Icon, useApp, byId, fmtMins, fmtMoney, Card, Tile, Pill, Avatar, Eyebrow, Button, Section, Dot, Modal, Field, Input, Textarea, Select, TabStrip, Empty, ENTRY_STATUS_LABEL, ENTRY_STATUS_PILL, PAY_PERIOD_STATUS_LABEL, PAY_PERIOD_STATUS_PILL , parseLocalDate */
const { useState: useApprState, useMemo: useApprMemo } = React;

function PageApprovals() {
  const { entries, payPeriods, users, clients, projects, approveEntries, rejectEntries, reopenEntries, closePeriod, moveToReview, me } = useApp();

  // pick current "under review" period by default, else most recent open
  const defaultPeriodId =
    payPeriods.find((p) => p.status === 'review')?.id ||
    payPeriods.find((p) => p.status === 'open')?.id ||
    payPeriods[0]?.id;
  const [periodId, setPeriodId] = useApprState(defaultPeriodId);
  const period = byId(payPeriods, periodId);

  const [scope, setScope] = useApprState('submitted'); // submitted | all | rejected | approved
  const [selected, setSelected] = useApprState(new Set());
  const [rejectModal, setRejectModal] = useApprState(null); // { ids: [] }
  const [detail, setDetail] = useApprState(null); // user group expanded

  // entries in this period
  const periodEntries = useApprMemo(
    () => entries.filter((e) => e.payPeriodId === periodId),
    [entries, periodId]
  );

  const filteredEntries = useApprMemo(() => {
    if (scope === 'all') return periodEntries;
    return periodEntries.filter((e) => e.status === scope);
  }, [periodEntries, scope]);

  // group by user
  const groups = useApprMemo(() => {
    const map = new Map();
    filteredEntries.forEach((e) => {
      if (!map.has(e.userId)) map.set(e.userId, []);
      map.get(e.userId).push(e);
    });
    return [...map.entries()].map(([uid, es]) => {
      const u = byId(users, uid);
      const min = es.reduce((s, e) => s + e.durationMin, 0);
      const billableMin = es.filter((e) => byId(projects, e.projectId)?.billable).reduce((s, e) => s + e.durationMin, 0);
      const revenue = es.reduce((s, e) => {
        const p = byId(projects, e.projectId);
        if (!p || !p.billable || !u) return s;
        return s + (e.durationMin / 60) * u.billable;
      }, 0);
      const submittedCount = es.filter((e) => e.status === 'submitted').length;
      return { user: u, entries: es, min, billableMin, revenue, submittedCount };
    }).sort((a, b) => b.submittedCount - a.submittedCount || b.min - a.min);
  }, [filteredEntries, users, projects]);

  // headline stats
  const submittedAll = periodEntries.filter((e) => e.status === 'submitted');
  const approvedAll = periodEntries.filter((e) => e.status === 'approved');
  const rejectedAll = periodEntries.filter((e) => e.status === 'rejected');
  const submittedMin = submittedAll.reduce((s, e) => s + e.durationMin, 0);
  const approvedMin = approvedAll.reduce((s, e) => s + e.durationMin, 0);
  const totalMin = periodEntries.reduce((s, e) => s + e.durationMin, 0);
  const pctApproved = totalMin > 0 ? Math.round((approvedMin / totalMin) * 100) : 0;

  // selection helpers
  const allVisibleIds = filteredEntries.filter((e) => e.status === 'submitted').map((e) => e.id);
  const selectAllVisible = () => setSelected(new Set(allVisibleIds));
  const clearSelection = () => setSelected(new Set());
  const toggleSelect = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const toggleGroup = (groupEntries) => {
    const ids = groupEntries.filter((e) => e.status === 'submitted').map((e) => e.id);
    const allSelected = ids.every((id) => selected.has(id));
    const next = new Set(selected);
    ids.forEach((id) => { if (allSelected) next.delete(id); else next.add(id); });
    setSelected(next);
  };

  const selArray = [...selected];
  const selEntries = filteredEntries.filter((e) => selected.has(e.id));
  const selMin = selEntries.reduce((s, e) => s + e.durationMin, 0);

  const doApprove = () => { approveEntries(selArray); clearSelection(); };
  const doApproveAllPeriod = () => approveEntries(submittedAll.map((e) => e.id));
  const doReject = (note) => { rejectEntries(selArray, note); clearSelection(); setRejectModal(null); };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <Eyebrow>Approvals</Eyebrow>
          <h1 className="text-3xl font-bold text-gray-900 mt-1">Time waiting on you</h1>
          <p className="text-gray-500 mt-1">Bulk-approve a period in one swing, or zoom into any teammate and untangle the details.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={periodId} onChange={(e) => { setPeriodId(e.target.value); clearSelection(); }} className="!w-auto min-w-[260px]">
            {payPeriods.slice().reverse().map((p) => (
              <option key={p.id} value={p.id}>{p.label} · {PAY_PERIOD_STATUS_LABEL[p.status]}</option>
            ))}
          </Select>
        </div>
      </div>

      {/* Period header card */}
      {period && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex-1 min-w-[200px]">
              <Eyebrow>Pay period</Eyebrow>
              <div className="text-xl font-bold text-gray-900 mt-1">{period.label}</div>
              <div className="text-xs text-gray-500 mt-1">
                {parseLocalDate(period.start).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})} – {parseLocalDate(period.end).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'})}
              </div>
              <div className="mt-2"><Pill color={PAY_PERIOD_STATUS_PILL[period.status]}>{PAY_PERIOD_STATUS_LABEL[period.status]}</Pill></div>
            </div>

            <div className="grid grid-cols-3 gap-4 min-w-[360px]">
              <div>
                <Eyebrow>Pending</Eyebrow>
                <div className="text-2xl font-bold text-gray-900 tabular-nums mt-0.5">{submittedAll.length}</div>
                <div className="text-[11px] text-gray-500 tabular-nums">{fmtMins(submittedMin)}</div>
              </div>
              <div>
                <Eyebrow>Approved</Eyebrow>
                <div className="text-2xl font-bold text-green-600 tabular-nums mt-0.5">{approvedAll.length}</div>
                <div className="text-[11px] text-gray-500 tabular-nums">{fmtMins(approvedMin)}</div>
              </div>
              <div>
                <Eyebrow>Returned</Eyebrow>
                <div className="text-2xl font-bold text-red-600 tabular-nums mt-0.5">{rejectedAll.length}</div>
                <div className="text-[11px] text-gray-500">awaiting fix</div>
              </div>
            </div>

            <div className="flex-1 min-w-[200px]">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span className="font-semibold">Approval progress</span>
                <span className="tabular-nums">{pctApproved}%</span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-purple-500 to-purple-700" style={{ width: `${pctApproved}%` }}></div>
              </div>
              <div className="flex gap-2 mt-3">
                {period.status === 'open' && submittedAll.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => moveToReview(period.id)}><Icon name="arrowRight" className="w-3.5 h-3.5" />Move to review</Button>
                )}
                {period.status !== 'closed' && submittedAll.length > 0 && (
                  <Button variant="success" size="sm" onClick={doApproveAllPeriod}><Icon name="check" className="w-3.5 h-3.5" />Approve all</Button>
                )}
                {period.status !== 'closed' && (
                  <Button variant="primary" size="sm" onClick={() => closePeriod(period.id)} disabled={submittedAll.length > 0} title={submittedAll.length > 0 ? 'Resolve pending entries first' : 'Close & lock this period'}>
                    <Icon name="shield" className="w-3.5 h-3.5" />Close period
                  </Button>
                )}
                {period.status === 'closed' && (
                  <Pill color="green"><Icon name="check" className="w-3 h-3" />Locked · {period.closedAt ? new Date(period.closedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : ''}</Pill>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Filter strip */}
      <div className="flex items-center gap-3 flex-wrap">
        <TabStrip
          value={scope}
          onChange={(v) => { setScope(v); clearSelection(); }}
          tabs={[
            { value: 'submitted', label: `Pending (${submittedAll.length})` },
            { value: 'approved',  label: `Approved (${approvedAll.length})` },
            { value: 'rejected',  label: `Returned (${rejectedAll.length})` },
            { value: 'all',       label: 'All' },
          ]}
        />
        <div className="flex-1"></div>
        {selected.size > 0 ? (
          <>
            <span className="text-sm text-gray-600 font-semibold">{selected.size} selected · {fmtMins(selMin)}</span>
            <Button variant="outline" size="sm" onClick={clearSelection}>Clear</Button>
            <Button variant="danger" size="sm" onClick={() => setRejectModal({ ids: selArray })}><Icon name="x" className="w-3.5 h-3.5" />Return</Button>
            <Button variant="success" size="sm" onClick={doApprove}><Icon name="check" className="w-3.5 h-3.5" />Approve {selected.size}</Button>
          </>
        ) : (
          allVisibleIds.length > 0 && <Button variant="ghost" size="sm" onClick={selectAllVisible}><Icon name="check" className="w-3.5 h-3.5" />Select all pending</Button>
        )}
      </div>

      {/* Groups */}
      {groups.length === 0 ? (
        <Card><Empty icon="check" title="Inbox zero." hint="No time entries to review in this filter." /></Card>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <ApprovalGroup
              key={g.user.id}
              group={g}
              expanded={detail === g.user.id}
              onToggleExpand={() => setDetail(detail === g.user.id ? null : g.user.id)}
              selected={selected}
              onToggleSelect={toggleSelect}
              onToggleGroup={() => toggleGroup(g.entries)}
              onApprove={(ids) => approveEntries(ids)}
              onReject={(ids) => setRejectModal({ ids })}
              onReopen={(ids) => reopenEntries(ids)}
            />
          ))}
        </div>
      )}

      {rejectModal && <RejectModal onClose={() => setRejectModal(null)} onSubmit={doReject} count={rejectModal.ids.length} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
function ApprovalGroup({ group, expanded, onToggleExpand, selected, onToggleSelect, onToggleGroup, onApprove, onReject, onReopen }) {
  const { clients, projects } = useApp();
  const { user, entries, min, billableMin, revenue, submittedCount } = group;

  const submittedIds = entries.filter((e) => e.status === 'submitted').map((e) => e.id);
  const allSelected = submittedIds.length > 0 && submittedIds.every((id) => selected.has(id));

  return (
    <Card className="overflow-hidden">
      <header className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors cursor-pointer" onClick={onToggleExpand}>
        {submittedIds.length > 0 && (
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => { e.stopPropagation(); onToggleGroup(); }}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500"
          />
        )}
        <Avatar user={user} size={42} />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-gray-900">{user.name}</div>
          <div className="text-xs text-gray-500">{user.role} · {entries.length} entries</div>
        </div>

        <div className="grid grid-cols-3 gap-6 text-right">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Total</div>
            <div className="font-bold text-gray-900 tabular-nums">{fmtMins(min)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Billable</div>
            <div className="font-bold text-gray-900 tabular-nums">{fmtMins(billableMin)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Revenue</div>
            <div className="font-bold text-purple-700 tabular-nums">{fmtMoney(revenue)}</div>
          </div>
        </div>

        {submittedCount > 0 && (
          <div className="flex items-center gap-2">
            <Pill color="yellow">{submittedCount} pending</Pill>
            <Button variant="success" size="sm" onClick={(e) => { e.stopPropagation(); onApprove(submittedIds); }}>
              <Icon name="check" className="w-3.5 h-3.5" />Approve
            </Button>
          </div>
        )}

        <Icon name={expanded ? 'chevronUp' : 'chevronDown'} className="w-4 h-4 text-gray-400" />
      </header>

      {expanded && (
        <div className="border-t border-gray-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] uppercase tracking-widest text-gray-500 font-bold text-left">
                <th className="px-5 py-2.5 w-10"></th>
                <th className="px-5 py-2.5">Date</th>
                <th className="px-5 py-2.5">Client / Project</th>
                <th className="px-5 py-2.5">Note</th>
                <th className="px-5 py-2.5 text-right">Hours</th>
                <th className="px-5 py-2.5">Status</th>
                <th className="px-5 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((e) => {
                const p = byId(projects, e.projectId);
                const c = p ? byId(clients, p.clientId) : null;
                const canSelect = e.status === 'submitted';
                return (
                  <tr key={e.id} className={`hover:bg-gray-50 ${selected.has(e.id) ? 'bg-purple-50/40' : ''}`}>
                    <td className="px-5 py-2.5">
                      {canSelect && (
                        <input
                          type="checkbox"
                          checked={selected.has(e.id)}
                          onChange={() => onToggleSelect(e.id)}
                          className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500"
                        />
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-gray-700 tabular-nums whitespace-nowrap">{e.startIso.slice(0, 10)}</td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <Dot color={c?.color || '#9333ea'} />
                        <span className="text-gray-900 font-semibold truncate">{c?.name}</span>
                        <span className="text-gray-300">·</span>
                        <span className="text-gray-500 truncate">{p?.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-2.5 text-gray-700 max-w-[280px] truncate">
                      {e.note}
                      {e.rejectionNote && <div className="text-xs text-red-600 mt-0.5 italic">⤷ {e.rejectionNote}</div>}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums font-semibold text-gray-900">{fmtMins(e.durationMin)}</td>
                    <td className="px-5 py-2.5"><Pill color={ENTRY_STATUS_PILL[e.status]}>{ENTRY_STATUS_LABEL[e.status]}</Pill></td>
                    <td className="px-5 py-2.5 text-right">
                      {e.status === 'submitted' && (
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => onReject([e.id])} className="p-1.5 rounded-lg text-gray-400 hover:bg-red-100 hover:text-red-600 transition-colors" title="Return"><Icon name="x" className="w-4 h-4" /></button>
                          <button onClick={() => onApprove([e.id])} className="p-1.5 rounded-lg text-gray-400 hover:bg-green-100 hover:text-green-700 transition-colors" title="Approve"><Icon name="check" className="w-4 h-4" /></button>
                        </div>
                      )}
                      {e.status === 'approved' && (
                        <button onClick={() => onReopen([e.id])} className="text-xs text-gray-500 hover:text-purple-700 font-semibold" title="Reopen">Reopen</button>
                      )}
                      {e.status === 'rejected' && (
                        <Pill color="red">Sent back</Pill>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
function RejectModal({ onClose, onSubmit, count }) {
  const [note, setNote] = useApprState('');
  return (
    <Modal open onClose={onClose} title={`Return ${count} ${count === 1 ? 'entry' : 'entries'} for review`} size="md"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={() => onSubmit(note)}><Icon name="x" className="w-4 h-4" />Return for fixes</Button>
      </>}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">The submitter will get this note and can re-submit after fixing the entry. They keep the original timestamp.</p>
        <Field label="Note (visible to submitter)">
          <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Please split this entry by client — looks like it spans two projects." />
        </Field>
      </div>
    </Modal>
  );
}

window.PageApprovals = PageApprovals;
