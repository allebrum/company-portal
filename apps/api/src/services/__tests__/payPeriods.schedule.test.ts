import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePeriodSchedule } from '../payPeriods.js';

// generatePeriodSchedule is pure when fromDateIso is supplied. These tests pin
// the invariants whose past regressions are documented inline in payPeriods.ts:
// duplicate / inverted ("Jun 16 – Jun 10") ranges and overlapping chains.

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`)) / 86_400_000);

test('weekly: count honored, 7-day periods, chained with no overlap or gap', () => {
  const out = generatePeriodSchedule(
    { cadence: 'weekly', processingBufferDays: 0, weekendRule: 'as-is' } as never,
    4,
    '2026-01-15',
    '2026-01-07',
  );
  assert.equal(out.length, 4);
  assert.equal(out[0]!.start, '2026-01-08'); // day after the previous period end
  for (const p of out) {
    assert.equal(daysBetween(p.start, p.end), 6); // 7-day inclusive window
    assert.ok(p.start <= p.end); // never inverted
    assert.equal(p.approvalCutoff, p.end);
  }
  for (let i = 1; i < out.length; i++) {
    assert.equal(daysBetween(out[i - 1]!.end, out[i]!.start), 1); // contiguous, no overlap
  }
});

test('biweekly: 14-day periods chained off the previous end', () => {
  const out = generatePeriodSchedule(
    { cadence: 'biweekly', processingBufferDays: 3, weekendRule: 'as-is' } as never,
    3,
    '2026-01-15',
    '2026-01-10',
  );
  assert.equal(out.length, 3);
  assert.equal(out[0]!.start, '2026-01-11');
  for (const p of out) assert.equal(daysBetween(p.start, p.end), 13);
  for (let i = 1; i < out.length; i++) assert.equal(daysBetween(out[i - 1]!.end, out[i]!.start), 1);
});

test('weekly: payDate = period end + buffer', () => {
  const out = generatePeriodSchedule(
    { cadence: 'weekly', processingBufferDays: 5, weekendRule: 'as-is' } as never,
    1,
    '2026-01-15',
    '2026-01-07',
  );
  assert.equal(out[0]!.end, '2026-01-14');
  assert.equal(out[0]!.payDate, '2026-01-19'); // 14 Jan + 5
});

test('by-date: count honored, never inverted, strictly chained', () => {
  const out = generatePeriodSchedule(
    { cadence: 'by-date', processingBufferDays: 5, weekendRule: 'prior', payDates: [15, 'last'] } as never,
    6,
    '2026-01-15',
    '2026-01-05',
  );
  assert.equal(out.length, 6);
  for (const p of out) assert.ok(p.start <= p.end, `inverted range: ${p.label}`);
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i]!.start > out[i - 1]!.end, `overlap at ${out[i]!.label}`);
  }
});

test('weekend rule: a Saturday pay date shifts to the prior Friday', () => {
  // weekly, buffer 0 → payDate == end. End on a Saturday (2026-01-17) shifts to
  // Friday (2026-01-16) under the default 'prior' rule.
  const out = generatePeriodSchedule(
    { cadence: 'weekly', processingBufferDays: 0, weekendRule: 'prior' } as never,
    1,
    '2026-01-10',
    '2026-01-10', // start 2026-01-11 (Sun) → end 2026-01-17 (Sat)
  );
  assert.equal(out[0]!.end, '2026-01-17');
  assert.equal(out[0]!.payDate, '2026-01-16'); // Sat → prior Fri
});
