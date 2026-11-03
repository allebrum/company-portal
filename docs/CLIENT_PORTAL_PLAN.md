# Client Portal — phased plan

Status: Phase 1 implemented in the PR that adds this doc. Phases 2–4 are proposals.

## Why this exists

A client asked how they can keep up with their project (sharing files, links and ideas). When we tested the
portal, the magic link showed "Sign-in link expired". The root causes:

1. **The portal wasn't published.** `POST /portal/exchange` returned `invalid_token` for every failure:
   unknown, used, expired, unpublished, or slug mismatch. The access page showed "expired" for all of them.
2. **The token was consumed before the checks ran.** A failed attempt (for example, an unpublished portal)
   used up the link, so it was dead even after the portal was published.
3. **The token was exchanged automatically on page load.** Email link scanners and previews that run JS
   could use up the single-use link before the client clicked it.
4. **No warning about undelivered email.** Invites go through the system sender's Gmail and are silently
   logged and dropped when it isn't connected. Staff had no indication.

Today a client can see: overview, projects (list and detail), goals and milestones (and sign off on
milestones), client-level files that staff marked shared, and tickets (create and reply). A client can't:
see project notes, upload files, share links, get notifications, or see anything grouped by project.

---

## Phase 1 — Portal access fixes (done in this PR) · ~1 day

**API**
- `POST /portal/exchange` checks token state, contact, client slug match and publish status **before**
  consuming the token. Logic lives in `services/portalExchange.ts` (pure, unit-tested); the DB lookup is
  `inspectToken()` in `auth/tokens.ts`. Distinct error codes:
  - `invalid_token`: unknown, wrong kind, or slug/contact mismatch. A mismatch always wins over
    used/expired, so another client's slug reveals nothing.
  - `token_used`: already used, or replaced by a newer link (resend invalidates older ones).
  - `token_expired`: past the 30-day TTL.
  - `portal_unpublished`: the token is not consumed and works once the portal is published.
  - None of these codes depend on an email address, so there's no contact enumeration.
    `/portal/request-access` still always returns `{ok:true}`.
- `GET /clients/portal/sender-status` (`portal.manage`, rate-limited, token scope `read`) reports whether
  the invite sender has Gmail configured and connected.

**Web**
- `/portal/access` no longer exchanges on load. It shows a **Continue** button (the POST happens on click),
  per-error copy, and an inline **"Email me a new link"** form that uses the existing rate-limited
  `/portal/request-access` (6/min/IP) and always shows a generic success message.
- Staff Portal tab:
  - **Copy portal link** button (`/portal/login?slug=…`; it never contains a token).
  - Amber "not published" banner.
  - Confirm dialogs when inviting or resending on an unpublished portal, or when the sender's Gmail isn't
    connected.
  - Red banner when invites won't be delivered.

**Skipped:** a reuse grace window (for example, the same browser can re-exchange for 10 minutes). It isn't
needed now that exchange needs a click, and it would require a second credential bound to the browser. We
can revisit if clients report double-click issues.

---

## Phase 2 — Collaboration · ~5–7 days

### Data model
Project notes today are `projects.space_blocks` (jsonb canvas blocks). Files are `projects.space_files` and
`clients.space_files` (jsonb, with a `shared` flag since migration 0029).

- Notes visibility: add `visibility: 'internal' | 'client'` to each block (default `internal`; no backfill
  exposure). Alternative: a new table if per-note querying is needed.
- New table `portal_items` for the per-project "Updates" feed:
  `id, tenant_id, client_id, project_id, kind ('note'|'file'|'link'), title, body, url, file_key, size,
  mime, scan_status ('pending'|'clean'|'infected'|'error'), author_type ('staff'|'contact'|'email'),
  author_id, visibility, source ('web'|'email'), created_at, deleted_at`.
- `client_contacts.notify` (`'immediate'|'daily'|'off'`), plus `project_contacts` if a contact should see
  only some projects (today they see all of a client's projects).

### Endpoints
- Portal (contact session, rate-limited):
  - `GET /portal/projects/:id/updates`
  - `POST /portal/projects/:id/notes`
  - `POST /portal/projects/:id/links`
  - `POST /portal/projects/:id/uploads` (signed upload URL) and `.../uploads/:id/complete`
- Staff:
  - `GET/POST/PATCH/DELETE /projects/:id/portal-items`
  - Toggle note visibility through the existing project-blocks save path.

### UI
- Portal: an "Updates" tab per project (feed and composer for note, link, file).
- Staff: a "Client can see" toggle on notes and files, the same feed inside the project space, and an
  "unread from client" badge.

### Limits and security
- Files go to DigitalOcean Spaces under a private key prefix per tenant/client/project, served only through
  short-lived signed URLs after the scan passes.
- 25 MB per file; MIME allow-list (pdf, images, office docs, txt/csv, zip). Executables, scripts and HTML
  are rejected.
- Malware scan: ClamAV sidecar (DO worker) or a hosted scanner. Files stay `pending` and invisible until
  `clean`.
- Links: http/https only, rendered with `rel="noopener noreferrer nofollow"`, no auto-fetch previews.
- Rate limits per contact and IP; per-client storage quota.
- Notifications: a staff email when a client posts; a client email or daily digest when staff publish
  something client-visible. Sent through the Phase 3 transactional sender, not per-user Gmail.

---

## Phase 3 — Email-in (Postmark Inbound) · ~6–8 days

### Addressing
- A per-project, unguessable address: `p-<10-char random>@in.hoppa.io` stored in `projects.inbound_key`
  (rotatable). Not derived from the project code, so it can't be guessed.
- `portal@in.hoppa.io` is the "send me my link" address.

### Pipeline
1. Postmark Inbound posts the parsed JSON to `POST /api/inbound/postmark`. Requests are authenticated with
   HTTP basic auth credentials in the webhook URL plus an IP allow-list. The route is rate-limited and has a
   body limit (~35 MB).
2. Store the raw event in `inbound_emails` (`id, tenant_id, project_id, from, to, subject, spf, dkim,
   dmarc, status, reason, raw_json_key, created_at`) for audit and idempotency (by Postmark `MessageID`).
3. **Sender verification:** the From address must match a portal contact of the project's client or a
   staff user of the tenant, **and** pass DMARC alignment (from Postmark's `Authentication-Results`
   header). Anything else goes to `held`.
4. **Held-for-review queue:** staff see held messages in the project and can approve (files them) or
   discard. Nothing from unverified senders is auto-filed.
5. Filing:
   - The body, with quoted replies and signatures stripped, becomes a `portal_items` note. It is
     client-visible if a contact sent it and internal if staff sent it.
   - Attachments become files through the Phase 2 upload and scan path (same limits; ≤10 attachments).
6. A short confirmation reply goes to verified senders only (it includes no content from the email).

### Optional AI step (tool-less)
- Used to summarize long threads, suggest a title and tags, and pick the project when the email arrives at
  a generic address.
- The email is treated as **untrusted data**: it's passed as quoted content and the model returns JSON
  only (`{title, summary, tags, project_guess, confidence}`). It has no tools, cannot send email, change
  visibility or approve anything, and its output is validated against a schema.
- Low confidence or any project guess goes to the held queue. This defeats prompt injection because the
  model's output can only label content, never act.
- Cost is well under $0.01 per email.

### `portal@in.hoppa.io` link requests
- If the sender is a known contact of a **published** portal and passes DMARC, reply with a fresh magic
  link through the existing `resendContactInvite`.
- Otherwise, send nothing (no bounce or "not found" reply), so the address can't be used to enumerate
  contacts.
- Limits: 3 per hour per address and 30 per hour per sending domain.
- A contact on several clients gets one email listing each portal.

### Outbound
- Move portal mail (invites, links, notifications, confirmations) from per-user Gmail to a Postmark
  transactional stream with SPF, DKIM and DMARC on `hoppa.io`. Keep Gmail as a fallback.

### Setup Senica must do
- **Postmark:** create an account and a server with an inbound stream and a transactional stream.
  Set the inbound webhook URL (with basic-auth credentials) to `https://app.hoppa.io/api/inbound/postmark`
  and turn on "include raw email".
- **DNS:**
  - MX on `in.hoppa.io` → `inbound.postmarkapp.com` (priority 10).
  - Postmark DKIM TXT and Return-Path CNAME for `hoppa.io`.
  - SPF includes `spf.mtasv.net`.
  - DMARC `_dmarc.hoppa.io` starting at `p=none`.
- **DigitalOcean env vars (secrets):** `POSTMARK_SERVER_TOKEN`, `POSTMARK_INBOUND_BASIC_USER`,
  `POSTMARK_INBOUND_BASIC_PASS`, `INBOUND_DOMAIN=in.hoppa.io`, `MAIL_FROM`.
- **Cost:** Postmark about $15/month for 10k emails (inbound included). AI is negligible. Spaces storage
  is $5/month for 250 GB.

---

## Phase 4 — Per-client staff permissions · ~4–6 days

- `client_staff_access(client_id, user_id, role)`. Admins currently see and manage every portal (for
  example, Sedale). Add an opt-in "restricted" mode where `portal.manage` and client data are scoped to
  assigned clients.
- Enforce it in client, project and portal-staff routes, and in token scopes.
- Audit log for portal access, link issuance and inbound filing.

---

## Effort summary

| Phase | Scope | Effort |
|---|---|---|
| 1 | Access fixes, Continue page, errors, staff warnings and copy link | ~1 day (done) |
| 2 | Note visibility, project Updates feed, uploads, links, scanning, notifications | 5–7 days |
| 3 | Postmark inbound, verification, held queue, AI classify, portal@ links, outbound | 6–8 days |
| 4 | Per-client staff permissions and audit | 4–6 days |

## Open questions

1. Should contacts see all of a client's projects or only the ones they're assigned to?
2. Should client-posted notes be visible to other contacts at the same client by default?
3. Retention for inbound raw emails and held messages (proposal: 90 days)?
4. Is ClamAV self-hosted acceptable, or should we use a hosted scanner?
5. Should staff emails sent to a project address be filed as internal or client-visible by default?
6. Keep Gmail as the invite sender after Postmark, or switch fully?
7. Is the AI step wanted in v1 of email-in, or added later?
