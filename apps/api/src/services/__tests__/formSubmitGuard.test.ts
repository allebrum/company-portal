import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FormDefinitionSchema, FORM_ALREADY_SUBMITTED_MESSAGE, FORM_RATE_LIMITED_MESSAGE, isSafeRedirectUrl } from '@allebrum/shared';
import {
  FORM_SUBMIT_BURST_MAX,
  guardPublicSubmit,
  hashVisitorToken,
  memoryRedis,
} from '../formSubmitGuard.js';

function definition(overrides: Record<string, unknown> = {}) {
  return FormDefinitionSchema.parse({
    successMessage: 'Thanks, we got your submission.',
    fields: [{ id: 'email', label: 'Email', type: 'email', required: true }],
    ...overrides,
  });
}

const base = {
  formId: 'form-1',
  ip: '203.0.113.10',
  sessionId: 'fs_abc12345',
  answers: { email: 'ana@site.com' },
};

test('isSafeRedirectUrl allows only absolute http(s) URLs', () => {
  assert.equal(isSafeRedirectUrl('https://example.com/thanks'), true);
  assert.equal(isSafeRedirectUrl('http://example.com'), true);
  assert.equal(isSafeRedirectUrl('javascript:alert(1)'), false);
  assert.equal(isSafeRedirectUrl('data:text/html,hi'), false);
  assert.equal(isSafeRedirectUrl('/thanks'), false);
  assert.equal(isSafeRedirectUrl('ftp://example.com/x'), false);
  assert.equal(isSafeRedirectUrl(''), false);
});

test('FormDefinitionSchema accepts a safe redirectUrl and rejects javascript:', () => {
  const ok = FormDefinitionSchema.parse({
    fields: [{ id: 'n', label: 'Name', type: 'text' }],
    redirectUrl: 'https://acme.com/thank-you',
  });
  assert.equal(ok.redirectUrl, 'https://acme.com/thank-you');
  assert.equal(ok.allowAnotherSubmission, true);
  assert.equal(ok.maxSubmissionsPerIpPerHour, 10);
  assert.equal(ok.maxSubmissionsPerHour, 200);
  assert.equal(ok.resubmitWindowHours, 24);

  assert.equal(FormDefinitionSchema.parse({
    fields: [{ id: 'n', label: 'Name', type: 'text' }],
    redirectUrl: '',
  }).redirectUrl, undefined);

  assert.throws(
    () => FormDefinitionSchema.parse({
      fields: [{ id: 'n', label: 'Name', type: 'text' }],
      redirectUrl: 'javascript:alert(1)',
    }),
  );
});

test('hashVisitorToken is stable and does not contain the raw IP', () => {
  const ip = '2001:db8::1';
  const a = hashVisitorToken(ip);
  assert.equal(a, hashVisitorToken(ip));
  assert.equal(a.length, 32);
  assert.equal(a.includes(ip), false);
  assert.notEqual(a, hashVisitorToken('2001:db8::2'));
});

test('allows the first accepted submission and dedupes an identical repeat', async () => {
  const redis = memoryRedis();
  const def = definition();
  const first = await guardPublicSubmit({ ...base, definition: def, redis });
  assert.deepEqual(first, { ok: true });
  const repeat = await guardPublicSubmit({ ...base, definition: def, redis });
  assert.equal(repeat.ok, true);
  assert.equal('skipStore' in repeat && repeat.skipStore, 'duplicate');
  if (repeat.ok && 'skipStore' in repeat) {
    assert.equal(repeat.message, 'Thanks, we got your submission.');
  }
});

test('burst limit: 5 per 10 minutes per visitor per form, then 429', async () => {
  const redis = memoryRedis();
  const def = definition();
  for (let i = 0; i < FORM_SUBMIT_BURST_MAX; i++) {
    const r = await guardPublicSubmit({
      ...base,
      answers: { email: `person${i}@site.com` },
      definition: def,
      redis,
    });
    assert.deepEqual(r, { ok: true }, `attempt ${i + 1} should pass`);
  }
  const blocked = await guardPublicSubmit({
    ...base,
    answers: { email: 'overflow@site.com' },
    definition: def,
    redis,
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.status, 429);
    assert.equal(blocked.errors.__form, FORM_RATE_LIMITED_MESSAGE);
  }
});

test('hourly per-visitor cap is configurable and independent per form / IP', async () => {
  const redis = memoryRedis();
  const def = definition({ maxSubmissionsPerIpPerHour: 2 });
  // Use distinct answers so dedupe doesn't kick in.
  const a = await guardPublicSubmit({ ...base, answers: { email: 'a@x.com' }, definition: def, redis });
  const b = await guardPublicSubmit({ ...base, answers: { email: 'b@x.com' }, definition: def, redis });
  const c = await guardPublicSubmit({ ...base, answers: { email: 'c@x.com' }, definition: def, redis });
  assert.deepEqual(a, { ok: true });
  assert.deepEqual(b, { ok: true });
  assert.equal(c.ok, false);

  const otherForm = await guardPublicSubmit({
    ...base,
    formId: 'form-2',
    answers: { email: 'c@x.com' },
    definition: def,
    redis,
  });
  assert.deepEqual(otherForm, { ok: true });

  const otherIp = await guardPublicSubmit({
    ...base,
    ip: '203.0.113.99',
    answers: { email: 'c@x.com' },
    definition: def,
    redis,
  });
  assert.deepEqual(otherIp, { ok: true });
});

test('form-wide hourly cap applies across visitors', async () => {
  const redis = memoryRedis();
  const def = definition({ maxSubmissionsPerHour: 10, maxSubmissionsPerIpPerHour: 50 });
  // The form-wide default minimum is 10; fill it with distinct IPs and answers.
  for (let i = 0; i < 10; i++) {
    const r = await guardPublicSubmit({
      ...base,
      ip: `203.0.113.${i + 1}`,
      sessionId: `fs_s${i}xxxxxxx`,
      answers: { email: `p${i}@site.com` },
      definition: def,
      redis,
    });
    assert.deepEqual(r, { ok: true }, `form-wide attempt ${i + 1}`);
  }
  const blocked = await guardPublicSubmit({
    ...base,
    ip: '198.51.100.1',
    sessionId: 'fs_newxxxxxxxx',
    answers: { email: 'last@site.com' },
    definition: def,
    redis,
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.status, 429);
});

test('allowAnotherSubmission=false: one submission per visitor, then a friendly already-submitted result', async () => {
  const redis = memoryRedis();
  const def = definition({ allowAnotherSubmission: false, resubmitWindowHours: 24 });
  const first = await guardPublicSubmit({
    ...base,
    answers: { email: 'one@site.com' },
    definition: def,
    redis,
  });
  assert.deepEqual(first, { ok: true });

  const again = await guardPublicSubmit({
    ...base,
    answers: { email: 'two@site.com' },
    definition: def,
    redis,
  });
  assert.equal(again.ok, true);
  assert.equal('skipStore' in again && again.skipStore, 'already_submitted');
  if (again.ok && 'skipStore' in again) {
    assert.equal(again.message, FORM_ALREADY_SUBMITTED_MESSAGE);
  }

  // Same session, different IP, still blocked.
  const sameSession = await guardPublicSubmit({
    ...base,
    ip: '198.51.100.8',
    answers: { email: 'three@site.com' },
    definition: def,
    redis,
  });
  assert.equal(sameSession.ok, true);
  assert.equal('skipStore' in sameSession && sameSession.skipStore, 'already_submitted');
});

test('guard fails open when Redis throws', async () => {
  const redis = {
    async incr() { throw new Error('down'); },
    async expire() { throw new Error('down'); },
    async get() { throw new Error('down'); },
    async set() { throw new Error('down'); },
  };
  const r = await guardPublicSubmit({ ...base, definition: definition(), redis });
  assert.deepEqual(r, { ok: true });
});
