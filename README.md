# Modern Zen Company Portal

A multi-tenant client portal for Modern Zen: time tracking, roadmapping, and
project/client management for the team — plus a public **client portal** where
the agency's clients sign in, follow project status, and connect their own
third-party accounts (Composio for SaaS tools, Zernio for social).

Re-platformed onto **Supabase + Netlify**. Static Next.js frontend on the
Netlify CDN, an Express API running as a Netlify Function, and Supabase for
Auth, Postgres, Realtime, and Storage.

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

## Docs

- `CLAUDE.md` — architecture, auth model, deploy notes, and guardrails.
- `MIGRATION.md` — the Supabase + Netlify migration log.
- `CONNECT.md` — the Composio/Zernio client-connections feature.
