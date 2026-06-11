/**
 * Tiny client-side CSV export — no deps. Quotes per RFC 4180 (doubled quotes,
 * fields with commas/quotes/newlines wrapped), UTF-8 BOM so Excel opens it
 * with the right encoding.
 */
export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (v: string | number | null | undefined): string => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

/** Trigger a browser download of `csv` as `filename` (adds .csv if missing). */
export function downloadCsv(filename: string, csv: string): void {
  const name = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
