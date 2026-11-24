# Embedded forms: notifications and captcha

Forms live under **Tools → Form Builder** (and on a client's or project's Forms tab).
The page opens on the list of forms. **Add form** opens the builder for a new form,
and clicking a form opens it for editing. From there you can also open its
submissions and its embed snippet.

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
  and `HCAPTCHA_SITE_KEY` / `HCAPTCHA_SECRET`, set as env vars.
- **Cloudflare Turnstile** can be set **per form** or server-wide:
  - **Per form:** paste the widget's site key and secret key into the form's Security card.
    The secret is encrypted with the credentials-vault keyset (`CREDENTIALS_KEYS`, see
    [CREDENTIALS.md](./CREDENTIALS.md)) and is never sent back to the browser. Saving a
    per-form secret fails with `credentials_not_configured` until that keyset is valid.
  - **Server default:** set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` on the API. Forms
    without their own keys use these.
  - The server verifies each token at
    `https://challenges.cloudflare.com/turnstile/v0/siteverify`.

### Setting up a Turnstile widget

1. In the Cloudflare dashboard, open **Turnstile → Add widget**. "Managed" mode is fine.
2. Under **Hostnames**, add **every website domain the form is embedded on**, for example
   `clientsite.com` and `www.clientsite.com`.
   - The embed snippet (`<script src=".../api/f/embed.js">`) draws the form, and the
     Turnstile widget, **directly in the host page**, not in an iframe on app.hoppa.io.
   - Turnstile checks the host page's hostname, so a domain missing from the list makes
     every challenge fail.
   - Adding app.hoppa.io alone is **not** enough.
3. Copy the **site key** and **secret key** into the form's Security card. To use them as
   the default for all forms instead, set them as `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET`
   on the API.
4. Usually one widget per client site works best. A single widget can list several
   hostnames, but Cloudflare limits how many you can add.

Cloudflare's test keys work locally: site key `1x00000000000000000000AA` with secret
`1x0000000000000000000000000000000AA` always passes, and secret
`2x0000000000000000000000000000000AA` always fails.
