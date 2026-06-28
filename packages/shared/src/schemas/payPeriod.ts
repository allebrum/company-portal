import { z } from 'zod';
import { CADENCES, WEEKEND_RULES } from '../enums';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

/** True when `tz` is an IANA zone the JS runtime's Intl tz database knows. */
function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const PayDateRefSchema = z.union([
  z.number().int().min(1).max(31),
  z.literal('last'),
]);
export type PayDateRef = z.infer<typeof PayDateRefSchema>;

export const PayConfigSchema = z.object({
  cadence: z.enum(CADENCES),
  payDates: z.array(PayDateRefSchema).max(8).default([15, 'last']),
  weekendRule: z.enum(WEEKEND_RULES).default('prior'),
  anchor: isoDate.optional().nullable(),
  // The single buffer governing both the gap between period end and pay
  // date and (implicitly) the approval cutoff. `period_end = pay_date -
  // processingBufferDays`. Approval cutoff = period_end. Dropped the
  // separate payDelayDays field — it was always semantically the same
  // thing in this org's workflow.
  processingBufferDays: z.number().int().min(0).max(60).default(5),
  autoClose: z.boolean().default(true),
  approverId: z.string().uuid().nullable().optional(),
  // IANA timezone the workspace's payroll clock runs in. Anchors the
  // reminder emails (otherwise "the morning of the processing day" is
  // ambiguous — times in the DB are UTC). Validated against the runtime's
  // tz database so a typo can't silently break the reminder scheduler.
  timezone: z
    .string()
    .min(1)
    .max(64)
    .refine(isValidTimeZone, { message: 'Unknown IANA timezone' })
    .default('America/New_York'),
  // Reminder emails (see jobs/timeReminders). On the processing day —
  // pay date minus the processing buffer, shifted off weekends by the
  // weekend rule — employees with unsubmitted time get a morning nudge and
  // approvers get an end-of-day "time to approve" prompt.
  remindEmployees: z.boolean().default(true),
  remindApprovers: z.boolean().default(true),
});
export type PayConfigInput = z.infer<typeof PayConfigSchema>;

export const GeneratePeriodsSchema = z.object({
  count: z.number().int().min(1).max(24).default(6),
  fromDate: isoDate.optional(),
});
export type GeneratePeriodsInput = z.infer<typeof GeneratePeriodsSchema>;

/** Admin adjustment of a single period (PATCH /pay-periods/:id, `pay.manage`).
 *  Closed periods must be reopened first — the route 409s otherwise. */
export const UpdatePayPeriodSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    approvalCutoff: isoDate.optional(),
    payDate: isoDate.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })
  .refine((v) => !(v.startDate && v.endDate) || v.startDate <= v.endDate, {
    message: 'Start must be on or before end',
    path: ['endDate'],
  });
export type UpdatePayPeriodInput = z.infer<typeof UpdatePayPeriodSchema>;
