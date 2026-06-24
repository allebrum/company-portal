# Project memory — Modern Zen Company Portal

## What this is
A pnpm monorepo: a multi-tenant client portal for Modern Zen (time tracking,
roadmapping, project/client management) plus a public client portal where the
agency's clients sign in, see project status, and connect their own third-party
accounts.

- `apps/api` — Express + Drizzle + postgres.js (TypeScript, ESM)
- `apps/web` — Next.js App Router, **static export** (`output: 'export'`)
- `packages/shared` — zod schemas + TS types shared by api/web (`@modernzen/shared`)

Origin of the codebase: a fork of the open-source `modernzen/company-portal`
(itself derived from the Allebrum/"Hoppa" portal), re-platformed onto Supabase +
Netlify. Working branch: `supabase-migration`.

## Stack & deploy (current)
```
Browser
 ├─ Static Next.js (output:'export')        → Netlify CDN  (apps/web/out)
 ├─ @supabase/supabase-js → Supabase Auth   (staff login, JWT)
 │                          Supabase Realtime (private Broadcast channels)
 │                          Supabase Storage  (file uploads, `spaces` bucket)
 └─ fetch /api/*          → Netlify Function (netlify/functions/api.mts wraps
                            buildApp() from apps/api/src/app.ts via serverless-http)
                              └─ Drizzle → Supabase Postgres (transaction pooler :6543)
```
- **Live:** https://modernzen-company-portal.netlify.app (Netlify site
  `modernzen-company-portal`, Modern Zen team). Sole admin: **sedale@modernzen.co**.
- **DB:** Supabase project ref `toaiixygsfawersdxvnx`. Migrations run via
  `drizzle-kit migrate` against the **session pooler :5432**; the serverless
  function connects via the **transaction pooler :6543**.
- **Secrets** live in gitignored `.env` (root) + `apps/web/.env.local`. Never
  commit them. Netlify env vars are set via `netlify api createEnvVars` (the
  CLI's interactive monorepo prompt hangs otherwise); deploy via temporarily
  renaming `pnpm-workspace.yaml` aside + `netlify deploy --no-build`.

## Auth model
- **Staff:** Supabase Auth (email+password). The Supabase JWT is sent as
  `Authorization: Bearer`; `apps/api/src/auth/supabaseAuth.ts` verifies it and
  sets `req.session.user = {userId, tenantId}`. Tenant is resolved per-request
  from `tenant_members` (the JWT carries no tenant claim yet) + an optional
  `x-tenant-id` header for workspace switching.
- **Client portal:** stateless HMAC token (`X-Portal-Token`, `PORTAL_SESSION_SECRET`),
  minted at `/api/portal/exchange` from a single-use magic-link token. Portal
  contacts are NOT Supabase users; `clientId` is read only from the token.

## Multi-tenancy
Row-level `tenant_id` on tenant-owned tables; AsyncLocalStorage request context
(`tenancy/context.ts`), `tenantEq()`/`stampTenant()` helpers (`tenancy/scope.ts`).
`tenants` + `tenant_members` tables. RLS is enabled deny-by-default (migration
0001); the API connects as the service/postgres role and bypasses RLS, so app
authorization is enforced in code (defense-in-depth in the DB).

## Realtime (Phase 4)
`apps/api/src/realtime/emit.ts` publishes to Supabase Realtime Broadcast over the
REST endpoint with the service-role key (no websocket from the function). Browsers
subscribe to PRIVATE channels `tenant:{id}` / `user:{id}` / `approvers:{tenant}`
in `apps/web/src/app/providers.tsx` (LiveEventBindings), gated on a Supabase
session + `NEXT_PUBLIC_REALTIME_ENABLED`. RLS on `realtime.messages` (migration
0004) enforces channel access. The client portal stays refetch-only (no Supabase
session). Socket.IO is fully removed.

## Storage (Phase 5)
File uploads (`services/storage.ts`) go to a public `spaces` bucket keyed
`<tenant>/<scope>/<scopeId>/<uuid>/<filename>` (unguessable capability URLs).
`SpaceFile.url` is the public object URL; `storageKey` holds the object path.
Google Drive is legacy — `drive.ts` + the `/integrations/drive` Media-manager
surface still exist but need a Drive connection and are not the primary path.
Follow-up: harden to a private bucket + signed URLs gated on `sharedWithClient`.

## Email (Phase 6)
Transactional mail (`services/mail.ts`) goes through **Resend** (HTTP API,
`services/resend.ts`) when `RESEND_API_KEY` + `MAIL_FROM` are set, else falls
back to the legacy Gmail-OAuth path / log-only; delivery never throws. From =
`Modern Zen <no-reply@modernzen.co>` (verified Resend domain). Supabase Auth's
own emails (staff invite / password reset) are configured separately via custom
SMTP in the Supabase dashboard (pending).

## Connect feature (clients' third-party accounts)
In the client portal, the **primary** contact connects their own SaaS tools
(Composio) and social channels (Zernio). Server code in `apps/api/src/connect/*`
+ `routes/connect.ts`; keys `COMPOSIO_API_KEY` / `ZERNIO_API_KEY`. The app never
stores raw provider credentials; OAuth round-trips use signed state. See `CONNECT.md`.

## Guardrails (hard rules)
- Never commit secrets; `.env*` are gitignored.
- Never force-push shared branches; make new commits, not amends, on pushed work.
- Any new migration must be safe on populated data (idempotent / backfilled) and
  tenant-owned tables must carry `tenant_id` and be scoped via `tenantEq()` /
  `stampTenant()`.
- Do NOT edit historical migrations or `drizzle/meta` snapshots — add a new one.
- `X-Hoppa-Signature` (provisioning HMAC header) is a cross-service contract value
  — do not rename.

## Key conventions
- DB: Drizzle schema in `apps/api/src/db/schema.ts`; `drizzle-kit generate` for
  schema-derived migrations; hand-written SQL migrations (RLS, etc.) are added to
  `drizzle/` + registered in `drizzle/meta/_journal.json`.
- `db:init` is the idempotent bootstrap (permissions, system groups, app_settings,
  break-glass admin, `spaces` bucket). `db:seed` is a destructive dev fixture.
- Billing/provisioning (the marketing-service HMAC contract) stays inert for this
  greenfield instance (`BILLING_ENFORCED` unset).

## Reference docs
- `MIGRATION.md` — the phased Supabase+Netlify migration log.
- `CONNECT.md` — the Composio/Zernio client-connections feature.
