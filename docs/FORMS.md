# Embedded forms

Forms live under **Tools → Form Builder** (and on a client's or project's Forms tab).
The page opens on the list of forms. **Add form** opens the builder for a new form,
and clicking a form opens it for editing. From there you can also open its
submissions and its embed snippet.

## Field types and Field IDs

The builder's **Field settings** panel edits the selected field. Each field has two
identifiers:

- **Field ID** (`field.id`) is the public submission key. Answers in the database, CSV
  exports, and show-if / required-if rules use this id. It must be unique on the form,
  start with a letter, and use only letters, numbers, underscores, or hyphens. Invalid
  ids show an error as you type; they don't block typing, and changing the id does not
  deselect the field.
- A hidden, stable **key** is used only in the editor (React list keys and the
  current selection). Existing forms that don't have a key yet get one when you open
  them. Changing a Field ID remaps any conditions that pointed at the old id, so
  show-if / required-if rules keep working. Already-stored submissions stay keyed by
  whatever id they were submitted with.

### Types

| Type | Input | Validation and settings |
|---|---|---|
| Text / long text | `text` / textarea | Optional min/max length. |
| Email | `email`, `inputmode=email`, `autocomplete=email` | Checked on the embed and again on the server. |
| Phone | `tel`, `inputmode=tel`, `autocomplete=tel` | Format: **US** (default, formatted as the visitor types, stored as `(555) 123-4567`), **international** (8–15 digits), or **E.164** (stored like `+14155552671`). A leading US `1` is accepted. |
| URL | `url`, `inputmode=url` | Must be `http://` or `https://`. |
| Date | `date` | Optional earliest / latest dates (`YYYY-MM-DD`). |
| Number | `number`, `inputmode=decimal` | Optional min, max, and step (values must land on the step from min, or from 0 if min isn't set). |
| Dropdown / multiple choice / checkboxes | select / radio / checkbox | Options as before. |

**Presets** (Full name, Email, Phone, Address) add one or more preconfigured fields
with sensible ids, autocomplete, and placeholders. If an id is already used, a suffix
is added (`phone_2`, …).

The embed script (`/api/f/embed.js`) renders the matching `type` / `inputmode` /
`autocomplete` attributes, formats US phone numbers as the visitor types, and shows
friendly client-side errors before the request is sent. The API still validates and
normalizes every accepted submission.


## New-submission notifications

Each form has a **Notifications** card:

| Mode | What happens |
|---|---|
| Email right away (default) | One email per accepted submission. Reply-To is set to the submitter's email answer when the form has an email field. |
| Daily digest | One summary email per form each morning, at the first 15-minute tick after 8:00 in the workspace timezone (Admin → Pay settings timezone, default America/New_York). Only sent when there were new submissions. |
| Don't email | No email. The submission still shows in the activity feed. |

**Recipients:** pick teammates and/or type extra email addresses. If you pick no one,
the form owner gets the emails (or the workspace owner, if the form owner has left).

Every accepted submission also adds a "New submission on …" entry to the workspace activity feed.

Spam that trips the honeypot field, and submissions that fail the captcha, are
rejected before they're stored, so they never trigger an email.

**Sender:** the emails go out through the workspace **system sender**, the same Gmail
account used for password resets and portal invites (**Admin → Integrations → Gmail →
System sender**). If no system sender is set, or it hasn't connected Gmail, nothing is
sent: the API logs `[mail] no sender configured …` and the form's Notifications card
shows a warning.

**Multiple containers:** the digest window is claimed with a compare-and-set on
`forms.last_digest_at`, so running several API instances can't send a digest twice.

## Captcha: Cloudflare Turnstile, reCAPTCHA, hCaptcha

Turn on **Require captcha on submit** in a form's Security card, then choose a provider.

- **reCAPTCHA / hCaptcha** use the server-wide keys `RECAPTCHA_SITE_KEY` / `RECAPTCHA_SECRET`
  and `HCAPTCHA_SITE_KEY` / `HCAPTCHA_SECRET`, set as env vars on the API.
- **Cloudflare Turnstile** is **per workspace**, not a platform-wide env var. Hoppa is
  multi-tenant: each company brings its own widget and enters the keys once under
  **Admin → Integrations → Cloudflare Turnstile**. Every form in that workspace then
  uses those keys.
  - A form may optionally override with its own widget (under "Use a different widget
    for this form") if that form is embedded on sites that shouldn't share the
    workspace widget.
  - Secrets are encrypted with the credentials-vault keyset (`CREDENTIALS_KEYS`, see
    [CREDENTIALS.md](./CREDENTIALS.md)) and are never sent back to the browser. Saving
    a secret fails with `credentials_not_configured` until that keyset is valid.
  - If Turnstile isn't connected, the form builder links to the integration and
    refuses to save a form with Turnstile selected (unless a per-form widget is filled in).
  - The server verifies each token at
    `https://challenges.cloudflare.com/turnstile/v0/siteverify`.

### Setting up Turnstile for a company

1. In the Cloudflare dashboard, open **Turnstile → Add widget**. "Managed" mode is fine.
2. Under **Hostnames**, add **every website domain forms will be embedded on**, for
   example `clientsite.com` and `othersite.com`.
   - The embed snippet (`<script src=".../api/f/embed.js">`) draws the form, and the
     Turnstile widget, **directly in the host page**, not in an iframe on app.hoppa.io.
   - Turnstile checks the host page's hostname, so a domain missing from the list makes
     every challenge fail.
   - Adding app.hoppa.io alone is **not** enough. A root domain also covers its subdomains
     (`example.com` covers `www.example.com`).
   - Free widgets allow **10 hostnames**; Enterprise allows **200**.
3. In Hoppa, go to **Admin → Integrations → Cloudflare Turnstile**. Paste the **site key**
   and **secret key**, add the same domain list under **Allowed domains**, and click
   **Save**. Click **Test** to check the secret (Hoppa asks Cloudflare's siteverify
   whether the secret is real — it doesn't need a live challenge).
4. Optionally, instead of creating the widget by hand: create a Cloudflare API token
   with **Account → Turnstile → Edit**, paste the token and the account ID into the
   integration, fill in Allowed domains, and click **Create widget**. Hoppa will
   store the returned keys and can later **Sync hostnames** (or **Add domains from
   forms**, which also pulls `allowedOrigins` from your forms). Cloudflare has no
   third-party OAuth for Turnstile; the token is the login.
5. In a form, turn on **Require captcha → Cloudflare Turnstile**. That's it — there's
   no need to paste keys on every form.

Cloudflare's test keys work locally: site key `1x00000000000000000000AA` with secret
`1x0000000000000000000000000000000AA` always passes, and secret
`2x0000000000000000000000000000000AA` always fails.

## After a successful submit

The embed (`/api/f/embed.js`) hides the form (fields, captcha, and submit button)
and shows a confirmation panel inside the same card: a check icon, the form's
**Success message**, and — when allowed — a **Submit another response** link.
Host sites can style this with stable classes: `hoppa-form-card`, `hoppa-form`,
`hoppa-form-success`, `hoppa-form-success-icon`, `hoppa-form-success-message`,
and `hoppa-form-reset`. The panel uses `role="status"` and moves focus to itself
so screen readers announce it. Turnstile is not reset until the visitor clicks
the link to submit again, so the widget doesn't immediately run another challenge.

**Redirect after submit:** an optional `http://` or `https://` URL on the form.
When set, a successful submit navigates the top window to that page instead of
showing the panel. `javascript:` and other schemes are rejected.

### Allow more submissions

This switch is **on** by default.

| Setting | What happens |
|---|---|
| On | The confirmation panel includes the reset link (label is editable). Visitors can submit again, subject to the rate limits below. |
| Off | No reset link. The server allows **one accepted submission per visitor** per a configurable window (default **24 hours**). A repeat gets a friendly “You've already submitted this form” confirmation (nothing new is stored). The embed also remembers this in `localStorage`, so a reload of the host page still shows the confirmation instead of an empty form. |

“Visitor” is keyed by hashed IP and by the embed's session id, not by a stored
raw address in Redis.

## Rate limiting and spam

Turnstile (and reCAPTCHA / hCaptcha) **do not throttle volume**. They verify that
a challenge was completed and typically accept a token only once. A determined
person — or a flood of distinct tokens — can still submit many times unless the
API caps it.

Hoppa already rejects honeypot fills and failed captchas before storing or
emailing anything. Public form endpoints also have a coarse Redis limit of
**120 submit requests per minute per IP** (and similar caps on render and event
tracking). `trust proxy` is set so `req.ip` is the client behind DigitalOcean's
proxy.

On top of that, every **accepted** submission is checked against Redis-backed
per-form limits (IP and session id are hashed; keys expire with the window):

| Limit | Default | Adjustable? |
|---|---|---|
| Burst per visitor per form | 5 per 10 minutes | No (server default) |
| Per visitor per form per hour | 10 | Yes, 1–100, in the form's Security → Rate limiting card |
| All visitors on one form per hour | 200 | Yes, 10–10,000 |
| Identical answers from the same visitor | ignored for 10 minutes (returns the success message, does not store a second row) | No |
| One-per-visitor window | 24 hours | Only when **Allow more submissions** is off (1–8,760 hours) |

Over-limit requests return **429** with `{ ok: false, errors: { __form: "Too many submissions. Please try again later." } }`, which the embed shows on the form. If Redis is down, these tighter counters fail open (the coarse per-IP request limit still applies).
