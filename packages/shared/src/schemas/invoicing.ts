import { z } from 'zod';

// ---- Client invoicing (hours → invoices) ----
//
// The invoicing surface lists a client's / project's tracked hours, lets a
// biller check entries off as invoiced (with an optional free-text reference
// like "INV-1042" or the QuickBooks doc number), and can push an invoice
// straight into QuickBooks Online when that integration is connected.

/** Query for the invoicing entry list. Exactly one of clientId / projectId
 *  is required — the route enforces it (a workspace-wide dump has no UI). */
export const InvoicingEntriesQuerySchema = z.object({
  clientId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
});
export type InvoicingEntriesQuery = z.infer<typeof InvoicingEntriesQuerySchema>;

export const MarkInvoicedSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  // Optional reference stamped on every entry, e.g. an invoice number.
  invoiceRef: z.string().trim().max(200).optional(),
});
export type MarkInvoicedInput = z.infer<typeof MarkInvoicedSchema>;

export const UnmarkInvoicedSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
});
export type UnmarkInvoicedInput = z.infer<typeof UnmarkInvoicedSchema>;

// One invoice line as composed in the UI (usually one line per project,
// pre-filled from the selected entries; hours/rate/description editable).
export const QboInvoiceLineSchema = z.object({
  description: z.string().trim().min(1).max(4000),
  hours: z.number().positive().max(100000),
  // Unit price in whole currency units (QuickBooks takes decimals directly).
  rate: z.number().min(0).max(1000000),
});

export const CreateQboInvoiceSchema = z.object({
  clientId: z.string().uuid(),
  // Existing QuickBooks customer to bill. When omitted, `customerName` must
  // be set and a customer is created (then remembered on the client row).
  customerId: z.string().trim().min(1).max(100).optional(),
  customerName: z.string().trim().min(1).max(200).optional(),
  // QuickBooks Item (Type=Service) each line bills against. Optional — the
  // server falls back to the integration's stored default.
  serviceItemId: z.string().trim().min(1).max(100).optional(),
  lines: z.array(QboInvoiceLineSchema).min(1).max(100),
  // Entries the invoice covers; marked invoiced (with the QBO doc number as
  // the reference) once QuickBooks accepts the invoice.
  entryIds: z.array(z.string().uuid()).min(1).max(1000),
  memo: z.string().trim().max(1000).optional(),
}).refine((v) => v.customerId || v.customerName, {
  message: 'customerId or customerName required',
  path: ['customerId'],
});
export type CreateQboInvoiceInput = z.infer<typeof CreateQboInvoiceSchema>;
