'use client';

import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Button, Card, Section, Tile } from '@/components/ui';
import { Field, Input, Select } from '@/components/ui/Field';
import { BurnLineChart } from '@/components/reports/BurnLineChart';
import { UtilizationBars } from '@/components/reports/UtilizationBars';
import { useEntries, useUsers, useProjects, useClients } from '@/hooks/useResources';
import { toCsv, downloadCsv } from '@/lib/csv';
import { fmtMins, fmtMoney, isoDate, parseLocalDate } from '@/lib/formatters';
import { startOfDay } from '@/lib/roadmap';

const RANGES = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};
type RangeKey = keyof typeof RANGES | 'custom';

export default function ReportsPage() {
  const { data: entries = [] } = useEntries();
  const { data: users = [] } = useUsers();
  const { data: projects = [] } = useProjects();
  const { data: clients = [] } = useClients();

  const [range, setRange] = useState<RangeKey>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [personFilter, setPersonFilter] = useState('all');

  // [fromIso, toIso) bounds on entry start times, plus local-day bounds for
  // the burn chart's X axis. Presets keep the original rolling cutoff (now
  // minus N days, no upper bound); custom is two inclusive local dates.
  const period = useMemo((): { fromIso: string; toIso: string | null; fromDay: Date; toDay: Date } => {
    if (range === 'custom') {
      let fromDay = parseLocalDate(customFrom || null);
      let toDay = parseLocalDate(customTo || null);
      fromDay = fromDay ?? toDay ?? startOfDay(new Date());
      toDay = toDay ?? startOfDay(new Date());
      if (fromDay > toDay) [fromDay, toDay] = [toDay, fromDay];
      const toEx = new Date(toDay);
      toEx.setDate(toEx.getDate() + 1); // exclusive upper bound = inclusive "to" date
      return { fromIso: fromDay.toISOString(), toIso: toEx.toISOString(), fromDay, toDay };
    }
    const d = new Date();
    d.setDate(d.getDate() - RANGES[range]);
    return { fromIso: d.toISOString(), toIso: null, fromDay: startOfDay(d), toDay: startOfDay(new Date()) };
  }, [range, customFrom, customTo]);

  const onRangeChange = (v: RangeKey) => {
    if (v === 'custom' && !customFrom && !customTo) {
      // Pre-fill with the preset window currently shown so "Custom" starts
      // from familiar bounds instead of an empty form.
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - (range === 'custom' ? 30 : RANGES[range]));
      setCustomFrom(isoDate(from));
      setCustomTo(isoDate(to));
    }
    setRange(v);
  };

  // Filters compose: range AND project AND person, applied to all three reports.
  const recent = entries.filter((e) =>
    e.startIso >= period.fromIso &&
    (period.toIso == null || e.startIso < period.toIso) &&
    (projectFilter === 'all' || e.projectId === projectFilter) &&
    (personFilter === 'all' || e.userId === personFilter));

  const totalMin = recent.reduce((s, e) => s + e.durationMin, 0);
  const billableEntries = recent.filter((e) => projects.find((p) => p.id === e.projectId)?.billable);
  const billMin = billableEntries.reduce((s, e) => s + e.durationMin, 0);
  const billRev = billableEntries.reduce((s, e) => {
    const u = users.find((x) => x.id === e.userId);
    const rate = u ? Number(u.billable) : 0;
    return s + (e.durationMin / 60) * rate;
  }, 0);

  // Utilization per user (only the selected person when that filter is set)
  const visibleUsers = personFilter === 'all' ? users : users.filter((u) => u.id === personFilter);
  const utilization = visibleUsers.map((u) => {
    const userEntries = recent.filter((e) => e.userId === u.id);
    const min = userEntries.reduce((s, e) => s + e.durationMin, 0);
    const bMin = userEntries.filter((e) => projects.find((p) => p.id === e.projectId)?.billable).reduce((s, e) => s + e.durationMin, 0);
    return { user: u, totalMin: min, billableMin: bMin };
  }).sort((a, b) => b.totalMin - a.totalMin);

  // Project burn
  const burn = projects.map((p) => {
    const used = recent.filter((e) => e.projectId === p.id).reduce((s, e) => s + e.durationMin, 0) / 60;
    return { project: p, used, budget: p.budgetHrs };
  }).filter((r) => r.used > 0).sort((a, b) => b.used - a.used);

  // Client invoicing
  const clientTotals = clients.map((c) => {
    const projIds = projects.filter((p) => p.clientId === c.id).map((p) => p.id);
    const cEntries = recent.filter((e) => e.projectId != null && projIds.includes(e.projectId));
    const rev = cEntries.reduce((s, e) => {
      const proj = projects.find((p) => p.id === e.projectId);
      if (!proj?.billable) return s;
      const u = users.find((x) => x.id === e.userId);
      const rate = u ? Number(u.billable) : 0;
      return s + (e.durationMin / 60) * rate;
    }, 0);
    return { client: c, rev };
  }).filter((r) => r.rev > 0).sort((a, b) => b.rev - a.rev);

  // S3.4 — CSV exports mirror each table's visible columns/rows exactly.
  const today = isoDate(new Date());
  const exportUtilization = () => {
    const csv = toCsv(
      ['Member', 'Total', 'Billable', 'Utilization'],
      utilization.map((r) => [
        r.user.name,
        fmtMins(r.totalMin),
        fmtMins(r.billableMin),
        r.totalMin ? `${Math.round((r.billableMin / r.totalMin) * 100)}%` : '—',
      ]),
    );
    downloadCsv(`utilization-${today}`, csv);
  };
  const exportBurn = () => {
    const csv = toCsv(
      ['Project', 'Used (h)', 'Budget (h)'],
      burn.map((r) => [r.project.name, r.used.toFixed(1), r.budget]),
    );
    downloadCsv(`project-burn-${today}`, csv);
  };
  const exportClients = () => {
    const csv = toCsv(
      ['Client', 'Billable revenue'],
      clientTotals.map((r) => [r.client.name, fmtMoney(r.rev)]),
    );
    downloadCsv(`client-revenue-${today}`, csv);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="eyebrow">Reports</div>
          <h1 className="text-2xl font-bold text-gray-900">Utilization & burn</h1>
          <p className="text-sm text-gray-500">Time, billable, and revenue rollups.</p>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <Field label="Range">
            <Select className="w-36" value={range} onChange={(e) => onRangeChange(e.target.value as RangeKey)}>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="custom">Custom</option>
            </Select>
          </Field>
          {range === 'custom' && (
            <>
              <Field label="From">
                <Input type="date" className="w-40" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} />
              </Field>
              <Field label="To">
                <Input type="date" className="w-40" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} />
              </Field>
            </>
          )}
          <Field label="Project">
            <Select className="w-44" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
              <option value="all">All projects</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Person">
            <Select className="w-44" value={personFilter} onChange={(e) => setPersonFilter(e.target.value)}>
              <option value="all">All people</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Tile>
          <div className="eyebrow">Total hours</div>
          <div className="text-3xl font-bold text-gray-900 tabular-nums">{(totalMin / 60).toFixed(1)}h</div>
          <div className="text-xs text-gray-500">{recent.length} entries</div>
        </Tile>
        <Tile>
          <div className="eyebrow">Billable hours</div>
          <div className="text-3xl font-bold text-gray-900 tabular-nums">{(billMin / 60).toFixed(1)}h</div>
          <div className="text-xs text-gray-500">{totalMin ? `${Math.round((billMin / totalMin) * 100)}%` : '0%'} of range</div>
        </Tile>
        <Tile>
          <div className="eyebrow">Billable revenue</div>
          <div className="text-3xl font-bold text-gray-900 tabular-nums">{fmtMoney(billRev)}</div>
          <div className="text-xs text-gray-500">at user rates</div>
        </Tile>
      </div>

      <Section
        title="Team utilization"
        action={
          <Button variant="outline" size="sm" onClick={exportUtilization} disabled={utilization.length === 0}>
            <Download className="w-3.5 h-3.5" /> Download CSV
          </Button>
        }
      >
        <Card>
          <UtilizationBars rows={utilization} />
        </Card>
        <Card>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[560px]">
            <thead className="text-left text-[11px] uppercase text-gray-400 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Billable</th>
                <th className="px-4 py-3 text-right">Utilization</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {utilization.map((row) => (
                <tr key={row.user.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800">{row.user.name}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtMins(row.totalMin)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtMins(row.billableMin)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.totalMin ? `${Math.round((row.billableMin / row.totalMin) * 100)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
      </Section>

      <Section
        title="Project burn"
        action={
          <Button variant="outline" size="sm" onClick={exportBurn} disabled={burn.length === 0}>
            <Download className="w-3.5 h-3.5" /> Download CSV
          </Button>
        }
      >
        <Card>
          <BurnLineChart entries={recent} projects={projects} fromDay={period.fromDay} toDay={period.toDay} />
        </Card>
        <Card>
          <div className="p-4 space-y-3">
            {burn.map((r) => {
              const pct = r.budget ? Math.min(100, (r.used / r.budget) * 100) : 0;
              return (
                <div key={r.project.id}>
                  <div className="flex justify-between text-sm">
                    <span className="font-semibold text-gray-800">{r.project.name}</span>
                    <span className="text-gray-500 tabular-nums">{r.used.toFixed(1)}h / {r.budget}h</span>
                  </div>
                  <div className="mt-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        background: pct > 90 ? '#dc2626' : r.project.color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
            {burn.length === 0 && <div className="text-sm text-gray-500">No project time in this range.</div>}
          </div>
        </Card>
      </Section>

      <Section
        title="Client revenue"
        action={
          <Button variant="outline" size="sm" onClick={exportClients} disabled={clientTotals.length === 0}>
            <Download className="w-3.5 h-3.5" /> Download CSV
          </Button>
        }
      >
        <Card>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[560px]">
            <thead className="text-left text-[11px] uppercase text-gray-400 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3 text-right">Billable revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {clientTotals.map((row) => (
                <tr key={row.client.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800">{row.client.name}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmtMoney(row.rev)}</td>
                </tr>
              ))}
              {clientTotals.length === 0 && (
                <tr><td colSpan={2} className="px-4 py-6 text-center text-gray-500">No billable revenue in this range.</td></tr>
              )}
            </tbody>
          </table></div>
        </Card>
      </Section>
    </div>
  );
}
