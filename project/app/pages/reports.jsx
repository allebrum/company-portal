/* global React, Icon, useApp, byId, fmtMins, fmtMoney, Card, Tile, Pill, Avatar, Eyebrow, Button, Section, Dot, Field, Input, Select, TabStrip */
const { useState: useRepState, useMemo: useRepMemo } = React;

const PERIODS = [
  { value: '7',   label: 'Last 7 days' },
  { value: '14',  label: 'Last 14 days' },
  { value: '30',  label: 'Last 30 days' },
];

function PageReports() {
  const { entries, projects, clients, users } = useApp();
  const [period, setPeriod] = useRepState('14');
  const [groupBy, setGroupBy] = useRepState('client'); // client | project | person | day
  const [onlyBillable, setOnlyBillable] = useRepState(false);

  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - parseInt(period, 10));

  const scoped = useRepMemo(() => entries.filter((e) => {
    if (new Date(e.startIso) < cutoff) return false;
    const p = byId(projects, e.projectId);
    if (onlyBillable && (!p || !p.billable)) return false;
    return true;
  }), [entries, cutoff, onlyBillable, projects]);

  // headline numbers
  const totalMin = scoped.reduce((s, e) => s + e.durationMin, 0);
  const billableMin = scoped.filter((e) => byId(projects, e.projectId)?.billable).reduce((s, e) => s + e.durationMin, 0);
  const revenue = scoped.reduce((s, e) => {
    const p = byId(projects, e.projectId); const u = byId(users, e.userId);
    if (!p || !p.billable || !u) return s;
    return s + (e.durationMin / 60) * u.billable;
  }, 0);
  const avgPerDay = totalMin / Math.max(1, parseInt(period, 10));

  // group accumulator
  const groups = {};
  scoped.forEach((e) => {
    const p = byId(projects, e.projectId);
    let key, label, color;
    if (groupBy === 'client') { const c = p ? byId(clients, p.clientId) : null; key = c?.id || 'unk'; label = c?.name || 'Unknown'; color = c?.color; }
    else if (groupBy === 'project') { key = p?.id || 'unk'; label = p?.name || 'Unknown'; color = p?.color; }
    else if (groupBy === 'person')  { const u = byId(users, e.userId); key = u?.id || 'unk'; label = u?.name || 'Unknown'; color = u?.color; }
    else { key = e.startIso.slice(0, 10); label = new Date(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); color = '#9333ea'; }

    const u = byId(users, e.userId);
    const rev = (p && p.billable && u) ? (e.durationMin / 60) * u.billable : 0;
    if (!groups[key]) groups[key] = { key, label, color: color || '#9333ea', min: 0, billableMin: 0, revenue: 0, entries: 0 };
    groups[key].min += e.durationMin;
    groups[key].entries += 1;
    if (p && p.billable) groups[key].billableMin += e.durationMin;
    groups[key].revenue += rev;
  });
  const groupRows = Object.values(groups).sort((a, b) => b.min - a.min);
  const maxGroupMin = Math.max(1, ...groupRows.map((r) => r.min));

  // billable donut data
  const nonBillableMin = totalMin - billableMin;
  const pct = totalMin > 0 ? billableMin / totalMin : 0;

  // export — CSV
  const exportCsv = () => {
    const rows = [['Date','User','Client','Project','Note','Duration (min)','Billable','Revenue']];
    scoped.forEach((e) => {
      const p = byId(projects, e.projectId);
      const c = p ? byId(clients, p.clientId) : null;
      const u = byId(users, e.userId);
      const rev = (p && p.billable && u) ? Math.round((e.durationMin/60) * u.billable * 100)/100 : 0;
      rows.push([
        e.startIso.slice(0, 10),
        u?.name || '',
        c?.name || '',
        p?.name || '',
        e.note,
        e.durationMin,
        p?.billable ? 'Y' : 'N',
        rev.toFixed(2),
      ]);
    });
    const csv = rows.map((r) => r.map((cell) => {
      const s = String(cell ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `allebrum-time-report-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <Eyebrow>Reports</Eyebrow>
          <h1 className="text-3xl font-bold text-gray-900 mt-1">Hours, billables, downright awesome insights</h1>
          <p className="text-gray-500 mt-1">Slice the studio's time by client, project, person, or day. Then export the bill.</p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={period} onChange={(e) => setPeriod(e.target.value)} className="!w-auto">
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
          <Button variant="outline" size="md" onClick={() => window.print()}><Icon name="download" className="w-4 h-4" />PDF</Button>
          <Button variant="primary" size="md" onClick={exportCsv}><Icon name="exportIcon" className="w-4 h-4" />Export CSV</Button>
        </div>
      </div>

      {/* Headline grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile className="p-5">
          <Eyebrow>Total hours</Eyebrow>
          <div className="text-3xl font-bold text-gray-900 mt-1 tabular-nums">{fmtMins(totalMin)}</div>
          <div className="text-xs text-gray-500 mt-1">{scoped.length} entries</div>
        </Tile>
        <Tile className="p-5">
          <Eyebrow>Billable hours</Eyebrow>
          <div className="text-3xl font-bold text-gray-900 mt-1 tabular-nums">{fmtMins(billableMin)}</div>
          <div className="text-xs text-gray-500 mt-1">{Math.round(pct*100)}% of total</div>
        </Tile>
        <Tile className="p-5">
          <Eyebrow>Avg / day</Eyebrow>
          <div className="text-3xl font-bold text-gray-900 mt-1 tabular-nums">{fmtMins(avgPerDay)}</div>
          <div className="text-xs text-gray-500 mt-1">across {period} days</div>
        </Tile>
        <Tile className="p-5 bg-gradient-to-br from-purple-600 to-purple-700 text-white border-transparent">
          <p className="text-[11px] uppercase tracking-widest font-semibold text-purple-200">Billable revenue</p>
          <div className="text-3xl font-bold mt-1 tabular-nums">{fmtMoney(revenue)}</div>
          <div className="text-xs text-purple-200 mt-1">at current bill rates</div>
        </Tile>
      </div>

      {/* Donut + group selector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-5">
          <Section title="Billable vs internal" eyebrow="Mix">
            <div className="flex items-center gap-6">
              <Donut billable={billableMin} nonBillable={nonBillableMin} />
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm" style={{ background: '#9333ea' }}></span><span className="text-gray-700 font-semibold">Billable</span><span className="text-gray-500 tabular-nums">{fmtMins(billableMin)}</span></div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-gray-300"></span><span className="text-gray-700 font-semibold">Internal</span><span className="text-gray-500 tabular-nums">{fmtMins(nonBillableMin)}</span></div>
              </div>
            </div>
          </Section>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <Section title="Breakdown" eyebrow={`Grouped by ${groupBy}`} action={
            <TabStrip
              value={groupBy}
              onChange={setGroupBy}
              tabs={[
                { value: 'client',  label: 'Client',  icon: 'building' },
                { value: 'project', label: 'Project', icon: 'folder' },
                { value: 'person',  label: 'Person',  icon: 'user' },
                { value: 'day',     label: 'Day',     icon: 'calendar' },
              ]}
            />
          }>
            <div className="space-y-2.5">
              {groupRows.map((r) => (
                <div key={r.key} className="grid grid-cols-[1fr_auto] gap-3 items-center">
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <Dot color={r.color} />
                        <span className="font-semibold text-gray-900 truncate">{r.label}</span>
                      </div>
                      <span className="text-xs text-gray-500 tabular-nums">{fmtMins(r.min)} · {fmtMoney(r.revenue)}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(r.min/maxGroupMin)*100}%`, background: r.color }}></div>
                    </div>
                  </div>
                </div>
              ))}
              {groupRows.length === 0 && <div className="text-sm text-gray-500 py-6 text-center">No data in this window.</div>}
            </div>
          </Section>
        </Card>
      </div>

      {/* Detailed breakdown table */}
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">Detail rows</h2>
            <p className="text-xs text-gray-500 mt-0.5">First 30 rows · export CSV for the full set</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={onlyBillable} onChange={(e) => setOnlyBillable(e.target.checked)} className="rounded text-purple-600" />
            Billable only
          </label>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-[11px] uppercase tracking-widest text-gray-500 font-bold text-left">
              <th className="px-5 py-2.5">Date</th>
              <th className="px-5 py-2.5">Person</th>
              <th className="px-5 py-2.5">Client / Project</th>
              <th className="px-5 py-2.5">Note</th>
              <th className="px-5 py-2.5 text-right">Hours</th>
              <th className="px-5 py-2.5 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {scoped.slice(0, 30).map((e) => {
              const p = byId(projects, e.projectId);
              const c = p ? byId(clients, p.clientId) : null;
              const u = byId(users, e.userId);
              const rev = (p && p.billable && u) ? (e.durationMin / 60) * u.billable : 0;
              return (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-5 py-2.5 text-gray-700 whitespace-nowrap tabular-nums">{e.startIso.slice(0,10)}</td>
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-2"><Avatar user={u} size={22} /><span className="text-gray-900 font-semibold">{u?.name}</span></div>
                  </td>
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-2"><Dot color={c?.color || '#9333ea'} /><span className="text-gray-700">{c?.name}</span><span className="text-gray-300">·</span><span className="text-gray-500 text-xs">{p?.name}</span></div>
                  </td>
                  <td className="px-5 py-2.5 text-gray-700 max-w-[280px] truncate">{e.note}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums font-semibold text-gray-900">{fmtMins(e.durationMin)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-gray-700">{rev > 0 ? fmtMoney(rev) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// Simple donut chart
function Donut({ billable, nonBillable, size = 140 }) {
  const total = billable + nonBillable || 1;
  const r = size / 2 - 12;
  const C = 2 * Math.PI * r;
  const billableArc = (billable / total) * C;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e5e7eb" strokeWidth="14" />
      <circle
        cx={size/2} cy={size/2} r={r}
        fill="none"
        stroke="#9333ea"
        strokeWidth="14"
        strokeDasharray={`${billableArc} ${C}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
      />
      <text x="50%" y="48%" textAnchor="middle" className="fill-gray-900" style={{ fontSize: '22px', fontWeight: 700 }}>{Math.round((billable/total)*100)}%</text>
      <text x="50%" y="64%" textAnchor="middle" className="fill-gray-500" style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Billable</text>
    </svg>
  );
}

window.PageReports = PageReports;
