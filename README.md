# Modern Zen Company Portal

A multi-tenant client portal for Modern Zen: time tracking, roadmapping, and
project/client management for the team — plus a public **client portal** where
the agency's clients sign in, follow project status, and connect their own
third-party accounts (Composio for SaaS tools, Zernio for social).

Re-platformed onto **Supabase + Netlify**. Static Next.js frontend on the
Netlify CDN, an Express API running as a Netlify Function, and Supabase for
Auth, Postgres, Realtime, and Storage.

> **Want to run your own?** Follow [`DEPLOY.md`](DEPLOY.md) — a step-by-step
> fork-and-deploy guide (Supabase project, env vars, migrations, Netlify,
> Resend), including the gotchas we hit.

## Stack

| Layer | Tech |
|---|---|
| Web | Next.js (App Router, static export `output:'export'`) → Netlify CDN |
| API | Express (TypeScript, ESM) via `serverless-http` → Netlify Function |
| Auth | Supabase Auth (staff JWT) + stateless HMAC token for the client portal |
| DB | Supabase Postgres + Drizzle ORM (postgres.js, transaction pooler) |
| Realtime | Supabase Realtime Broadcast (private channels) |
| Storage | Supabase Storage (`spaces` bucket) |
| Email | Resend (transactional) |

Monorepo (pnpm workspaces):

- `apps/web` — the Next.js app (`@modernzen/web`)
- `apps/api` — the Express API + Drizzle schema/migrations (`@modernzen/api`)
- `packages/shared` — zod schemas + shared types (`@modernzen/shared`)

## Develop

```bash
pnpm install
pnpm build          # builds shared → api → web
pnpm typecheck
pnpm --filter @modernzen/api test
```

Environment lives in gitignored `.env` (root, API) and `apps/web/.env.local`
(web build-time `NEXT_PUBLIC_*`). Key vars: `DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PORTAL_SESSION_SECRET`,
`RESEND_API_KEY`, `MAIL_FROM`, and (optional) `COMPOSIO_API_KEY` /
`ZERNIO_API_KEY`. See `.env.example`.

Database migrations (Drizzle):

```bash
pnpm --filter @modernzen/api exec drizzle-kit migrate   # apply
pnpm --filter @modernzen/api db:init                    # idempotent bootstrap
```

`db:init` ensures the permission catalog, system groups, app settings, the
break-glass admin (`ADMIN_EMAIL` / `ADMIN_PASSWORD`), and the `spaces` Storage
bucket. `db:seed` is a **destructive** dev fixture — never run it against a real
database.

## Deploy (Netlify)

The web app is built locally and published with the API function:

```bash
pnpm build
netlify deploy --prod --dir apps/web/out --functions netlify/functions --no-build
```

`netlify.toml` redirects `/api/*` to the function. Set environment variables via
`netlify api createEnvVars` (the CLI's interactive monorepo prompt otherwise
hangs). See `CLAUDE.md` for the operational details and `MIGRATION.md` for the
phased migration history.

## The re-platform (how this was built)

This codebase started as a **stateful Node monolith**: Express + Socket.IO on a
single long-running server, self-hosted Postgres, Redis for sessions and pub/sub,
argon2 + `express-session` auth, and Google Drive for file storage — packaged as
one Docker container on DigitalOcean.

The constraint that drove everything: **Netlify can't run a persistent
WebSocket/Socket.IO server** — it hosts static frontends and *stateless*
functions. So "deploy on Netlify" meant retiring every stateful piece and
swapping in Supabase's managed primitives. The migration ran in phases, each one
shippable and green in CI:

| Phase | What changed |
|---|---|
| 0 | Package rename → `@modernzen/*`, CI, scaffolding |
| 1 | Postgres → **Supabase Postgres**; identity reshaped onto `auth.users` |
| 2 | Auth → **Supabase Auth** (stateless JWT); dropped Redis sessions + argon2 |
| 3 | Express → a **Netlify Function** (`serverless-http`) |
| 4 | Socket.IO → **Supabase Realtime** Broadcast (private channels + RLS) |
| 5 | Google Drive uploads → **Supabase Storage** |
| 6 | Transactional email → **Resend** |
| 7 | Cloud deploy on **Netlify + Supabase** |
| 8 | Rebrand + remove legacy infra |
| 9 | Tests for the riskiest pure logic |

**Design decisions worth knowing:**

- **The API logic was preserved, not dissolved into RLS.** Rather than delete the
  server and have the browser talk to Supabase directly, the proven Express
  route/service layer was re-homed to a Netlify Function. RLS is defense-in-depth,
  not the only authorization layer. This kept genuinely procedural logic
  (pay-period generation, the approval state machine, HMAC webhooks) intact.
- **Three chokepoints made it tractable.** `lib/api.ts` (cookies → Bearer),
  `realtime/emit.ts` (6 helpers → Supabase Broadcast; every call site unchanged),
  and the client event→query-invalidation map (kept verbatim across the
  Socket.IO → Supabase Realtime swap).
- **Two auth tracks.** Staff use a Supabase JWT; client-portal contacts use a
  stateless HMAC token (`X-Portal-Token`) and are not Supabase users.

See `MIGRATION.md` for the blow-by-blow and `CLAUDE.md` for the current
architecture.

## Docs

- [`DEPLOY.md`](DEPLOY.md) — **fork-and-deploy guide** (start here to run your own).
- `CLAUDE.md` — architecture, auth model, deploy notes, and guardrails.
- `MIGRATION.md` — the Supabase + Netlify migration log.
- `CONNECT.md` — the Composio/Zernio client-connections feature.
