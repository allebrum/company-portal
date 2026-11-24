import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FormDefinitionSchema, CreateFormSchema, UpdateFormSchema } from '@allebrum/shared';
import {
  digestDue,
  parsePgTimestamp,
  pickRecipients,
  resolveNotifications,
  submitterEmail,
  summarizeAnswers,
} from '../formNotifyRules.js';
import { captchaVerifyEndpoint, providerSiteKey } from '../formCaptcha.js';

const def = FormDefinitionSchema.parse({
  fields: [
    { id: 'name', label: 'Name', type: 'text' },
    { id: 'email', label: 'Email', type: 'email' },
    { id: 'topic', label: 'Topic', type: 'select', options: [{ label: 'Web design', value: 'web' }] },
    { id: 'tags', label: 'Tags', type: 'checkbox', options: [{ label: 'Urgent', value: 'u' }, { label: 'New', value: 'n' }] },
    { id: 'ok', label: 'Agree', type: 'checkbox' },
  ],
});

const OWNER = '00000000-0000-4000-8000-000000000001';
const A = '00000000-0000-4000-8000-00000000000a';
const GONE = '00000000-0000-4000-8000-0000000000ff';
const members = [
  { id: OWNER, email: 'owner@x.com' },
  { id: A, email: 'a@x.com' },
];

test('notifications default to immediate → form owner when unset or invalid', () => {
  assert.deepEqual(resolveNotifications(null), { mode: 'immediate', userIds: [], emails: [] });
  assert.deepEqual(resolveNotifications({ mode: 'bogus' }), { mode: 'immediate', userIds: [], emails: [] });
  assert.equal(resolveNotifications({ mode: 'digest' }).mode, 'digest');
  assert.equal(resolveNotifications({ mode: 'off' }).mode, 'off');
});

test('recipients: empty selection falls back to the form owner', () => {
  const to = pickRecipients({ cfg: resolveNotifications(null), ownerUserId: OWNER, members, workspaceOwnerIds: [] });
  assert.deepEqual(to, ['owner@x.com']);
});

test('recipients: owner gone → workspace owners', () => {
  const to = pickRecipients({ cfg: resolveNotifications(null), ownerUserId: GONE, members, workspaceOwnerIds: [A] });
  assert.deepEqual(to, ['a@x.com']);
});

test('recipients: picked users + extra emails, inactive users dropped, de-duped', () => {
  const cfg = resolveNotifications({ mode: 'immediate', userIds: [A, GONE], emails: ['A@x.com', 'lead@client.com'] });
  const to = pickRecipients({ cfg, ownerUserId: OWNER, members, workspaceOwnerIds: [] });
  assert.deepEqual(to, ['a@x.com', 'lead@client.com']);
});

test('summarizeAnswers maps option values to labels in field order', () => {
  const lines = summarizeAnswers(def, { tags: ['u', 'n'], name: 'Ana', topic: 'web', ok: true, email: 'ana@site.com' });
  assert.deepEqual(lines, [
    { label: 'Name', value: 'Ana' },
    { label: 'Email', value: 'ana@site.com' },
    { label: 'Topic', value: 'Web design' },
    { label: 'Tags', value: 'Urgent, New' },
    { label: 'Agree', value: 'Yes' },
  ]);
});

test('submitterEmail only returns a clean address (no header injection)', () => {
  assert.equal(submitterEmail(def, { email: 'ana@site.com' }), 'ana@site.com');
  assert.equal(submitterEmail(def, { email: 'ana@site.com\r\nBcc: x@y.com' }), null);
  assert.equal(submitterEmail(def, { email: 'nope' }), null);
});

test('digest: due once per local day at/after 8am in the workspace timezone', () => {
  const tz = 'America/Los_Angeles';
  // 15:00Z = 07:00 PST → not yet.
  assert.equal(digestDue(new Date('2026-11-24T15:00:00Z'), tz, null), false);
  // 16:30Z = 08:30 PST → due when never sent.
  assert.equal(digestDue(new Date('2026-11-24T16:30:00Z'), tz, null), true);
  // Already sent today (local) → not due.
  assert.equal(digestDue(new Date('2026-11-24T20:00:00Z'), tz, '2026-11-24 16:31:00.123+00'), false);
  // Sent yesterday (local) → due.
  assert.equal(digestDue(new Date('2026-11-24T16:30:00Z'), tz, '2026-11-23 16:31:00+00'), true);
  // Bad tz falls back instead of throwing.
  assert.doesNotThrow(() => digestDue(new Date(), 'Not/AZone', null));
});

test('parsePgTimestamp handles Postgres text and ISO', () => {
  assert.equal(parsePgTimestamp('2026-11-24 16:31:00.123+00').toISOString(), '2026-11-24T16:31:00.123Z');
  assert.equal(parsePgTimestamp('2026-11-24T16:31:00.123Z').toISOString(), '2026-11-24T16:31:00.123Z');
  assert.equal(parsePgTimestamp('2026-11-24 08:31:00-08').toISOString(), '2026-11-24T16:31:00.000Z');
});

test('turnstile: verify endpoint + per-form site key is used when set', () => {
  assert.equal(captchaVerifyEndpoint('turnstile'), 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(captchaVerifyEndpoint('recaptcha'), 'https://www.google.com/recaptcha/api/siteverify');
  assert.equal(providerSiteKey('turnstile', { turnstileSiteKey: '0x4AAA-form' }), '0x4AAA-form');
  assert.equal(providerSiteKey(null, { turnstileSiteKey: '0x4AAA-form' }), null);
});

test('schemas accept turnstile provider, notifications and write-only secret', () => {
  const c = CreateFormSchema.parse({
    name: 'Contact',
    definition: { fields: [{ id: 'a', label: 'A', type: 'text' }], security: { requireCaptcha: true, captchaProvider: 'turnstile' } },
    notifications: { mode: 'digest', emails: ['me@x.com'] },
    turnstile: { siteKey: '0x4AAA', secret: '0x4BBB' },
  });
  assert.equal(c.definition.security.captchaProvider, 'turnstile');
  assert.equal(c.notifications?.mode, 'digest');
  assert.throws(() => UpdateFormSchema.parse({ notifications: { emails: ['not-an-email'] } }));
});
