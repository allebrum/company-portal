import { and, eq, isNull } from 'drizzle-orm';
import {
  type TurnstileSaveInput,
  type TurnstileStatus,
  type TurnstileSyncInput,
  type TurnstileTestResult,
} from '@allebrum/shared';
import { db } from '../db/client.js';
import { forms, integrations, type Integration } from '../db/schema.js';
import { HttpError } from '../middleware/errorHandler.js';
import { decryptField, encryptField } from '../lib/crypto.js';
import { currentTenantId } from '../tenancy/context.js';
import { stampTenant } from '../tenancy/scope.js';
import { appendActivity } from './activity.js';
import { loadKeyset } from './credentials.js';
import {
  hostnameCap,
  interpretSiteverify,
  normalizeHostname,
  normalizeHostnames,
  type Siteverify,
  TURNSTILE_VERIFY_URL,
} from './turnstileRules.js';

/**
 * Workspace-level Cloudflare Turnstile integration.
 *
 * Hoppa is multi-tenant: each company brings its own widget. Keys are entered
 * once under Admin → Integrations, encrypted with the credentials-vault
 * keyset, and never returned to the client. Forms use these keys unless a
 * form has an optional per-form override.
 *
 * Cloudflare has no third-party OAuth for Turnstile. An API token scoped to
 * Account > Turnstile > Edit is the "login": when present, Hoppa can create
 * a widget and keep its hostname list in sync.
 */

export const TURNSTILE_KIND = 'turnstile' as const;
const SECRET_FIELD = 'integrations.turnstile_secret';
const API_TOKEN_FIELD = 'integrations.turnstile_api_token';
const ROW_ID = 'turnstile';
const CF_API = 'https://api.cloudflare.com/client/v4';

type StoredConfig = {
  siteKey?: string | null;
  secretEnc?: string | null;
  accountId?: string | null;
  apiTokenEnc?: string | null;
  hostnames?: string[];
  enterprise?: boolean;
  lastTestAt?: string | null;
  lastTestOk?: boolean | null;
  lastSyncAt?: string | null;
};

function requireKeyset() {
  const { keyset } = loadKeyset();
  if (!keyset) throw new HttpError(503, 'credentials_not_configured');
  return keyset;
}

function encrypt(tenantId: string, field: string, plaintext: string): string {
  return encryptField(plaintext, { tenantId, rowId: ROW_ID, field }, requireKeyset());
}

function decrypt(tenantId: string, field: string, blob: string | null | undefined): string | null {
  if (!blob) return null;
  const { keyset } = loadKeyset();
  if (!keyset) return null;
  try {
    return decryptField(blob, { tenantId, rowId: ROW_ID, field }, keyset);
  } catch {
    console.warn(`[turnstile] could not decrypt ${field}`);
    return null;
  }
}

function asConfig(raw: unknown): StoredConfig {
  if (!raw || typeof raw !== 'object') return {};
  return raw as StoredConfig;
}

async function getRow(tenantId: string): Promise<Integration | undefined> {
  const rows = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.tenantId, tenantId), eq(integrations.kind, TURNSTILE_KIND)))
    .limit(1);
  return rows[0];
}

async function upsert(tenantId: string, patch: { connected?: boolean; account?: string | null; lastSyncAt?: string | null; config: StoredConfig }): Promise<Integration> {
  const existing = await getRow(tenantId);
  if (existing) {
    const [updated] = await db
      .update(integrations)
      .set({
        connected: patch.connected ?? existing.connected,
        account: patch.account === undefined ? existing.account : patch.account,
        lastSyncAt: patch.lastSyncAt === undefined ? existing.lastSyncAt : patch.lastSyncAt,
        config: patch.config,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(integrations.tenantId, tenantId), eq(integrations.kind, TURNSTILE_KIND)))
      .returning();
    if (!updated) throw new Error('turnstile update failed');
    return updated;
  }
  const [created] = await db
    .insert(integrations)
    .values(
      stampTenant({
        kind: TURNSTILE_KIND,
        connected: patch.connected ?? false,
        account: patch.account ?? null,
        connectedAt: patch.connected ? new Date().toISOString().slice(0, 10) : null,
        lastSyncAt: patch.lastSyncAt ?? null,
        config: patch.config,
      }),
    )
    .returning();
  if (!created) throw new Error('turnstile insert failed');
  return created;
}

export function toStatus(row: Integration | undefined, tenantId: string): TurnstileStatus {
  const cfg = asConfig(row?.config);
  const siteKey = cfg.siteKey?.trim() || null;
  const hasSecret = !!cfg.secretEnc;
  return {
    connected: !!(row?.connected && siteKey && hasSecret),
    siteKey,
    hasSecret,
    accountId: cfg.accountId?.trim() || null,
    hasApiToken: !!cfg.apiTokenEnc,
    hostnames: Array.isArray(cfg.hostnames) ? cfg.hostnames : [],
    enterprise: !!cfg.enterprise,
    secretStorageReady: !!loadKeyset().keyset,
    lastTestAt: cfg.lastTestAt ?? null,
    lastTestOk: cfg.lastTestOk ?? null,
    lastSyncAt: cfg.lastSyncAt ?? row?.lastSyncAt ?? null,
  };
}

export async function getTurnstileStatus(tenantId = currentTenantId()): Promise<TurnstileStatus> {
  return toStatus(await getRow(tenantId), tenantId);
}

/** Keys the embed / verifier should use. Null when the workspace isn't connected. */
export async function getWorkspaceTurnstileKeys(tenantId: string): Promise<{ siteKey: string; secret: string } | null> {
  const row = await getRow(tenantId);
  if (!row?.connected) return null;
  const cfg = asConfig(row.config);
  const siteKey = cfg.siteKey?.trim() || '';
  const secret = decrypt(tenantId, SECRET_FIELD, cfg.secretEnc);
  if (!siteKey || !secret) return null;
  return { siteKey, secret };
}

function assertHostnameCap(hosts: string[], enterprise: boolean): void {
  const cap = hostnameCap(enterprise);
  if (hosts.length > cap) {
    throw new HttpError(400, 'turnstile_hostname_limit', {
      count: hosts.length,
      cap,
      plan: enterprise ? 'enterprise' : 'free',
      message: `A Turnstile widget on the ${enterprise ? 'Enterprise' : 'Free'} plan can list ${cap} hostnames, and this list has ${hosts.length}. Remove some, or tick “Enterprise plan” if the Cloudflare account is on that plan.`,
    });
  }
}

export async function saveTurnstile(input: TurnstileSaveInput, whoId: string): Promise<TurnstileStatus> {
  const tenantId = currentTenantId();
  const existing = await getRow(tenantId);
  const prev = asConfig(existing?.config);
  const next: StoredConfig = { ...prev };

  if (input.enterprise !== undefined) next.enterprise = input.enterprise;
  if (input.hostnames !== undefined) {
    const hosts = normalizeHostnames(input.hostnames);
    const bad = input.hostnames.map((h) => h.trim()).filter((h) => h && !normalizeHostname(h));
    if (bad.length > 0) {
      throw new HttpError(400, 'turnstile_hostname_invalid', {
        invalid: bad,
        message: `These aren’t valid hostnames (use example.com, no https:// or path): ${bad.join(', ')}`,
      });
    }
    assertHostnameCap(hosts, !!next.enterprise);
    next.hostnames = hosts;
  }
  if (input.accountId !== undefined) next.accountId = input.accountId?.trim() || null;

  if (input.apiToken !== undefined) {
    const tok = input.apiToken?.trim() || '';
    if (!tok) next.apiTokenEnc = null;
    else next.apiTokenEnc = encrypt(tenantId, API_TOKEN_FIELD, tok);
  }

  if (input.siteKey !== undefined) next.siteKey = input.siteKey?.trim() || null;

  if (input.secret !== undefined) {
    const secret = input.secret?.trim() || '';
    if (!secret) next.secretEnc = null;
    else next.secretEnc = encrypt(tenantId, SECRET_FIELD, secret);
  }

  // Clearing the site key also clears the secret (back to disconnected).
  if (!next.siteKey && next.secretEnc && input.siteKey !== undefined) {
    next.secretEnc = null;
  }

  const token = input.apiToken?.trim() || decrypt(tenantId, API_TOKEN_FIELD, next.apiTokenEnc);
  const accountId = next.accountId?.trim() || '';

  if (input.createWidget) {
    if (!token || !accountId) {
      throw new HttpError(400, 'turnstile_api_token_required', {
        message: 'To create a widget, add the Cloudflare account ID and an API token with Account → Turnstile → Edit.',
      });
    }
    const hosts = next.hostnames ?? [];
    if (hosts.length === 0) {
      throw new HttpError(400, 'turnstile_hostname_required', {
        message: 'Add at least one allowed domain before creating the widget. Cloudflare requires a hostname on every widget.',
      });
    }
    assertHostnameCap(hosts, !!next.enterprise);
    const created = await cfCreateWidget({ accountId, token, name: 'Hoppa forms', hostnames: hosts });
    next.siteKey = created.sitekey;
    next.secretEnc = encrypt(tenantId, SECRET_FIELD, created.secret);
    next.lastSyncAt = new Date().toISOString();
  } else if (input.syncHostnames) {
    if (!token || !accountId || !next.siteKey) {
      throw new HttpError(400, 'turnstile_sync_not_ready', {
        message: 'Syncing hostnames needs a site key plus a Cloudflare account ID and API token.',
      });
    }
    const hosts = next.hostnames ?? [];
    assertHostnameCap(hosts, !!next.enterprise);
    await cfUpdateWidget({ accountId, token, siteKey: next.siteKey, hostnames: hosts });
    next.lastSyncAt = new Date().toISOString();
  }

  if (next.siteKey && !next.secretEnc) {
    throw new HttpError(400, 'turnstile_secret_required', {
      message: 'Add the widget’s secret key (or create the widget with an API token).',
    });
  }
  if (!next.siteKey && next.secretEnc) {
    throw new HttpError(400, 'turnstile_site_key_required', {
      message: 'Add the widget’s site key that goes with this secret.',
    });
  }

  const connected = !!(next.siteKey && next.secretEnc);
  const row = await upsert(tenantId, {
    connected,
    account: next.siteKey ?? null,
    lastSyncAt: next.lastSyncAt ?? existing?.lastSyncAt ?? null,
    config: next,
  });
  await appendActivity({
    whoId,
    kind: connected ? (existing?.connected ? 'integration.update' : 'integration.connect') : 'integration.update',
    target: connected ? 'Cloudflare Turnstile connected' : 'Cloudflare Turnstile updated',
  });
  return toStatus(row, tenantId);
}

export async function disconnectTurnstile(whoId: string): Promise<TurnstileStatus> {
  const tenantId = currentTenantId();
  const row = await upsert(tenantId, {
    connected: false,
    account: null,
    lastSyncAt: null,
    config: {},
  });
  await appendActivity({ whoId, kind: 'integration.disconnect', target: 'Cloudflare Turnstile disconnected' });
  return toStatus(row, tenantId);
}


export async function siteverify(secret: string, token = 'hoppa-turnstile-test'): Promise<Siteverify> {
  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  const res = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new HttpError(502, 'turnstile_verify_unreachable', { message: "Could not reach Cloudflare's siteverify endpoint. Try again in a moment." });
  return (await res.json()) as Siteverify;
}

export async function testTurnstile(input: { secret?: string }): Promise<TurnstileTestResult> {
  const tenantId = currentTenantId();
  let secret = input.secret?.trim() || '';
  if (!secret) {
    const row = await getRow(tenantId);
    secret = decrypt(tenantId, SECRET_FIELD, asConfig(row?.config).secretEnc) ?? '';
  }
  if (!secret) {
    return { ok: false, code: 'not_configured', message: 'Add a secret key first, then test it.' };
  }
  let result: TurnstileTestResult;
  try {
    result = interpretSiteverify(await siteverify(secret));
  } catch (e) {
    if (e instanceof HttpError) {
      const details = e.details as { message?: string } | undefined;
      return { ok: false, code: e.message, message: details?.message ?? 'Could not reach Cloudflare. Try again.' };
    }
    throw e;
  }

  // Persist last-test only when we used the stored secret (not an unsaved draft).
  if (!input.secret) {
    const row = await getRow(tenantId);
    if (row) {
      const cfg = { ...asConfig(row.config), lastTestAt: new Date().toISOString(), lastTestOk: result.ok };
      await db
        .update(integrations)
        .set({ config: cfg, updatedAt: new Date().toISOString() })
        .where(and(eq(integrations.tenantId, tenantId), eq(integrations.kind, TURNSTILE_KIND)));
    }
  }
  return result;
}

export async function syncTurnstileHostnames(input: TurnstileSyncInput, whoId: string): Promise<TurnstileStatus> {
  const tenantId = currentTenantId();
  const row = await getRow(tenantId);
  if (!row) throw new HttpError(400, 'turnstile_not_connected', { message: 'Connect Turnstile first.' });
  const cfg = asConfig(row.config);
  let hosts = normalizeHostnames(input.hostnames ?? cfg.hostnames ?? []);
  if (input.includeFormOrigins) {
    hosts = normalizeHostnames([...hosts, ...(await formOriginHostnames(tenantId))]);
  }
  assertHostnameCap(hosts, !!cfg.enterprise);
  return saveTurnstile({ hostnames: hosts, syncHostnames: true }, whoId);
}

export async function formOriginHostnames(tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ definition: forms.definition })
    .from(forms)
    .where(and(eq(forms.tenantId, tenantId), isNull(forms.archivedAt)));
  const raw: string[] = [];
  for (const r of rows) {
    const def = r.definition as { security?: { allowedOrigins?: unknown } } | null;
    const origins = def?.security?.allowedOrigins;
    if (Array.isArray(origins)) for (const o of origins) if (typeof o === 'string') raw.push(o);
  }
  return normalizeHostnames(raw);
}

// ---- Cloudflare API ----

type CfWidget = { sitekey: string; secret: string; domains?: string[]; name?: string };

type CfEnvelope<T> = {
  success?: boolean;
  result?: T;
  errors?: { code?: number; message?: string }[];
};

async function cfFetch<T>(args: { token: string; method: string; path: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${CF_API}${args.path}`, {
      method: args.method,
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
      },
      body: args.body === undefined ? undefined : JSON.stringify(args.body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new HttpError(502, 'turnstile_cloudflare_unreachable', {
      message: 'Could not reach the Cloudflare API. Try again in a moment.',
    });
  }
  let json: CfEnvelope<T> = {};
  try {
    json = (await res.json()) as CfEnvelope<T>;
  } catch {
    throw new HttpError(502, 'turnstile_cloudflare_unreachable', {
      message: 'Cloudflare returned an unexpected response. Try again.',
    });
  }
  if (!res.ok || !json.success) {
    const msg = json.errors?.map((e) => e.message).filter(Boolean).join('; ') || `Cloudflare API error (HTTP ${res.status}).`;
    const code = json.errors?.[0]?.code;
    if (res.status === 401 || res.status === 403 || code === 10000 || code === 9109) {
      throw new HttpError(400, 'turnstile_api_token_invalid', {
        message: 'Cloudflare rejected the API token. Use a token with Account → Turnstile → Edit, and check the account ID.',
        detail: msg,
      });
    }
    throw new HttpError(400, 'turnstile_cloudflare_error', { message: msg });
  }
  if (json.result === undefined) throw new HttpError(502, 'turnstile_cloudflare_error', { message: 'Cloudflare returned no widget data.' });
  return json.result;
}

async function cfCreateWidget(args: { accountId: string; token: string; name: string; hostnames: string[] }): Promise<CfWidget> {
  const result = await cfFetch<CfWidget>({
    token: args.token,
    method: 'POST',
    path: `/accounts/${encodeURIComponent(args.accountId)}/challenges/widgets`,
    body: { name: args.name, domains: args.hostnames, mode: 'managed' },
  });
  if (!result.sitekey || !result.secret) {
    throw new HttpError(502, 'turnstile_cloudflare_error', { message: 'Cloudflare created the widget but didn’t return a site key and secret.' });
  }
  return result;
}

async function cfUpdateWidget(args: { accountId: string; token: string; siteKey: string; hostnames: string[] }): Promise<void> {
  await cfFetch({
    token: args.token,
    method: 'PUT',
    path: `/accounts/${encodeURIComponent(args.accountId)}/challenges/widgets/${encodeURIComponent(args.siteKey)}`,
    body: { domains: args.hostnames },
  });
}

/** Redact secrets from a raw integrations row before it leaves the API. */
export function redactIntegrationConfig(row: Integration): Integration {
  if (row.kind !== TURNSTILE_KIND) return row;
  const cfg = asConfig(row.config);
  return {
    ...row,
    config: {
      hasSecret: !!cfg.secretEnc,
      hasApiToken: !!cfg.apiTokenEnc,
      hostnames: cfg.hostnames ?? [],
      enterprise: !!cfg.enterprise,
      accountId: cfg.accountId ?? null,
      siteKey: cfg.siteKey ?? null,
    },
  };
}
