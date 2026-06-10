# UX Sprint Plan

Source: the 2026-06-10 full UX/UI audit (six parallel code deep-reads — shell/nav,
daily flows, spaces/media, admin/auth, client portal/reports, design system — plus
a live click-through of a fresh seeded workspace). Findings were deduped and
sequenced into four sprints, ordered so perceived quality improves first, then
activation, then manager/client value, then the new client-ticketing feature.

Conventions for every sprint: any new migration must be prod-safe on populated
data (additive / idempotent / backfilled); tenant-owned tables carry `tenant_id`
via `tenantRef()` and are scoped with `tenantEq()` / `stampTenant()`; UI work
reuses `components/ui/*` primitives (extending them where a ticket says so).

---

## Sprint 1 — Feel & feedback ("the app handles like it looks")

The single biggest gap from the audit: every error is a 3.5s toast, forms fail
silently, destructive actions use native `window.confirm`, and mutations wait on
the server. One sprint of feedback-layer work changes how the whole app feels.

- **S1.1 `<ConfirmDialog>` primitive + kill `window.confirm`.** New styled
  confirm in `components/ui/` (danger variant, async-pending state). Replace all
  native confirms (`EntryFormModal.tsx:131`, `ClientFormModal.tsx:243`,
  `ItemComposer.tsx` ×2, `tools/qr`). Add a confirm (or undo, per S1.3) to the
  todo-list inline delete (`todos/page.tsx:145`) which today deletes instantly.
- **S1.2 Inline form validation.** `Field` gets an `error` prop (red border,
  inline message, `aria-invalid` + `aria-describedby`); `Modal` gets an optional
  persistent error banner with retry (replacing toast-only failure). Apply to
  Client/Project/Entry/User modals; required-field indicators; explain disabled
  Save buttons (hint text, not silence).
- **S1.3 Optimistic updates + undo.** React Query `onMutate` flip-with-rollback
  for todo toggle/delete; deletes get a 5s "Undo" toast instead of a hard stop.
- **S1.4 BUG — timezone-safe time entries.** `EntryFormModal.tsx:18`
  `isoToLocalInput()` does naive hour math; verify round-trips across DST and fix
  (label the form with the local offset). Payroll-data correctness.
- **S1.5 BUG — onboarding checklist dead-ends + mobile.** Hide (or re-copy)
  Connect items when integration `configured:false` (self-host without Google
  OAuth currently gets a JSON-error dead-end); collapse the card to a pill on
  mobile (measured 27% of a phone viewport); add a "Resume setup" re-entry point
  so dismissal isn't permanent.
- **S1.6 BUG — Kanban drag affordance.** `KanbanView.tsx:69` cards are draggable
  but silently no-op unless grouped by status: either support the drag in other
  groupings or remove the affordance + explain.
- **S1.7 Quick-wins bundle (each < half a day).** Autofocus first field in all
  create modals; skeleton loaders replacing "Loading…"/"Loading workspace…" text;
  sidebar + mobile bar use `HoppaMark` instead of the letter logo; workspace
  switcher: styled control + "Switched to X" toast; "?" keyboard-shortcuts modal
  (shortcuts exist, invisible today); consistent eyebrow labels (Approvals page
  says "Time tracking"); approver column in the approvals entries table; QR
  upload-link countdown ("expires in …"); accept-invite + forgot/reset pages
  fetch workspace branding instead of hardcoded.
- **S1.8 Accessibility pass.** Modal focus trap + focus restore +
  `aria-labelledby`; ≥44px touch targets on icon buttons; body text floor at
  gray-600 (gray-400 fails WCAG AA); `prefers-reduced-motion` respected
  globally; placeholder-as-label fixes.
- **S1.9 Forgotten-timer guard.** Idle detection ("still working on X?") and a
  max-duration flag on running timers (`useTimer.ts`, `TimerBar.tsx`) — an
  always-running timer silently corrupts payroll data.

## Sprint 2 — First impressions & activation

What a brand-new workspace sees today: four `$0 / 0.0h` KPI cards and passive
empty states. Activation work + the billing cliff.

- **S2.1 Dashboard empty-state CTAs.** Every panel gets a next action ("Add
  your first client →", "Log your first hour →") instead of "All clear" /
  "No live goals".
- **S2.2 Onboarding checklist v2.** Add the core-loop steps: create first
  client, create first project, log first hour — auto-checked from data, same
  pattern as the integration items.
- **S2.3 Optional sample data.** One-click demo client + project + a few todos
  (and one-click removal) so the first session shows the product working.
- **S2.4 Billing pre-warning.** Trial-countdown banner and payment-failed
  banner surfaced in the shell BEFORE the 402 lockout (read `billing_status` /
  `trial_ends_at` via bootstrap); SubscriptionRequired screen gets dates +
  what-happens-next copy.
- **S2.5 Drive connect in context.** Space → Files tab shows an inline
  "Connect Google Drive" banner (reuse `IntegrationGate.openConnect`) instead of
  letting uploads dead-end (`ClientSpaceOverlay.tsx:203`).
- **S2.6 Notes autosave indicator.** "Saving… / Saved ✓" in the Notes header
  (`NotesTab.tsx`); surface last-write-wins explicitly.
- **S2.7 Timer ergonomics.** Pre-fill last-used project on start; "repeat
  yesterday" duplication on the time page.
- **S2.8 Workspace-level goals.** Allow goals without client/project
  (`ItemComposer.tsx:283` blocks; check server validation) — slots under a
  "Workspace" scope in Kanban.

## Sprint 3 — Manager & client value

The outward-facing surfaces: reports a manager can act on, a portal a client
respects.

- **S3.1 Portal status summaries.** Per-project one-liner on the portal
  overview ("On track · 40% complete · ends Dec 15") instead of raw counts.
- **S3.2 Client sign-off.** Portal contacts can approve a milestone/deliverable
  with an optional comment; staff see sign-offs in the space + activity feed.
- **S3.3 Reports visualized.** Utilization bar chart + project-burn line chart
  (lightweight SVG or recharts) above the existing tables.
- **S3.4 CSV export.** Payroll summary (approvals) + each report table get a
  "Download CSV" button.
- **S3.5 Report filters.** Project/person filter + custom date range alongside
  the 7/30/90d presets.
- **S3.6 Portal polish.** File-type icons + human dates on portal files;
  actionable empty-state copy; standardize the magic-link expiry wording.
- **S3.7 Approvals mobile.** Reject-reason form reflow (modal or sm: reflow) so
  the entries stay visible (`approvals/page.tsx:565`).

## Sprint 4 — Client ticketing (portal → team to-dos)

Clients create tickets in the portal; each ticket becomes a team to-do linked to
the client (and project when chosen). Closing the loop on the half-implemented
`'tickets'` nav stub in `PortalHeader.tsx:23`.

**Data model** (migration `00XX_tickets`, additive):
- `tickets`: `id` uuid PK · `tenant_id` via `tenantRef()` · `client_id` NOT NULL
  → clients (cascade) · `project_id` nullable → projects (set null) ·
  `contact_id` → `client_contacts` (set null; the portal author) · `title` ·
  `body` text · `status` enum `open | in_progress | waiting_on_client |
  resolved | closed` (default open) · `priority` (reuse `priorityEnum`, default
  medium) · `todo_id` nullable → todos (set null; the linked work item) ·
  `created_at / updated_at / resolved_at` · indexes on (tenant_id), (client_id,
  status), (todo_id).
- `ticket_messages` (the thread): `id` · `tenant_id` · `ticket_id` (cascade) ·
  `author_kind` enum `contact | staff` · `author_contact_id` / `author_user_id`
  (XOR, mirroring the auth_tokens subject pattern) · `body` · `created_at`.

**Ticket ⇄ to-do contract:**
- On portal creation the server auto-creates a linked todo: title `Ticket:
  <title>`, `clientId`/`projectId` from the ticket, `description` = body + a
  deep link to the ticket, tag `ticket`, unassigned (triage). `tickets.todo_id`
  points at it.
- Completing the todo resolves the ticket (hook in the todos status-update
  service, lookup by `todo_id`); resolving/closing the ticket from staff UI
  completes the todo. Reopening a resolved ticket (client replies) reopens the
  todo. One source of truth for "is this done": the ticket status; the todo
  follows.

**API:**
- Portal (contact session, scoped to `clientPortalSession.clientId`,
  rate-limited like the magic-link endpoints): `POST /portal/tickets`
  `{title, body, projectId?}` (projectId validated against the contact's
  visible projects) · `GET /portal/tickets` · `GET /portal/tickets/:id` (with
  messages) · `POST /portal/tickets/:id/messages`.
- Staff (session auth; gate on `todos.manage` for status changes — no new
  permission): `GET /tickets?clientId=&status=` · `PATCH /tickets/:id`
  (status/priority/project) · `POST /tickets/:id/messages` (author_kind staff).
- Socket events `EV.TICKET_CREATED / TICKET_UPDATED / TICKET_MESSAGE` →
  activity feed + React Query invalidation.

**Portal UI:** implement the Tickets nav tab — list (status pill, last-activity
time), "New ticket" form (title, description, optional project select), detail
view with the message thread and status. Empty state: "Need something from the
team? Open a ticket."

**Internal UI:** Tickets tab in `ClientSpaceOverlay` (per-client list + detail
with thread + status/priority controls); linked todos show a "From ticket"
badge in the todo list and `ItemComposer` links back to the ticket; new-ticket
activity appears in the dashboard feed.

**Stretch (in-sprint if time):** email the contact on staff reply / resolution
via the existing per-user Gmail integration when connected.

**Out of scope for the sprint:** attachments on tickets, SLAs/due dates,
client-visible internal notes, CSAT.

---

## Backlog (post-Sprint-4, roughly ordered)

Cmd+K command palette (global fuzzy search over clients/projects/people/actions —
generalize `QuickOpenSearch`) · notification center (bell + persistent feed over
the existing socket activity events) · week-grid time view with drag-to-adjust ·
missing primitives as needed (Combobox, DatePicker, Tooltip, Skeleton already
partially covered by S1) · responsive table strategy (cards on mobile) · clients
page sort/filter for large rosters · admin IA regroup (7 tabs → 4 groups) +
avatar settings menu · 2FA recovery-codes download/print + login recovery-code
entry · invoices/cost transparency in the portal · dark mode.
