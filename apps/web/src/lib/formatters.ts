// Mirrors helpers from project/app/data.jsx so visuals match the prototype.

/**
 * Monday-anchored start-of-week — the workspace standard. Used by the
 * Dashboard's "Where the hours went" rollup and the Clients directory's
 * "This week" stat so both surfaces report on the same window.
 */
export function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday
  const out = new Date(d);
  out.setDate(d.getDate() + diff);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function fmtMins(m: number): string {
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  if (h === 0) return `${mm}m`;
  if (mm === 0) return `${h}h`;
  return `${h}h ${mm}m`;
}

export function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

export function fmtTimer(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Parse a YYYY-MM-DD as LOCAL midnight to avoid the UTC TZ shift. */
export function parseLocalDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  if (iso.length > 10 && iso.includes('T')) return new Date(iso);
  return new Date(iso + 'T00:00:00');
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "9:00 AM" local time from an ISO string. */
export function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "9:00 AM – 11:30 AM" (or just start if no end). */
export function fmtTimeRange(startIso: string, endIso: string | null | undefined): string {
  if (!endIso) return fmtClock(startIso);
  return `${fmtClock(startIso)} – ${fmtClock(endIso)}`;
}

export function relativeFromIso(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const STATUS_LABEL: Record<string, string> = {
  backlog: 'Backlog',
  'in-progress': 'In progress',
  review: 'In review',
  done: 'Shipped',
};
export const STATUS_ORDER = ['backlog', 'in-progress', 'review', 'done'] as const;

export const ENTRY_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
};
export const ENTRY_STATUS_PILL: Record<string, 'gray' | 'yellow' | 'green' | 'red'> = {
  draft: 'gray',
  submitted: 'yellow',
  approved: 'green',
  rejected: 'red',
};

export const PAY_PERIOD_STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  review: 'Under review',
  closed: 'Closed',
};
export const PAY_PERIOD_STATUS_PILL: Record<string, 'purple' | 'yellow' | 'gray'> = {
  open: 'purple',
  review: 'yellow',
  closed: 'gray',
};

export const PRIORITY_DOT: Record<string, { color: string; label: string }> = {
  high: { color: '#dc2626', label: 'High' },
  medium: { color: '#f97316', label: 'Medium' },
  low: { color: '#9ca3af', label: 'Low' },
};
