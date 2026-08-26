import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { oauthTokens, integrations } from '../db/schema.js';
import { env, quickbooksRedirectUrl, quickbooksOAuthConfigured } from '../env.js';
import { HttpError } from '../middleware/errorHandler.js';
import { tenantEq } from '../tenancy/scope.js';
import { currentTenantId } from '../tenancy/context.js';

// QuickBooks Online (client invoicing). Workspace-wide connection like Drive:
// one admin runs the consent flow, the credential is stamped with the tenant,
// and every biller in the workspace uses it. Tokens live in `oauth_tokens`
// (provider 'quickbooks'); the company realm id + name live on the
// `integrations` row's config so status/gating stays on the generic surface.

export const QBO_PROVIDER = 'quickbooks';

const AUTH_BASE = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const SCOPE = 'com.intuit.quickbooks.accounting';
// Pinned minorversion so response shapes don't drift under us.
const MINOR_VERSION = '75';

function apiBase(): string {
  return env.QUICKBOOKS_ENVIRONMENT === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';
}

export function quickbooksConfigured(): boolean {
  return quickbooksOAuthConfigured;
}

function basicAuth(): string {
  return 'Basic ' + Buffer.from(`${env.QUICKBOOKS_CLIENT_ID}:${env.QUICKBOOKS_CLIENT_SECRET}`).toString('base64');
}

export function buildQboConsentUrl(state: string): string {
  if (!quickbooksOAuthConfigured) throw new Error('quickbooks_oauth_not_configured');
  const u = new URL(AUTH_BASE);
  u.searchParams.set('client_id', env.QUICKBOOKS_CLIENT_ID!);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('redirect_uri', quickbooksRedirectUrl!);
  u.searchParams.set('state', state);
  return u.toString();
}

type QboTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds (access token)
};

async function tokenRequest(body: Record<string, string>): Promise<QboTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`quickbooks_token_request_failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as QboTokens;
}

export async function exchangeQboCode(code: string): Promise<QboTokens> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: quickbooksRedirectUrl!,
  });
}

// Scoped like Drive's credential: the workspace resolves only its own token.
function qboTokenScope() {
  return and(eq(oauthTokens.provider, QBO_PROVIDER), tenantEq(oauthTokens.tenantId));
}

async function getStoredToken() {
  const rows = await db
    .select()
    .from(oauthTokens)
    .where(qboTokenScope())
    .orderBy(desc(oauthTokens.updatedAt))
    .limit(1);
  return rows[0];
}

export async function saveQboToken(userId: string, tokens: QboTokens): Promise<void> {
  const tenantId = currentTenantId();
  const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  await db
    .insert(oauthTokens)
    .values({
      userId,
      tenantId,
      provider: QBO_PROVIDER,
      scopes: [SCOPE],
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiry,
    })
    .onConflictDoUpdate({
      target: [oauthTokens.userId, oauthTokens.provider],
      set: {
        tenantId,
        scopes: [SCOPE],
        accessToken: tokens.access_token,
        // Intuit ROTATES the refresh token on every refresh — always persist.
        refreshToken: tokens.refresh_token,
        expiry,
        updatedAt: new Date().toISOString(),
      },
    });
}

export async function disconnectQuickBooks(): Promise<void> {
  const token = await getStoredToken();
  if (token?.refreshToken && quickbooksOAuthConfigured) {
    // Best-effort revoke; the row is deleted regardless.
    try {
      await fetch(REVOKE_URL, {
        method: 'POST',
        headers: { Authorization: basicAuth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.refreshToken }),
      });
    } catch {
      // ignore — revocation failing must not block the disconnect
    }
  }
  await db.delete(oauthTokens).where(qboTokenScope());
}

export async function isQboConnected(): Promise<boolean> {
  const t = await getStoredToken();
  return !!t?.refreshToken;
}

// Read the integrations row directly (not via services/integrations.ts) to
// keep the import graph acyclic — that module calls back into this one on
// disconnect.
async function getQboIntegrationRow() {
  const rows = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.kind, 'quickbooks'), tenantEq(integrations.tenantId)))
    .limit(1);
  return rows[0];
}

export async function getQboStatus() {
  const [token, integration] = await Promise.all([getStoredToken(), getQboIntegrationRow()]);
  const config = (integration?.config ?? {}) as { realmId?: string };
  return {
    configured: quickbooksOAuthConfigured,
    connected: !!token?.refreshToken && !!config.realmId,
    companyName: integration?.connected ? integration.account : null,
    environment: env.QUICKBOOKS_ENVIRONMENT,
    lastConnectedAt: token?.updatedAt ?? null,
  };
}

async function getRealmId(): Promise<string> {
  const integration = await getQboIntegrationRow();
  const realmId = ((integration?.config ?? {}) as { realmId?: string }).realmId;
  if (!realmId) throw new HttpError(409, 'quickbooks_not_connected');
  return realmId;
}

/** A valid access token, refreshing (and persisting the rotated refresh
 *  token) when the stored one is missing or within a minute of expiry. */
async function freshAccessToken(): Promise<string> {
  const token = await getStoredToken();
  if (!token?.refreshToken) throw new HttpError(409, 'quickbooks_not_connected');
  const expiresSoon = !token.expiry || new Date(token.expiry).getTime() < Date.now() + 60_000;
  if (token.accessToken && !expiresSoon) return token.accessToken;
  const refreshed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: token.refreshToken });
  await saveQboToken(token.userId, refreshed);
  return refreshed.access_token;
}

async function qboFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const realmId = await getRealmId();
  const doFetch = async (accessToken: string) => {
    const url = new URL(`${apiBase()}/v3/company/${realmId}${path}`);
    url.searchParams.set('minorversion', MINOR_VERSION);
    return fetch(url, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  };
  let res = await doFetch(await freshAccessToken());
  if (res.status === 401) {
    // Access token invalidated server-side (password change etc.) — force a
    // refresh and retry once.
    const token = await getStoredToken();
    if (!token?.refreshToken) throw new HttpError(409, 'quickbooks_not_connected');
    const refreshed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: token.refreshToken });
    await saveQboToken(token.userId, refreshed);
    res = await doFetch(refreshed.access_token);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new HttpError(502, `quickbooks_api_error (${res.status}): ${text.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

// QBO query strings take single-quoted literals; escape embedded quotes.
function q(value: string): string {
  return value.replace(/\\/g, '').replace(/'/g, "\\'");
}

async function qboQuery<T>(query: string): Promise<T | undefined> {
  const data = await qboFetch<{ QueryResponse?: Record<string, unknown> }>(
    `/query?query=${encodeURIComponent(query)}`,
  );
  return data.QueryResponse as T | undefined;
}

export type QboCustomer = { id: string; displayName: string };
export type QboItem = { id: string; name: string };

export async function getQboCompanyName(realmId: string, accessToken: string): Promise<string | null> {
  try {
    const url = new URL(`${apiBase()}/v3/company/${realmId}/companyinfo/${realmId}`);
    url.searchParams.set('minorversion', MINOR_VERSION);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { CompanyInfo?: { CompanyName?: string } };
    return data.CompanyInfo?.CompanyName ?? null;
  } catch {
    return null;
  }
}

export async function listQboCustomers(search?: string): Promise<QboCustomer[]> {
  const where = search ? ` where DisplayName like '%${q(search)}%'` : '';
  const resp = await qboQuery<{ Customer?: Array<{ Id: string; DisplayName: string }> }>(
    `select Id, DisplayName from Customer${where} order by DisplayName maxresults 50`,
  );
  return (resp?.Customer ?? []).map((c) => ({ id: c.Id, displayName: c.DisplayName }));
}

export async function listQboServiceItems(): Promise<QboItem[]> {
  const resp = await qboQuery<{ Item?: Array<{ Id: string; Name: string }> }>(
    `select Id, Name from Item where Type = 'Service' order by Name maxresults 200`,
  );
  return (resp?.Item ?? []).map((i) => ({ id: i.Id, name: i.Name }));
}

export async function createQboCustomer(displayName: string): Promise<QboCustomer> {
  const data = await qboFetch<{ Customer: { Id: string; DisplayName: string } }>('/customer', {
    method: 'POST',
    body: { DisplayName: displayName },
  });
  return { id: data.Customer.Id, displayName: data.Customer.DisplayName };
}

export type QboInvoiceResult = { id: string; docNumber: string | null; total: number };

export async function createQboInvoice(input: {
  customerId: string;
  serviceItemId: string;
  lines: Array<{ description: string; hours: number; rate: number }>;
  memo?: string;
}): Promise<QboInvoiceResult> {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const body = {
    CustomerRef: { value: input.customerId },
    Line: input.lines.map((l) => ({
      DetailType: 'SalesItemLineDetail',
      Amount: round2(l.hours * l.rate),
      Description: l.description,
      SalesItemLineDetail: {
        ItemRef: { value: input.serviceItemId },
        Qty: l.hours,
        UnitPrice: l.rate,
      },
    })),
    ...(input.memo ? { CustomerMemo: { value: input.memo } } : {}),
  };
  const data = await qboFetch<{ Invoice: { Id: string; DocNumber?: string; TotalAmt?: number } }>('/invoice', {
    method: 'POST',
    body,
  });
  return {
    id: data.Invoice.Id,
    docNumber: data.Invoice.DocNumber ?? null,
    total: data.Invoice.TotalAmt ?? 0,
  };
}
