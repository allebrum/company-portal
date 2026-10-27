import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped "how is this request authenticated" context, so deep service
 * code (e.g. the activity log) can record that an action was performed by a
 * personal access token without threading it through every signature. Set by
 * bearerAuth for token requests only; browser sessions leave it empty.
 *
 * Kept separate from tenancy/context.ts because routes re-enter `withTenant`
 * (which would replace a combined store).
 */
export interface TokenActor {
  tokenId: string;
  tokenName: string;
}

const als = new AsyncLocalStorage<TokenActor>();

export function withTokenActor<T>(actor: TokenActor, fn: () => T): T {
  return als.run(actor, fn);
}

/** The token performing the current request, or null for session/no-request contexts. */
export function currentTokenActor(): TokenActor | null {
  return als.getStore() ?? null;
}

/** Fields merged into activity-log `meta` for token-made actions. */
export function tokenActivityMeta(): Record<string, unknown> | null {
  const a = currentTokenActor();
  return a ? { via: 'api_token', tokenId: a.tokenId, tokenName: a.tokenName } : null;
}
