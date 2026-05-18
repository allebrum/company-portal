'use client';

import { useMemo, useState } from 'react';
import { Card, Section, Tile } from '@/components/ui';
import { Field, Select } from '@/components/ui/Field';
import { useEntries, useUsers, useProjects, useClients } from '@/hooks/useResources';
import { fmtMins, fmtMoney } from '@/lib/formatters';

const RANGES = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export default function ReportsPage() {
  const { data: entries = [] } = useEntries();
  const { data: users = [] } = useUsers();
  const { data: projects = [] } = useProjects();
  const { data: clients = [] } = useClients();

  const [range, setRange] = useState<keyof typeof RANGES>('30d');

  const cutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - RANGES[range]);
    return d.toISOString();
  }, [range]);

  const recent = entries.filter((e) => e.startIso >= cutoff);

  const totalMin = recent.reduce((s, e) => s + e.durationMin, 0);
  const billableEntries = recent.filter((e) => projects.find((p) => p.id === e.projectId)?.billable);
  const billMin = billableEntries.reduce((s, e) => s + e.durationMin, 0);
  const billRev = billableEntries.reduce((s, e) => {
    const u = users.find((x) => x.id === e.userId);
    const rate = u ? Number(u.billable) : 0;
    return s + (e.durationMin / 60) * rate;
  }, 0);

  // Utilization per user
  const utilization = users.map((u) => {
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
    const cEntries = recent.filter((e) => projIds.includes(e.projectId));
    const rev = cEntries.reduce((s, e) => {
      const proj = projects.find((p) => p.id === e.projectId);
      if (!proj?.billable) return s;
      const u = users.find((x) => x.id === e.userId);
      const rate = u ? Number(u.billable) : 0;
      return s + (e.durationMin / 60) * rate;
    }, 0);
    return { client: c, rev };
  }).filter((r) => r.rev > 0).sort((a, b) => b.rev - a.rev);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="eyebrow">Reports</div>
          <h1 className="text-2xl font-bold text-gray-900">Utilization & burn</h1>
          <p className="text-sm text-gray-500">Time, billable, and revenue rollups.</p>
        </div>
        <Field label="Range">
          <Select value={range} onChange={(e) => setRange(e.target.value as keyof typeof RANGES)}>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </Select>
        </Field>
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

      <Section title="Team utilization">
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

      <Section title="Project burn">
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

      <Section title="Client revenue">
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
