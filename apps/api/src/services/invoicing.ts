import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { timeEntries, projects, clients, integrations, type TimeEntry } from '../db/schema.js';
import type { CreateQboInvoiceInput } from '@allebrum/shared';
import { EV } from '@allebrum/shared';
import { emit } from '../realtime/emit.js';
import { appendActivity } from './activity.js';
import { HttpError } from '../middleware/errorHandler.js';
import { tenantEq } from '../tenancy/scope.js';
import {
  createQboCustomer,
  createQboInvoice,
  listQboServiceItems,
  type QboInvoiceResult,
} from './quickbooks.js';

// Client invoicing — which tracked hours have (not) been billed to a client.
// The `invoiced_*` columns are orthogonal to the payroll status workflow:
// approving pays the employee, invoicing bills the client.

/**
 * Entries for the invoicing tab. Project scope lists that project's entries;
 * client scope lists entries across ALL the client's projects (entries with
 * no project never belong to a client, so they can't appear here).
 */
export async function listInvoicingEntries(opts: {
  clientId?: string;
  projectId?: string;
}): Promise<TimeEntry[]> {
  if (opts.projectId) {
    return db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.projectId, opts.projectId), tenantEq(timeEntries.tenantId)))
      .orderBy(desc(timeEntries.startIso))
      .limit(5000);
  }
  if (opts.clientId) {
    const rows = await db
      .select({ entry: timeEntries })
      .from(timeEntries)
      .innerJoin(projects, eq(timeEntries.projectId, projects.id))
      .where(and(eq(projects.clientId, opts.clientId), tenantEq(timeEntries.tenantId)))
      .orderBy(desc(timeEntries.startIso))
      .limit(5000);
    return rows.map((r) => r.entry);
  }
  throw new HttpError(400, 'client_or_project_required');
}

export async function markEntriesInvoiced(
  ids: string[],
  whoId: string,
  invoiceRef?: string,
): Promise<number> {
  const now = new Date().toISOString();
  const result = await db
    .update(timeEntries)
    .set({
      invoicedAt: now,
      invoicedBy: whoId,
      invoiceRef: invoiceRef?.trim() ? invoiceRef.trim() : null,
      updatedAt: now,
    })
    // Only flips entries that aren't already invoiced — re-marking (to change
    // the reference) requires an explicit unmark first, so two billers can't
    // silently overwrite each other's invoice references.
    .where(and(inArray(timeEntries.id, ids), isNull(timeEntries.invoicedAt), tenantEq(timeEntries.tenantId)))
    .returning({ id: timeEntries.id, durationMin: timeEntries.durationMin });
  if (result.length > 0) {
    emit.toOrg(EV.ENTRY_INVOICED, { id: whoId, by: whoId, at: now, count: result.length });
    const totalMin = result.reduce((acc, r) => acc + r.durationMin, 0);
    await appendActivity({
      whoId,
      kind: 'invoice.mark',
      target: `Marked ${result.length} ${result.length === 1 ? 'entry' : 'entries'} (${(totalMin / 60).toFixed(1)}h) invoiced${invoiceRef ? ` · ${invoiceRef}` : ''}`,
    });
  }
  return result.length;
}

export async function unmarkEntriesInvoiced(ids: string[], whoId: string): Promise<number> {
  const now = new Date().toISOString();
  const result = await db
    .update(timeEntries)
    .set({ invoicedAt: null, invoicedBy: null, invoiceRef: null, updatedAt: now })
    .where(and(inArray(timeEntries.id, ids), tenantEq(timeEntries.tenantId)))
    .returning({ id: timeEntries.id });
  if (result.length > 0) {
    emit.toOrg(EV.ENTRY_UNINVOICED, { id: whoId, by: whoId, at: now, count: result.length });
    await appendActivity({
      whoId,
      kind: 'invoice.unmark',
      target: `Marked ${result.length} ${result.length === 1 ? 'entry' : 'entries'} not invoiced`,
    });
  }
  return result.length;
}

/**
 * Create a QuickBooks invoice from selected entries, then mark them invoiced
 * with the QuickBooks doc number as the reference. Validates every entry
 * belongs to the client and is still unbilled BEFORE touching QuickBooks, so
 * a double-click can't produce two invoices over the same hours.
 */
export async function createInvoiceFromEntries(
  input: CreateQboInvoiceInput,
  whoId: string,
): Promise<QboInvoiceResult & { marked: number; customerId: string }> {
  const clientRows = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, input.clientId), tenantEq(clients.tenantId)))
    .limit(1);
  const client = clientRows[0];
  if (!client) throw new HttpError(404, 'client_not_found');

  // Every selected entry must exist in this tenant, sit under one of THIS
  // client's projects, and still be unbilled.
  const rows = await db
    .select({ id: timeEntries.id, invoicedAt: timeEntries.invoicedAt, clientId: projects.clientId })
    .from(timeEntries)
    .innerJoin(projects, eq(timeEntries.projectId, projects.id))
    .where(and(inArray(timeEntries.id, input.entryIds), tenantEq(timeEntries.tenantId)));
  if (rows.length !== input.entryIds.length) throw new HttpError(409, 'entries_not_found');
  if (rows.some((r) => r.clientId !== input.clientId)) throw new HttpError(409, 'entries_not_for_client');
  if (rows.some((r) => r.invoicedAt)) throw new HttpError(409, 'entries_already_invoiced');

  // Resolve the QuickBooks customer: explicit pick → remembered mapping →
  // create one named after the client.
  let customerId = input.customerId ?? client.quickbooksCustomerId ?? null;
  if (!customerId) {
    const created = await createQboCustomer(input.customerName ?? client.name);
    customerId = created.id;
  }
  if (customerId !== client.quickbooksCustomerId) {
    await db
      .update(clients)
      .set({ quickbooksCustomerId: customerId, updatedAt: new Date().toISOString() })
      .where(and(eq(clients.id, client.id), tenantEq(clients.tenantId)));
  }

  // Resolve the service item: explicit pick → workspace default → the only
  // service item in the company file (auto-adopt) → 400.
  const integrationRows = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.kind, 'quickbooks'), tenantEq(integrations.tenantId)))
    .limit(1);
  const config = (integrationRows[0]?.config ?? {}) as Record<string, unknown>;
  let serviceItemId = input.serviceItemId ?? (typeof config.defaultServiceItemId === 'string' ? config.defaultServiceItemId : null);
  if (!serviceItemId) {
    const items = await listQboServiceItems();
    if (items.length === 1) serviceItemId = items[0]!.id;
  }
  if (!serviceItemId) throw new HttpError(400, 'service_item_required');
  if (integrationRows[0] && config.defaultServiceItemId !== serviceItemId) {
    await db
      .update(integrations)
      .set({
        config: sql`${integrations.config} || ${JSON.stringify({ defaultServiceItemId: serviceItemId })}::jsonb`,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(integrations.kind, 'quickbooks'), tenantEq(integrations.tenantId)));
  }

  const invoice = await createQboInvoice({
    customerId,
    serviceItemId,
    lines: input.lines,
    memo: input.memo,
  });

  const ref = invoice.docNumber ? `QBO #${invoice.docNumber}` : `QBO ${invoice.id}`;
  const marked = await markEntriesInvoiced(input.entryIds, whoId, ref);
  await appendActivity({
    whoId,
    kind: 'invoice.quickbooks',
    target: `QuickBooks invoice ${invoice.docNumber ? `#${invoice.docNumber}` : invoice.id} created for ${client.name} ($${invoice.total.toFixed(2)})`,
    meta: { clientId: client.id, invoiceId: invoice.id, docNumber: invoice.docNumber, total: invoice.total, entryCount: marked },
  });
  return { ...invoice, marked, customerId };
}
