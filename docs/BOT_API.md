# Bot API (personal access tokens)

Bots, scripts, and AI assistants can do **anything you can do in Hoppa** —
create clients and projects, write notes, track and approve time, manage the
roadmap and to-dos, and more — using a personal access token (PAT).

- A token acts as the user who created it, in the workspace it was created in,
  through **the same endpoints the web app uses**.
- **Role ceiling:** it can never do more than that user can do in the browser
  *right now*. Permissions are checked live on every request, so if your role
  is reduced, your tokens lose that access immediately. Deactivating you or
  removing you from the workspace disables all of your tokens there.
- **Scopes** choose which areas a token may touch. Pick individual scopes, or
  **Full access (same as me)** (`full`), which also covers scopes/features
  added later.
- A few things are **session-only** and never available to any token (see §4):
  creating/listing/revoking tokens, login/logout, password, email, 2FA,
  sign-in policy, connecting third-party accounts, and billing.

## 1. Create a token

In the portal, go to **Security → API tokens**. Give the token a name (e.g.
"Grok bot"), choose **Full access (same as me)** or pick scopes, choose an
expiry (30/90/365 days or never), then click **Create token**. Copy the
`hpat_…` value. **It is shown once**; only a SHA-256 hash is stored. The list
shows each token's scopes, when it was last used, and its expiry. Revoking
takes effect immediately.

| Scope | Grants |
|---|---|
| `read` | Read workspace data: clients, projects, notes, time & timers, roadmap, to-dos, tickets, team, activity, settings, pay periods, forms, QR codes, websites (not stored credentials), integration status, Drive listings |
| `notes:write` | Append, edit, reorder and delete Notes blocks in client/project Spaces |
| `time:write` | Start/stop timers, log and edit time entries |
| `time:manage` | Delete time entries; submit, approve, reject, reopen |
| `clients:write` | Create and edit clients; manage client-portal contacts |
| `projects:write` | Create and edit projects |
| `roadmap:write` | Create/edit/move/delete goals, epics, milestones and to-dos (tasks) |
| `tickets:write` | Reply to, triage and close client-portal tickets |
| `files:write` | Upload/rename/delete files in Spaces, to-dos, goals and Google Drive; upload-QR sessions |
| `tools:write` | Create/edit/delete forms, QR codes and websites |
| `finance:write` | Pay periods, pay config, client invoicing (incl. QuickBooks invoices) |
| `team:admin` | Invite/edit/remove users, groups & permissions, workspace branding/settings, sample data |
| `secrets:read` | Read stored website credentials |
| `full` | All of the above, and anything added later |

Every scope is still subject to your role. For example, `time:manage` lets a
token approve time only if *you* hold `time_entry.approve`; `team:admin` does
nothing for a member who can't manage users.

Tokens created before this change keep exactly the scopes they had
(`read`, `notes:write`, `time:write`). Note that `read` now covers more read
endpoints (users, roadmap, settings, …) than before.

## 2. Authenticate

```
Authorization: Bearer hpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Base URL: `https://app.hoppa.io/api` (self-host: your portal/API origin plus
`/api`). No cookies or CSRF token are needed — the CSRF/origin check is skipped
for bearer requests (a cross-site page can't attach an `Authorization` header)
and stays enforced for cookie sessions. If you send `Authorization: Bearer`,
the request is authenticated by token only; cookies are ignored.

```bash
export HOPPA=https://app.hoppa.io/api
export HOPPA_TOKEN=hpat_...      # keep this secret; never log it
curl -s -H "Authorization: Bearer $HOPPA_TOKEN" $HOPPA/api-tokens/current
# {"userId":"…","tenantId":"…","via":"token","tokenId":"…","tokenName":"Grok bot","scopes":["full"],"expiresAt":null}
```

### What can this token do? `GET /me/capabilities`

```bash
curl -s -H "Authorization: Bearer $HOPPA_TOKEN" $HOPPA/me/capabilities | jq '{via, token, effectiveScopes, permissions}'
curl -s -H "Authorization: Bearer $HOPPA_TOKEN" $HOPPA/me/capabilities | jq '.actions[] | select(.allowed) | "\(.method) \(.path)"'
```

Returns the user (`id`, `name`, `email`), the token (`id`, `name`, `scopes`,
`expiresAt`), `effectiveScopes` (`full` expanded), `permissions` (your live
RBAC permissions — the hard ceiling), `actions` (every token-reachable
endpoint with its scope and whether this token holds it), and `sessionOnly`
(endpoints no token can reach, with the reason). Works with any valid token.

## 3. Common tasks

`client`/`project` in Space paths may also be written `clients`/`projects`.

### Clients and projects

```bash
# list
curl -s -H "Authorization: Bearer $HOPPA_TOKEN" $HOPPA/clients  | jq '.[] | {id, name}'
curl -s -H "Authorization: Bearer $HOPPA_TOKEN" $HOPPA/projects | jq '.[] | {id, name, clientId}'
# create a client (clients:write) — only `name` is required
curl -s -X POST $HOPPA/clients -H "Authorization: Bearer $HOPPA_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Family Relief Project","kind":"agency"}'
# create a project (projects:write) — `clientId` + `name` required
curl -s -X POST $HOPPA/projects -H "Authorization: Bearer $HOPPA_TOKEN" -H 'Content-Type: application/json' \
  -d '{"clientId":"'$CLIENT_ID'","name":"Website refresh","billable":true,"budgetHrs":40}'
# rename / edit (projects:write + your projects.manage permission)
curl -s -X PATCH $HOPPA/projects/$PROJECT_ID -H "Authorization: Bearer $HOPPA_TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Website refresh 2026"}'
```

### Notes: read, append, edit, delete, reorder

```bash
# read
curl -s -H "Authorization: Bearer $HOPPA_TOKEN" $HOPPA/spaces/client/$CLIENT_ID/blocks
# {"id":"…","name":"Family Relief Project","blocks":[{"id":"…","type":"text","content":"…"}],"updatedAt":"2026-10-23 16:39:49.853-07"}

# append (always goes to the end; ids assigned by the server)
curl -s -X POST $HOPPA/spaces/client/$CLIENT_ID/blocks \
  -H "Authorization: Bearer $HOPPA_TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "blocks": [
      { "type": "h2", "content": "Resources — 2026-10-23" },
      { "type": "bullet", "content": "Wysa AI self-help: https://www.wysa.com/ai-self-help" },
      { "type": "checkbox", "content": "Share with the family coordinator" },
      { "type": "embed", "embedUrl": "https://www.wysa.com/ai-self-help" }
    ]
  }'
# 201 {"id":"…","appended":[…],"total":42,"updatedAt":"…"}

# edit ONE block (content / type / checked / embedUrl); other blocks untouched
curl -s -X PATCH $HOPPA/spaces/client/$CLIENT_ID/blocks/$BLOCK_ID \
  -H "Authorization: Bearer $HOPPA_TOKEN" -H 'Content-Type: application/json' -d '{"checked":true}'
# {"id":"…","block":{…},"total":42,"updatedAt":"…"}

# delete ONE block
curl -s -X DELETE $HOPPA/spaces/client/$CLIENT_ID/blocks/$BLOCK_ID -H "Authorization: Bearer $HOPPA_TOKEN"

# reorder / bulk rewrite: PATCH the full list (notes:write is enough when the body
# has only spaceBlocks/spaceFiles). Send the updatedAt you read; on 409 re-read and retry.
curl -s -X PATCH $HOPPA/clients/$CLIENT_ID -H "Authorization: Bearer $HOPPA_TOKEN" \
  -H 'Content-Type: application/json' -H "x-expected-updated-at: $UPDATED_AT" \
  -d '{"spaceBlocks":[ …every block, in the new order… ]}'
```

Block fields: `type` (default `text`; one of `text h1 h2 h3 bullet numbered
checkbox quote callout divider embed`), `content` (≤ 20,000 chars; single line
when editing one block), `checked` (checkbox), `embedUrl` + optional
`embedKind` (`link|figma|github|drive`) for `embed` (must be `http(s)://`). At
most 200 blocks per append. A Space holds at most 2,000 blocks
(`413 space_notes_full`). Linked cards (to-dos, goals, timers, links) can be
deleted or moved but not created/edited through the per-block endpoints.

### Track time

```bash
# start (one timer per user; starting a new one stops and saves the running one)
curl -s -X POST $HOPPA/entries/timer/start -H "Authorization: Bearer $HOPPA_TOKEN" \
  -H 'Content-Type: application/json' -d '{"projectId":"'$PROJECT_ID'","note":"Researching resources"}'
curl -s -H "Authorization: Bearer $HOPPA_TOKEN" $HOPPA/entries/timer          # what's running?
curl -s -X POST $HOPPA/entries/timer/stop -H "Authorization: Bearer $HOPPA_TOKEN" \
  -H 'Content-Type: application/json' -d '{}'                                  # 404 no_active_timer if none
# log a past block of time
curl -s -X POST $HOPPA/entries -H "Authorization: Bearer $HOPPA_TOKEN" -H 'Content-Type: application/json' \
  -d '{"projectId":"'$PROJECT_ID'","note":"Call with family","startIso":"2026-10-23T09:00:00-07:00","endIso":"2026-10-23T09:30:00-07:00"}'
# fix a note
curl -s -X PATCH $HOPPA/entries/$ENTRY_ID -H "Authorization: Bearer $HOPPA_TOKEN" \
  -H 'Content-Type: application/json' -d '{"note":"Call with family coordinator"}'
# list this week's entries
curl -s -H "Authorization: Bearer $HOPPA_TOKEN" "$HOPPA/entries?from=2026-10-19&to=2026-10-25"
```

### Manage time (`time:manage`)

```bash
curl -s -X DELETE $HOPPA/entries/$ENTRY_ID -H "Authorization: Bearer $HOPPA_TOKEN"
curl -s -X POST $HOPPA/entries/submit  -H "Authorization: Bearer $HOPPA_TOKEN" -H 'Content-Type: application/json' -d '{"ids":["'$ENTRY_ID'"]}'
# approvers only (time_entry.approve):
curl -s -X POST $HOPPA/entries/approve -H "Authorization: Bearer $HOPPA_TOKEN" -H 'Content-Type: application/json' -d '{"ids":["'$ENTRY_ID'"]}'
curl -s -X POST $HOPPA/entries/reject  -H "Authorization: Bearer $HOPPA_TOKEN" -H 'Content-Type: application/json' -d '{"ids":["'$ENTRY_ID'"],"note":"Please split by project"}'
curl -s -X POST $HOPPA/entries/reopen  -H "Authorization: Bearer $HOPPA_TOKEN" -H 'Content-Type: application/json' -d '{"ids":["'$ENTRY_ID'"]}'
```

### Roadmap and to-dos (`roadmap:write`)

```bash
# to-do (task)
curl -s -X POST $HOPPA/todos -H "Authorization: Bearer $HOPPA_TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Send intake form","projectId":"'$PROJECT_ID'","dueDate":"2026-11-01","priority":"high"}'
curl -s -X POST $HOPPA/todos/$TODO_ID/toggle -H "Authorization: Bearer $HOPPA_TOKEN"     # done / not done
curl -s -X DELETE $HOPPA/todos/$TODO_ID -H "Authorization: Bearer $HOPPA_TOKEN"
# goal, moved across the board
curl -s -X POST $HOPPA/goals -H "Authorization: Bearer $HOPPA_TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Launch new site","clientId":"'$CLIENT_ID'","projectId":"'$PROJECT_ID'"}'
curl -s -X PATCH $HOPPA/goals/$GOAL_ID/status -H "Authorization: Bearer $HOPPA_TOKEN" \
  -H 'Content-Type: application/json' -d '{"status":"in-progress"}'
# milestone
curl -s -X POST $HOPPA/milestones -H "Authorization: Bearer $HOPPA_TOKEN" -H 'Content-Type: application/json' \
  -d '{"projectId":"'$PROJECT_ID'","title":"Beta","date":"2026-12-01"}'
```

### Team (`team:admin`, plus your `users.manage` / `groups.manage`)

```bash
curl -s -H "Authorization: Bearer $HOPPA_TOKEN" $HOPPA/users | jq '.[] | {id, name, email}'
curl -s -X POST $HOPPA/users -H "Authorization: Bearer $HOPPA_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Pat Doe","email":"pat@example.com"}'
```

Request bodies are the same as the web app's (zod schemas in
`packages/shared/src/schemas`). A `400 validation_failed` response lists the
exact `issues`.

### Full endpoint reference

Paths are relative to the base URL. Anything not listed returns
`403 token_route_not_allowed`.

#### Identity & discovery

| Method | Path | Scope |
|---|---|---|
| GET | `/api-tokens/current` | any |
| GET | `/me/capabilities` | any |
| GET | `/auth/me` | `read` |
| GET | `/bootstrap` | `read` |

#### Clients

| Method | Path | Scope |
|---|---|---|
| GET | `/clients` | `read` |
| POST | `/clients` | `clients:write` |
| PATCH | `/clients/:id` | `clients:write` (notes-only body → `notes:write`) |
| GET | `/clients/:id/contacts` | `read` |
| POST | `/clients/:id/contacts` | `clients:write` |
| PATCH | `/clients/:id/contacts/:contactId` | `clients:write` |
| DELETE | `/clients/:id/contacts/:contactId` | `clients:write` |
| POST | `/clients/:id/contacts/:contactId/resend` | `clients:write` |

#### Projects

| Method | Path | Scope |
|---|---|---|
| GET | `/projects` | `read` |
| POST | `/projects` | `projects:write` |
| PATCH | `/projects/:id` | `projects:write` (notes-only body → `notes:write`) |

#### Space notes & files

| Method | Path | Scope |
|---|---|---|
| GET | `/spaces/:scopeKind/:scopeId/blocks` | `read` |
| POST | `/spaces/:scopeKind/:scopeId/blocks` | `notes:write` |
| PATCH | `/spaces/:scopeKind/:scopeId/blocks/:blockId` | `notes:write` |
| DELETE | `/spaces/:scopeKind/:scopeId/blocks/:blockId` | `notes:write` |
| POST | `/spaces/:scopeKind/:scopeId/files` | `files:write` |
| PATCH | `/spaces/:scopeKind/:scopeId/files/:fileId` | `files:write` |
| POST | `/spaces/:scopeKind/:scopeId/files/refresh-drive-names` | `files:write` |

#### Time & timers

| Method | Path | Scope |
|---|---|---|
| GET | `/entries` | `read` |
| GET | `/entries/export.csv` | `read` |
| GET | `/entries/timer` | `read` |
| GET | `/entries/timers` | `read` |
| POST | `/entries` | `time:write` |
| PATCH | `/entries/:id` | `time:write` |
| POST | `/entries/timer/start` | `time:write` |
| POST | `/entries/timer/stop` | `time:write` |
| DELETE | `/entries/:id` | `time:manage` |
| POST | `/entries/submit` | `time:manage` |
| POST | `/entries/approve` | `time:manage` |
| POST | `/entries/reject` | `time:manage` |
| POST | `/entries/reopen` | `time:manage` |

#### Roadmap: goals, epics, milestones, to-dos

| Method | Path | Scope |
|---|---|---|
| GET | `/goals` | `read` |
| POST | `/goals` | `roadmap:write` |
| PATCH | `/goals/:id` | `roadmap:write` |
| PATCH | `/goals/:id/status` | `roadmap:write` |
| POST | `/goals/:id/resources` | `roadmap:write` |
| PATCH | `/goals/:id/resources/:rid` | `roadmap:write` |
| DELETE | `/goals/:id/resources/:rid` | `roadmap:write` |
| POST | `/goals/:id/resources/upload` | `files:write` |
| GET | `/epics` | `read` |
| POST | `/epics` | `roadmap:write` |
| PATCH | `/epics/:id` | `roadmap:write` |
| DELETE | `/epics/:id` | `roadmap:write` |
| GET | `/milestones` | `read` |
| POST | `/milestones` | `roadmap:write` |
| PATCH | `/milestones/:id` | `roadmap:write` |
| DELETE | `/milestones/:id` | `roadmap:write` |
| GET | `/todos` | `read` |
| POST | `/todos` | `roadmap:write` |
| PATCH | `/todos/:id` | `roadmap:write` |
| POST | `/todos/:id/toggle` | `roadmap:write` |
| DELETE | `/todos/:id` | `roadmap:write` |
| POST | `/todos/:id/files` | `files:write` |

#### Client-portal tickets

| Method | Path | Scope |
|---|---|---|
| GET | `/tickets` | `read` |
| GET | `/tickets/:id` | `read` |
| PATCH | `/tickets/:id` | `tickets:write` |
| POST | `/tickets/:id/messages` | `tickets:write` |

#### Team, permissions & workspace

| Method | Path | Scope |
|---|---|---|
| GET | `/users` | `read` |
| POST | `/users` | `team:admin` |
| POST | `/users/:id/resend-invite` | `team:admin` |
| PATCH | `/users/:id` | `team:admin` — never: `password`, `email` |
| DELETE | `/users/:id` | `team:admin` |
| GET | `/rbac/permissions` | `read` |
| GET | `/rbac/groups` | `read` |
| GET | `/rbac/groups/:id/members` | `read` |
| GET | `/rbac/users/:id/groups` | `read` |
| GET | `/rbac/users/:id/overrides` | `read` |
| POST | `/rbac/groups` | `team:admin` |
| PATCH | `/rbac/groups/:id` | `team:admin` |
| DELETE | `/rbac/groups/:id` | `team:admin` |
| PUT | `/rbac/groups/:id/permissions` | `team:admin` |
| POST | `/rbac/groups/:id/users` | `team:admin` |
| DELETE | `/rbac/groups/:id/users/:userId` | `team:admin` |
| PUT | `/rbac/users/:id/groups` | `team:admin` |
| PUT | `/rbac/users/:id/overrides` | `team:admin` |
| GET | `/settings` | `read` |
| PATCH | `/settings` | `team:admin` — never: `passwordLoginEnabled`, `googleLoginEnabled`, `allowedEmailDomains`, `systemSenderUserId` |
| POST | `/onboarding/sample-data` | `team:admin` |
| DELETE | `/onboarding/sample-data` | `team:admin` |
| GET | `/activity` | `read` |

#### Payroll & invoicing

| Method | Path | Scope |
|---|---|---|
| GET | `/pay-periods` | `read` |
| POST | `/pay-periods/generate` | `finance:write` |
| PATCH | `/pay-periods/:id` | `finance:write` |
| POST | `/pay-periods/:id/review` | `finance:write` |
| POST | `/pay-periods/:id/close` | `finance:write` |
| POST | `/pay-periods/:id/reopen` | `finance:write` |
| POST | `/pay-periods/recalculate` | `finance:write` |
| POST | `/pay-periods/:id/send-bookkeeper` | `finance:write` |
| GET | `/pay-config` | `read` |
| PATCH | `/pay-config` | `finance:write` |
| GET | `/invoicing/entries` | `read` |
| POST | `/invoicing/mark` | `finance:write` |
| POST | `/invoicing/unmark` | `finance:write` |
| POST | `/invoicing/quickbooks/invoice` | `finance:write` |

#### Integrations (data only)

| Method | Path | Scope |
|---|---|---|
| GET | `/integrations` | `read` |
| GET | `/integrations/drive/status` | `read` |
| GET | `/integrations/drive/list` | `read` |
| GET | `/integrations/drive/file/:id/download` | `read` |
| GET | `/integrations/drive/file/:id/content` | `read` |
| POST | `/integrations/drive/folders` | `files:write` |
| POST | `/integrations/drive/upload` | `files:write` |
| PATCH | `/integrations/drive/file/:id` | `files:write` |
| DELETE | `/integrations/drive/file/:id` | `files:write` |
| POST | `/integrations/drive/reconcile` | `files:write` |
| GET | `/integrations/quickbooks/status` | `read` |
| GET | `/integrations/quickbooks/customers` | `read` |
| GET | `/integrations/quickbooks/items` | `read` |
| GET | `/integrations/gmail/status` | `read` |
| GET | `/integrations/gmail/connected-users` | `read` |

#### Upload-QR sessions

| Method | Path | Scope |
|---|---|---|
| GET | `/upload/qr/sessions` | `read` |
| GET | `/upload/qr/sessions/:id/files` | `read` |
| POST | `/upload/qr/sessions` | `files:write` |
| POST | `/upload/qr/sessions/:id/revoke` | `files:write` |

#### Tools: QR codes, forms, websites

| Method | Path | Scope |
|---|---|---|
| GET | `/qr` | `read` |
| GET | `/qr/:id/scans` | `read` |
| GET | `/qr/:id/scans.csv` | `read` |
| GET | `/qr/:id/image.png` | `read` |
| POST | `/qr` | `tools:write` |
| PATCH | `/qr/:id` | `tools:write` |
| DELETE | `/qr/:id` | `tools:write` |
| GET | `/forms` | `read` |
| GET | `/forms/:id/submissions` | `read` |
| GET | `/forms/:id/submissions.csv` | `read` |
| GET | `/forms/:id/embed-snippet` | `read` |
| POST | `/forms` | `tools:write` |
| PATCH | `/forms/:id` | `tools:write` |
| DELETE | `/forms/:id` | `tools:write` |
| GET | `/websites` | `read` |
| POST | `/websites` | `tools:write` |
| PATCH | `/websites/:id` | `tools:write` |
| DELETE | `/websites/:id` | `tools:write` |
| GET | `/websites/:id/credentials` | `secrets:read` |

## 4. Session-only (never available to tokens)

These need you signed in to the web app, even with `full`:

| Method | Path | Why |
|---|---|---|
| GET | `/auth/csrf` | Sign-in / account security — needs a real browser session. |
| GET | `/auth/posthog-identity` | Sign-in / account security — needs a real browser session. |
| POST | `/auth/login` | Sign-in / account security — needs a real browser session. |
| POST | `/auth/logout` | Sign-in / account security — needs a real browser session. |
| POST | `/auth/switch-workspace` | Sign-in / account security — needs a real browser session. |
| POST | `/auth/forgot-password` | Sign-in / account security — needs a real browser session. |
| POST | `/auth/reset-password` | Sign-in / account security — needs a real browser session. |
| POST | `/auth/accept-invite` | Sign-in / account security — needs a real browser session. |
| GET | `/auth/google` | Sign-in / account security — needs a real browser session. |
| GET | `/auth/google/callback` | Sign-in / account security — needs a real browser session. |
| GET | `/auth/handoff` | Sign-in / account security — needs a real browser session. |
| GET | `/auth/2fa/challenge` | Sign-in / account security — needs a real browser session. |
| POST | `/auth/2fa/totp` | Sign-in / account security — needs a real browser session. |
| GET | `/auth/2fa/webauthn/options` | Sign-in / account security — needs a real browser session. |
| POST | `/auth/2fa/webauthn/verify` | Sign-in / account security — needs a real browser session. |
| GET | `/auth/2fa/status` | Sign-in / account security — needs a real browser session. |
| POST | `/auth/2fa/totp/setup` | Sign-in / account security — needs a real browser session. |
| POST | `/auth/2fa/totp/enable` | Sign-in / account security — needs a real browser session. |
| DELETE | `/auth/2fa/totp` | Sign-in / account security — needs a real browser session. |
| POST | `/auth/2fa/recovery/regenerate` | Sign-in / account security — needs a real browser session. |
| GET | `/auth/2fa/webauthn/register/options` | Sign-in / account security — needs a real browser session. |
| POST | `/auth/2fa/webauthn/register/verify` | Sign-in / account security — needs a real browser session. |
| PATCH | `/auth/2fa/webauthn/:id` | Sign-in / account security — needs a real browser session. |
| DELETE | `/auth/2fa/webauthn/:id` | Sign-in / account security — needs a real browser session. |
| GET | `/api-tokens` | Token management — a token can never mint, list or revoke tokens. |
| POST | `/api-tokens` | Token management — a token can never mint, list or revoke tokens. |
| DELETE | `/api-tokens/:id` | Token management — a token can never mint, list or revoke tokens. |
| POST | `/billing/manage-link` | Subscription billing — session only. |
| POST | `/integrations/:kind/connect` | Connecting third-party accounts / credentials — browser OAuth flow, session only. |
| POST | `/integrations/:kind/disconnect` | Connecting third-party accounts / credentials — browser OAuth flow, session only. |
| PATCH | `/integrations/:kind` | Connecting third-party accounts / credentials — browser OAuth flow, session only. |
| GET | `/integrations/drive/connect` | Connecting third-party accounts / credentials — browser OAuth flow, session only. |
| GET | `/integrations/drive/callback` | Connecting third-party accounts / credentials — browser OAuth flow, session only. |
| POST | `/integrations/drive/disconnect` | Connecting third-party accounts / credentials — browser OAuth flow, session only. |
| GET | `/integrations/quickbooks/connect` | Connecting third-party accounts / credentials — browser OAuth flow, session only. |
| GET | `/integrations/quickbooks/callback` | Connecting third-party accounts / credentials — browser OAuth flow, session only. |
| POST | `/integrations/quickbooks/disconnect` | Connecting third-party accounts / credentials — browser OAuth flow, session only. |
| GET | `/integrations/gmail/connect` | Connecting third-party accounts / credentials — browser OAuth flow, session only. |
| GET | `/integrations/gmail/callback` | Connecting third-party accounts / credentials — browser OAuth flow, session only. |
| POST | `/integrations/gmail/disconnect` | Connecting third-party accounts / credentials — browser OAuth flow, session only. |

Also session-only **fields**: `password` and `email` on `PATCH /users/:id`,
and `passwordLoginEnabled`, `googleLoginEnabled`, `allowedEmailDomains`,
`systemSenderUserId` on `PATCH /settings` (`403 session_only_field`).

Public/other-credential surfaces (`/portal/*` client-portal contacts, `/f/*`
public forms, `/q/*` QR scans, `/upload/qr/:token` capability links,
`/provisioning/*` HMAC) don't use tokens at all.

## 5. Errors, limits and audit

Every refusal is JSON with an `error` code; scope/route refusals also include a
human-readable `message`.

| Status | `error` | Meaning |
|---|---|---|
| 400 | `validation_failed` | Body didn't match. `issues` has the details |
| 401 | `invalid_token` | Unknown, revoked, or expired token, or the user was deactivated/removed |
| 403 | `insufficient_scope` | Endpoint allowed, but the token lacks `scope` (named in the response) |
| 403 | `token_route_not_allowed` | Endpoint isn't available to tokens (session-only or unknown) |
| 403 | `session_only_field` | Body contains a field only a browser session may change (`fields`) |
| 403 | `forbidden` | Your role lacks the permission (`missing` / `anyOf` list it) |
| 404 | `client_not_found` / `block_not_found` / … | No such record in this workspace |
| 409 | `stale_update` | Someone wrote first; re-read and retry |
| 413 | `space_notes_full` | Space already at 2,000 blocks |
| 429 | `rate_limited` | 120 requests/min per token; 20 failed auths/10 min per IP |

```json
{ "error": "insufficient_scope", "scope": "projects:write",
  "message": "This token is missing the \"projects:write\" scope. Create a token with that scope (or \"full\")." }
```

**Audit trail.** Activity-feed entries created through a token are tagged
`meta.via = "api_token"` with `tokenId`/`tokenName`, and the dashboard shows
"via API token “name”". Every state-changing token request is also logged
server-side (`audit: "api_token_write"`: token id/name, user, workspace,
method, path, status — never the token or body). Each token's *last used*
time is shown on the Security page.

## 6. Things to know

- **Open browser tabs and bots can both write.** The web editor sends the
  version it last synced (`x-expected-updated-at`) with every Notes save. If
  a bot appended in between, the save gets `409 stale_update`. The editor then
  fetches `GET …/blocks`, merges, and retries, so the bot's blocks survive.
  Editors that have the Space open also get a live `space:blocks-updated`
  Socket.IO notice after each append or save, and merge the new blocks in
  as they arrive.
  - **Merge rules:** the user's edits win on the same block, and blocks the
    user deleted stay deleted.
  - **Placement:** appended blocks keep their server position, or go at the
    end.
  - **Bots that rewrite blocks:** prefer append, or the per-block
    `PATCH`/`DELETE …/blocks/{blockId}` (they touch only that block and retry
    internally on races). If a bot must rewrite the whole list (reorder), send
    `x-expected-updated-at` with the `updatedAt` it read, and on a 409 re-read
    and retry.
- Tokens are stored hashed (SHA-256). Lost tokens can't be recovered. Revoke them and create a new one.
- Each user can have up to 20 active tokens.
