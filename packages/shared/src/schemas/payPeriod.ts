import { z } from 'zod';
import { CADENCES, WEEKEND_RULES } from '../enums';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

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
});
export type PayConfigInput = z.infer<typeof PayConfigSchema>;

export const GeneratePeriodsSchema = z.object({
  count: z.number().int().min(1).max(24).default(6),
  fromDate: isoDate.optional(),
});
export type GeneratePeriodsInput = z.infer<typeof GeneratePeriodsSchema>;
