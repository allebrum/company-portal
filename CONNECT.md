# Client Connections (Composio + Zernio)

A capability inside the **client portal**: an agency client's **primary contact**
connects their own third-party accounts so Modern Zen can run workflows on their
behalf — **without this app ever storing raw credentials**. Two providers hold
and auto-refresh the tokens:

- **Composio** — productivity/SaaS tools (Gmail, Slack, Notion, Drive, Calendar, 500+).
- **Zernio** — social channels (LinkedIn, X, Instagram, TikTok, YouTube, Facebook, Pinterest, …).

## The one rule the design rests on

**One stable internal `client_id` → one Composio `user_id` → one Zernio `profile_id`.**
Here `client_id` is the existing **client (company)** row (`clients.id`). The
Composio `user_id` is that same id; the Zernio profile is created once per client.
**A `profileId`/`user_id` is never accepted from the browser** — it's always
derived server-side from the authenticated portal session (or the signed OAuth
`state` on a public callback).

## Where it lives

Built into the existing magic-link **client portal** (`/portal/*`), not a
separate app:

- **Who:** `clientContacts` with `role = 'primary'`. Connecting accounts is a
  higher-trust action than the portal's read-only surfaces, so it's
  primary-only — enforced in the UI **and** server-side (`requirePrimaryContact`).
- **Auth:** the stateless portal-session token (`X-Portal-Token`); the API runs
  as the Supabase service role and scopes every query by the session's `client_id`.
- **Pages:** `/portal/connections` (the hub) and `/portal/activity` (the audit log).

## Architecture

```
Browser (Next.js static export, on Netlify)
  └── /portal/* pages  ──X-Portal-Token──►  Express API (Netlify Functions)
                                              ├── connect/composio.ts  → Composio (managed OAuth)
                                              ├── connect/zernio.ts     → Zernio REST
                                              ├── connect/provision.ts  → one profile/user per client
                                              ├── connect/workflows.ts  → on-behalf actions
                                              └── Supabase Postgres: connections, workflow_runs (RLS)
```

All provider calls happen in server code; **no provider key ever reaches the browser.**

## Data model (Supabase Postgres, RLS enabled)

- `clients.composio_user_id`, `clients.zernio_profile_id` (both unique).
- `connections(id, client_id, tenant_id, provider['composio'|'zernio'], external_id, integration, display_name, status, connected_at)` — `unique(client_id, provider, external_id)`.
- `workflow_runs(id, client_id, tenant_id, kind, payload jsonb, result jsonb, created_at)` — one row per on-behalf action (success or failure).

RLS is deny-by-default on both tables; the API uses the service role and scopes
by `client_id` from the verified session (defense-in-depth, not the primary gate).

## Environment variables (server-only; see `.env.example`)

| Var | Purpose |
|---|---|
| `COMPOSIO_API_KEY` | Composio managed-OAuth + tool execution. **Server-only.** |
| `ZERNIO_API_KEY` | Zernio REST (`sk_` + 64 hex). **Server-only.** |
| `PORTAL_SESSION_SECRET` | HMAC for the stateless portal session + OAuth `state`. |
| `APP_URL` | Public origin used to build provider OAuth redirect URLs. |

## Flows

- **Provision** (`connect/provision.ts`) — on first connect, sets `composio_user_id = client.id` and lazily creates the Zernio profile. Serialized per client with a Postgres advisory lock (no duplicate profiles under concurrency).
- **Connect** — `POST /api/connect/{composio,zernio}` (primary-gated) returns the provider URL; the browser full-page-redirects. The public callback (`…/callback/:state`) verifies the signed `state`, cross-checks the returned account belongs to this client, and upserts a `connections` row.
- **Workflows** — `POST /portal/workflows/social-post` (Zernio `POST /posts` to the client's connected channels) and `POST /portal/workflows/composio-tool` (a fixed safe demo: list Gmail labels). Each writes a `workflow_runs` row.
- **Disconnect** — `DELETE /portal/connections/:id` (primary-gated) revokes at the provider (`connectedAccounts.delete` / `DELETE /v1/accounts/:id`) then removes the local row.
- **Refresh / revocation** — `POST /portal/connections/refresh` re-reads both providers and reconciles status (marks provider-revoked accounts as `revoked`). The real-time path (Composio expiry events, Zernio `account.disconnected` webhook) is a future enhancement.

## Verification (the "done" loop)

1. Publish a client portal (set `portalSlug` + publish), invite a **primary** contact, sign in via the magic link.
2. **Connections** → connect a Gmail (Composio) and a LinkedIn (Zernio); both show **Connected**.
3. **Run a test** → post an update (Zernio) and "List Gmail labels" (Composio).
4. **Activity** → both runs appear with status.
5. **Disconnect** one; confirm it's revoked at the provider and gone from the hub.

## Security notes & accepted trade-offs

- Provider keys are **server-only**; ids/profileIds are derived server-side, never from the request.
- Connect/disconnect are **primary-contact-only**, enforced server-side (not just hidden in the UI).
- Every OAuth round-trip carries a **signed `state`** (CSRF + cross-client-linking protection), verified on the callback, with a 15-minute expiry.
- **Known trade-offs (documented, revisit before scale):**
  - The portal-session token lives in `localStorage` (XSS-readable). Acceptable for the low-sensitivity portal; an `httpOnly` cookie is the hardened alternative if/when the portal carries more.
  - OAuth `state` is stateless (signed, 15-min TTL + account cross-check) rather than a server-stored nonce — a replay within the window only re-upserts the same connection.
  - Provider keys live in env vars. In production use the platform's encrypted env / a secrets manager, rotate regularly, and scope to least privilege.

## Pre-launch (before real clients)

- **White-label the Composio consent screens.** Replace `use_composio_managed_auth` with **custom auth configs using your own OAuth app credentials per toolkit**, so the consent screen shows the Modern Zen brand. Tighten scopes to least-privilege per toolkit.
- **Legal.** Your account holds delegated access to client accounts even though you never see raw tokens. Cover this in your **client agreement / DPA**, and confirm each platform's **Terms of Service** permit third-party action via their official APIs.
