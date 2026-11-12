# Project & client credentials vault

Store server root passwords, SSH / database / hosting / registrar logins (and
optionally a third-party 2FA seed) on a **client** or a **project**. The
client's **Credentials** tab rolls up the client's own credentials plus every
credential on its projects, grouped by project.

## Who can see what

| | View list | Reveal | Add / edit / delete | Edit who-can-see + read access log |
|---|---|---|---|---|
| **Owner** (workspace-wide `credentials.view/reveal/manage`) | every client | every client | every client | yes |
| On a client's allowlist — "Can view & reveal" | that client + its projects | same | – | – |
| On a client's allowlist — "Can view, reveal & edit" | same | same | same | – |
| **Admin, Member, Bookkeeper** (not allowlisted) | nothing — the tab is hidden | – | – | – |

- The three `credentials.*` permissions are **Owner-only by default** and are
  not in the Admin starter group.
- Only someone with `groups.manage` (Owner) can hand out Owner-only powers:
  an Admin with `users.manage` can no longer add people to (or remove them
  from) a group that holds `credentials.*` / `groups.manage`, or grant those as
  per-user overrides (`403 owner_only_permission_change`). This closes the
  "Admin promotes themselves to Owner" path for this feature.
- Project credentials follow their client's allowlist. The allowlist is the
  groundwork for per-client restriction (CLIENT_PORTAL_PLAN Phase 4).
- **Bot tokens:** only with the explicitly-picked `credentials:read` /
  `credentials:write` scopes — **never implied by Full access** — and still
  capped by the token owner's live role and the client allowlist. The
  allowlist and access log are session-only.

## How values are protected

- **Encryption:** AES-256-GCM per field (`secret`, `notes`, `totp`), fresh
  96-bit IV each time. Format `v2.<kid>.<iv>.<ciphertext>.<tag>`.
- **Keys:** `CREDENTIALS_KEYS` (JSON keyset `{"<kid>":"<32+ random bytes, hex or base64>"}`)
  and `CREDENTIALS_ACTIVE_KID`. The AES key per kid is derived with
  HKDF-SHA256. This is a separate key from `WEBSITES_CREDENTIALS_SECRET`.
- **AAD binding:** each ciphertext is bound to `kid | tenant | row id | field`,
  so copying an encrypted value onto another row, field or workspace fails to
  decrypt instead of revealing it there.
- **Never in:** list responses (metadata + `hasSecret` booleans only),
  bootstrap, the activity feed, Socket.IO events, or logs. The JSON
  replacer + socket redaction also strip `secretEnc` / `notesEnc` / `totpEnc`
  as a backstop.
- **Reveal:** `POST /api/credentials/:id/reveal`, one credential per call,
  `Cache-Control: no-store`, 20 reveals / 10 min per user (fails closed if
  Redis is down). The UI masks by default, shows a revealed value for 30 s,
  copies with a 30 s clipboard clear, and keeps nothing in the react-query
  cache. A stored TOTP seed never leaves the server; reveal returns only the
  current code.
- **Audit:** `credential_access_log` (separate from the activity feed, Owner
  only) records every reveal, create, update, delete and allowlist change —
  including denied, not-found, rate-limited, not-configured and
  decrypt-failed attempts — with user, token, IP and user agent.
- **Fail closed:** with no/invalid keyset the tab shows "Credentials aren't
  configured" and every save/reveal returns `503 credentials_not_configured`.
  Deleting a credential also erases its ciphertext.

## Threat model (be honest)

Server-side encryption protects against a leaked **database or backup** on
its own. It does **not** protect against someone who can run code as the API
or read its environment:

- Anyone with **write access to the repo** can merge code to `main`, which
  auto-deploys and could log or exfiltrate values on the next reveal, or read
  `CREDENTIALS_KEYS` from the environment.
- Anyone with **DigitalOcean access to the app's env vars plus the database**
  can decrypt everything offline.

Mitigations, in order of value:

1. Remove write/maintain access for anyone who shouldn't hold this power, and
   protect `main` (required PR review, no direct pushes, restrict who can
   merge).
2. Keep the DigitalOcean team small; the key lives only on the API component
   as an encrypted env var.
3. Rotate keys (below) after anyone with that access leaves.
4. Optional, not built: per-user / passphrase client-side encryption for the
   most sensitive items (bots couldn't read them; losing the passphrase loses
   the data).

## Setup

1. Generate a key (on your own machine): `openssl rand -base64 32`
2. DigitalOcean → Apps → the portal app → **Settings** → the **API / web
   service component** → **Environment Variables** → add, both with
   **Encrypt** ticked:
   - `CREDENTIALS_KEYS` = `{"k1":"<paste the key>"}`
   - `CREDENTIALS_ACTIVE_KID` = `k1`
3. Save (this redeploys). Back up the key somewhere safe (a password manager):
   **if it is lost, stored credentials can't be recovered.**

## Rotating the key

1. Generate a new key, set `CREDENTIALS_KEYS` = `{"k1":"<old>","k2":"<new>"}`
   and `CREDENTIALS_ACTIVE_KID` = `k2`; deploy. New writes use `k2`.
2. In the API component's **Console**: `pnpm --filter @allebrum/api credentials:rotate`
   (dry run, counts only), then the same with `--apply`.
3. When it reports nothing left on `k1`, remove `k1` from the keyset and deploy.
