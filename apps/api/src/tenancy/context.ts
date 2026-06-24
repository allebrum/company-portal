import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Modern Zen multi-tenancy — request-scoped tenant context.
 *
 * The `tenantContext` middleware (middleware/tenantContext.ts) wraps each
 * authenticated request in `withTenant(tenantId, next)`, so any service
 * called downstream can read `currentTenantId()` without threading the id
 * through every function signature. AsyncLocalStorage propagates the store
 * across `await` boundaries, so async service code sees the right tenant.
 *
 * Phase 1: the helpers exist and the context is populated, but queries are
 * not yet scoped (still global, single default tenant). Phase 2 starts
 * calling `currentTenantId()` from `tenancy/scope.ts` to filter/stamp rows.
 */

type TenantStore = { tenantId: string };

const als = new AsyncLocalStorage<TenantStore>();

/** Run `fn` (and everything it awaits) with `tenantId` bound to the context. */
export function withTenant<T>(tenantId: string, fn: () => T): T {
  return als.run({ tenantId }, fn);
}

/** The active tenant id, or throws if called outside a tenant-scoped request. */
export function currentTenantId(): string {
  const store = als.getStore();
  if (!store) {
    throw new Error(
      'currentTenantId() called outside a tenant context — is tenantContext middleware mounted on this route?',
    );
  }
  return store.tenantId;
}

/** The active tenant id, or null when there is no tenant context (unauth routes, jobs). */
export function currentTenantIdOrNull(): string | null {
  return als.getStore()?.tenantId ?? null;
}
