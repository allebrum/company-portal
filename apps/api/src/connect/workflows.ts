import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { connections, workflowRuns } from '../db/schema.js';
import { HttpError } from '../middleware/errorHandler.js';
import { createPost } from './zernio.js';
import { executeTool } from './composio.js';

// On-behalf workflows. Every run writes a workflow_runs audit row (success OR
// failure) — the result carries `ok` so the Activity view can show the outcome.
// Account/platform are derived server-side from the client's own connections,
// never trusted from the caller (the caller only picks which connected account).

async function logRun(
  clientId: string,
  tenantId: string | null,
  kind: string,
  payload: unknown,
  result: unknown,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(workflowRuns)
    .values({
      clientId,
      tenantId,
      kind,
      payload: payload as object,
      result: result as object,
    })
    .returning({ id: workflowRuns.id });
  return row!;
}

export interface SocialPostInput {
  content: string;
  accountIds: string[];
  publishNow?: boolean;
}

/** Publish a post to one or more of the client's connected Zernio accounts. */
export async function runSocialPost(
  clientId: string,
  tenantId: string | null,
  input: SocialPostInput,
): Promise<{ runId: string; ok: boolean; result: unknown }> {
  if (!input.content?.trim()) throw new HttpError(400, 'content_required');

  // Resolve platform/accountId from THIS client's connected Zernio accounts.
  // If specific accountIds are given, use those; otherwise target all the
  // client's connected social channels.
  const rows = await db
    .select({ externalId: connections.externalId, integration: connections.integration })
    .from(connections)
    .where(and(eq(connections.clientId, clientId), eq(connections.provider, 'zernio')));
  const wanted = input.accountIds?.length ? new Set(input.accountIds) : null;
  const platforms = rows
    .filter((r) => !wanted || wanted.has(r.externalId))
    .map((r) => ({ platform: r.integration, accountId: r.externalId }));
  if (platforms.length === 0) throw new HttpError(400, 'no_connected_accounts');

  let ok = true;
  let result: unknown;
  try {
    const post = await createPost({ content: input.content, platforms, publishNow: input.publishNow ?? true });
    result = { ok: true, postId: post._id };
  } catch (e) {
    ok = false;
    result = { ok: false, error: (e as Error).message };
  }
  const run = await logRun(clientId, tenantId, 'social_post', { content: input.content, platforms }, result);
  return { runId: run.id, ok, result };
}

/** Run a Composio tool on behalf of the client (demo: list Gmail labels). */
export async function runComposioTool(
  clientId: string,
  tenantId: string | null,
  composioUserId: string,
  input: { slug: string; toolkit?: string; args?: Record<string, unknown> },
): Promise<{ runId: string; ok: boolean; result: unknown }> {
  if (!input.slug) throw new HttpError(400, 'slug_required');
  let ok = true;
  let result: unknown;
  try {
    const data = await executeTool(input.slug, composioUserId, input.args ?? {});
    result = { ok: true, data };
  } catch (e) {
    ok = false;
    result = { ok: false, error: (e as Error).message };
  }
  const run = await logRun(clientId, tenantId, 'composio_tool', { slug: input.slug, toolkit: input.toolkit ?? null }, result);
  return { runId: run.id, ok, result };
}
