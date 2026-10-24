# Bot API (personal access tokens)

Bots, scripts, and AI assistants can add notes to client/project Spaces and
track time **as you**, using a personal access token (PAT).

- A token acts as the user who created it, in the workspace it was created in.
  It can never do more than that user can do in the browser (same permissions).
- On top of that, a token can only reach the endpoints listed below, and only
  with the matching **scope**. Everything else returns `403`.
- Tokens can't create, list, or revoke tokens. That's browser-only.

## 1. Create a token

In the portal, go to **Security → API tokens**. Give the token a name (e.g.
"Grok bot"), pick scopes and an expiry, then click **Create token**. Copy the
`hpat_…` value. **It is shown once**; only a hash is stored. Revoke a token
from the same list at any time. Revoking takes effect immediately.

| Scope         | Grants                                                         |
|---------------|----------------------------------------------------------------|
| `read`        | List clients/projects, read Space notes, list your time/timer  |
| `notes:write` | Append blocks to a client or project Space's Notes             |
| `time:write`  | Start/stop your timer, log a manual entry, edit an entry       |

Removing a user from the workspace (or deactivating them) disables all of their tokens.

## 2. Authenticate

```
Authorization: Bearer hpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Base URL: your API origin plus `/api` (e.g. `https://api.example.com/api`; in
single-container self-host mode it's the portal URL plus `/api`). No cookies
or CSRF token are needed. If you send an `Authorization: Bearer` header, the
request is authenticated by token only; cookies are ignored.

```bash
export HOPPA=https://your-portal.example.com/api
export HOPPA_TOKEN=hpat_...
curl -s -H "Authorization: Bearer $HOPPA_TOKEN" $HOPPA/api-tokens/current
# {"userId":"…","tenantId":"…","via":"token","tokenId":"…","scopes":["read","notes:write"]}
```

## 3. Endpoints

| Method | Path                                      | Scope         |
|--------|-------------------------------------------|---------------|
| GET    | `/api-tokens/current`                     | any           |
| GET    | `/clients`                                | `read`        |
| GET    | `/projects`                               | `read`        |
| GET    | `/spaces/{client\|project}/{id}/blocks`   | `read`        |
| GET    | `/entries`                                | `read`        |
| GET    | `/entries/timer` · `/entries/timers`      | `read`        |
| POST   | `/spaces/{client\|project}/{id}/blocks`   | `notes:write` |
| POST   | `/entries`                                | `time:write`  |
| PATCH  | `/entries/{id}`                           | `time:write`  |
| POST   | `/entries/timer/start` · `/entries/timer/stop` | `time:write` |

`client`/`project` may also be written as `clients`/`projects`.

### Find a client or project

```bash
curl -s -H "Authorization: Bearer $HOPPA_TOKEN" $HOPPA/clients  | jq '.[] | {id, name}'
curl -s -H "Authorization: Bearer $HOPPA_TOKEN" $HOPPA/projects | jq '.[] | {id, name, clientId}'
```

### Read a Space's notes

```bash
curl -s -H "Authorization: Bearer $HOPPA_TOKEN" $HOPPA/spaces/client/$CLIENT_ID/blocks
# {"id":"…","name":"Family Relief Project","blocks":[…],"updatedAt":"2026-10-23 16:39:49.853-07"}
```

### Append notes (append-only)

New blocks always go to the **end** of the Notes. Existing blocks are never
modified or reordered. Ids are assigned by the server. Multi-line `content` on
line types (`text`, `h1`–`h3`, `bullet`, `numbered`, `checkbox`, `quote`,
`callout`) is split into one block per line, the way the editor stores it.

```bash
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
```

Block fields: `type` (default `text`; one of `text h1 h2 h3 bullet numbered
checkbox quote callout divider embed`), `content` (≤ 20,000 chars), `checked`
(checkbox), `embedUrl` + optional `embedKind` (`link|figma|github|drive`) for
`embed` (must be `http(s)://`). At most 200 blocks per request. A Space holds
at most 2,000 blocks (`413 space_notes_full`). Linked cards (to-dos, goals,
timers) can't be created through the bot API.

### Track time

```bash
# start (one timer per user; starting a new one stops and saves the running one)
curl -s -X POST $HOPPA/entries/timer/start -H "Authorization: Bearer $HOPPA_TOKEN" \
  -H 'Content-Type: application/json' -d '{"projectId":"'$PROJECT_ID'","note":"Researching resources"}'
# what's running?
curl -s -H "Authorization: Bearer $HOPPA_TOKEN" $HOPPA/entries/timer
# stop → creates the entry (404 no_active_timer if nothing is running)
curl -s -X POST $HOPPA/entries/timer/stop -H "Authorization: Bearer $HOPPA_TOKEN" \
  -H 'Content-Type: application/json' -d '{}'
# log a past block of time
curl -s -X POST $HOPPA/entries -H "Authorization: Bearer $HOPPA_TOKEN" -H 'Content-Type: application/json' \
  -d '{"projectId":"'$PROJECT_ID'","note":"Call with family","startIso":"2026-10-23T09:00:00-07:00","endIso":"2026-10-23T09:30:00-07:00"}'
# fix a note
curl -s -X PATCH $HOPPA/entries/$ENTRY_ID -H "Authorization: Bearer $HOPPA_TOKEN" \
  -H 'Content-Type: application/json' -d '{"note":"Call with family coordinator"}'
```

Deleting, submitting, and approving entries are deliberately **not** available to tokens.

## 4. Errors and limits

| Status | `error`                     | Meaning                                                    |
|--------|-----------------------------|------------------------------------------------------------|
| 400    | `validation_failed`         | Body didn't match. `issues` has the details                |
| 401    | `invalid_token`             | Unknown, revoked, or expired token, or the user was removed |
| 403    | `insufficient_scope`        | Endpoint allowed, but the token lacks `scope`              |
| 403    | `token_route_not_allowed`   | Endpoint isn't available to tokens                         |
| 403    | `forbidden`                 | The user lacks the permission (RBAC)                       |
| 404    | `client_not_found` / …      | No such record in this workspace                           |
| 413    | `space_notes_full`          | Space already at 2,000 blocks                              |
| 429    | `rate_limited`              | 120 requests/min per token; 20 failed auths/10 min per IP  |

## 5. Things to know

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
  - **Bots that rewrite blocks:** append is still the safe write. If a bot
    must rewrite blocks with `PATCH`, send `x-expected-updated-at` with the
    `updatedAt` it read, and on a 409 re-read and retry.
- Tokens are stored hashed (SHA-256). Lost tokens can't be recovered. Revoke them and create a new one.
- Each user can have up to 20 active tokens.
