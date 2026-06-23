# Modern Zen Portal — Supabase + Netlify migration

This branch (`supabase-migration`) re-platforms the company portal — a fork of
[`allebrum/company-portal`](https://github.com/allebrum/company-portal) — onto
**Supabase + Netlify** and rebrands it for Modern Zen. It is a **greenfield**
migration: no production data is preserved, so the schema and auth model are
reshaped freely rather than backfilled.

## Why

Upstream is a stateful Node monolith — Express + Socket.IO on one HTTP server,
self-hosted Postgres (Drizzle), Redis (sessions + Socket.IO pub/sub), argon2 +
`express-session` auth, Google Drive for files — shipped as a Docker container.
Netlify hosts static frontends and *stateless* serverless functions; it can't
run a persistent WebSocket server. So "deploy on Netlify" requires retiring the
stateful pieces and replacing them with Supabase's managed services. Those
pieces reinforce each other: once realtime moves to Supabase and sessions become
JWTs, the remaining API is stateless and fits Netlify Functions.

## Target architecture

```
Browser
  ├── Next.js (static export)        → Netlify CDN
  ├── @supabase/supabase-js          → Supabase Auth (JWT) · Realtime · Storage
  └── fetch /api/*                   → Netlify Functions (Express via serverless-http)
                                          └── Drizzle → Supabase Postgres (RLS)
```

- **Auth** — Supabase Auth (email/password, OAuth, MFA). Stateless JWT; no Redis/session store.
- **DB** — Supabase Postgres. Drizzle stays the schema/query layer; RLS enforces tenant isolation.
- **Realtime** — Supabase Realtime (replacing Socket.IO + Redis).
- **Storage** — Supabase Storage (replacing Google Drive as the default).
- **Server logic** — the existing Express routes, re-homed to Netlify Functions.

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Rename `@allebrum/*` → `@modernzen/*`, CI, Supabase scaffolding | ✅ done |
| 1 | Database on Supabase + identity reshape | ✅ done |
| 2 | Auth → Supabase Auth | 🔧 backend done · frontend next |
| 3 | API → Netlify Functions | ⏳ pending |
| 4 | Realtime → Supabase Realtime | ⏳ pending |
| 5 | Storage → Supabase Storage | ⏳ pending |
| 6 | Email via Resend | ⏳ pending |
| 7 | Netlify + Supabase cloud deploy | ⏳ pending |
| 8 | Rebrand finalization (Allebrum/Hoppa → Modern Zen) | ⏳ pending |
| 9 | Code-quality refactor + tests | ⏳ pending |

## What's done on this branch

**Phase 0 — Foundation**
- Package scope `@allebrum/*` → `@modernzen/*` across all workspaces and imports.
- GitHub Actions CI (`.github/workflows/ci.yml`): install → typecheck → build → test.
- Supabase scaffolding (`supabase/`, `@supabase/supabase-js`, browser + service-role client modules).

**Phase 1 — Database + identity** (verified live on a Supabase project)
- `users` reshaped into a profile keyed to Supabase `auth.users.id` (FK, `on delete cascade`).
- Dropped `password_hash` / `google_sub` / `auth_provider` and the custom TOTP / WebAuthn /
  recovery-code tables — Supabase Auth owns credentials and MFA now.
- 29 historical migrations squashed into one baseline + a platform migration that adds the
  `auth.users` FK and enables Row-Level Security (deny-by-default) on every table.

**Phase 2 — Auth (backend)**
- Stateless **Supabase-JWT middleware**: verifies the `Authorization: Bearer` token and populates a
  `req.session.user = { userId, tenantId }` shim, so existing call sites are unchanged. Active
  workspace via an optional `x-tenant-id` header; the same resolver authenticates the Socket.IO handshake.
- `routes/auth.ts` slimmed to the Supabase-compatible surface (`/config`, `/me`, `/methods`,
  `/switch-workspace`, `/posthog-identity`). Password/OAuth/2FA/reset/invite happen client-side via Supabase.
- Identities are provisioned through the **Supabase Admin API** (`seed`, `init`, invites): the auth
  user is created first, then a profile row keyed to its uid.
- **Redis and `express-session` removed entirely**: Socket.IO runs on the in-memory adapter with
  JWT-handshake auth; rate-limit and IP-geo caches are in-process.

## Running locally

```bash
# 1. Configure env — point at YOUR Supabase project (URL, anon + service-role keys, DB pooler URL).
cp .env.example .env            # root: API/server env
#   also create apps/web/.env.local with NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
# (New cloud Supabase projects expose the DB over the IPv4 pooler — see notes in .env.example.)

# 2. Install + migrate + seed
pnpm install
pnpm db:migrate
pnpm db:seed                    # ⚠ destructive DEV fixture: TRUNCATEs data and creates demo
                                #   Supabase Auth users; it prints the demo password. NOT for production.

# 3. Run (API on :8080, web on :3000)
pnpm dev
```

`pnpm db:seed` is a development fixture only. For a real deployment use `pnpm db:migrate` + the
idempotent `db:init` bootstrap (it never prints or hardcodes a password), and do not ship the demo
seed users.

## Deferred / known gaps

- **Frontend auth UI** still uses the legacy flow — rewiring `useAuth` + the login/signup/reset
  pages onto `supabase.auth` (and `lib/api.ts` to send the Bearer token) is the immediate next step.
- **Client-portal magic-link login** and **Drive/Gmail OAuth-connect** state need stateless reworks.
- **RLS** is deny-by-default with no per-table policies yet; policies + a custom access-token hook
  (tenant claim) land alongside direct-from-browser Supabase access, gated by a cross-tenant
  isolation test.
- Realtime (Socket.IO → Supabase Realtime), Storage (Drive → Supabase Storage), the API host
  (Node server → Netlify Functions), email (→ Resend), and the full **Allebrum/Hoppa → Modern Zen**
  branding sweep are still pending phases.

## License

Free and open-source under the **GNU AGPL-3.0**, unchanged from upstream.
