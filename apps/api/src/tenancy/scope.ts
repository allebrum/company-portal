import { eq, type Column } from 'drizzle-orm';
import { currentTenantId } from './context.js';

/**
 * Modern Zen multi-tenancy — query-scoping helpers built on the request tenant
 * context (tenancy/context.ts).
 *
 * Phase 2 threads these through every service:
 *   - `tenantEq(table.tenantId)` → a `WHERE tenant_id = <current>` condition
 *     to AND into every list/get query.
 *   - `stampTenant(values)` → adds `tenantId: <current>` to every insert so
 *     new rows are owned by the active workspace.
 *
 * Created in Phase 1 (plumbing) but not yet called — queries stay global
 * until Phase 2 flips the columns to NOT NULL and wires these in.
 */

/** `eq(column, currentTenantId())` — AND this into a query's WHERE clause. */
export function tenantEq(column: Column) {
  return eq(column, currentTenantId());
}

/** Returns `values` with the active `tenantId` stamped on, for inserts. */
export function stampTenant<T extends Record<string, unknown>>(values: T): T & { tenantId: string } {
  return { ...values, tenantId: currentTenantId() };
}
