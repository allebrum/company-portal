import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TURNSTILE_HOSTNAME_CAP_FREE, TurnstileSaveSchema } from '@allebrum/shared';
import { hostnameCap, interpretSiteverify, normalizeHostname, normalizeHostnames } from '../turnstileRules.js';
import { providerSiteKey } from '../formCaptcha.js';

test('normalizeHostname accepts FQDNs and strips scheme/port/path', () => {
  assert.equal(normalizeHostname('https://www.Example.com/contact'), 'www.example.com');
  assert.equal(normalizeHostname('example.com:443'), 'example.com');
  assert.equal(normalizeHostname('  EXAMPLE.com.  '), 'example.com');
  assert.equal(normalizeHostname('localhost'), 'localhost');
  assert.equal(normalizeHostname('http://localhost:3000'), 'localhost');
});

test('normalizeHostname rejects wildcards, bare names, and junk', () => {
  assert.equal(normalizeHostname('*.example.com'), null);
  assert.equal(normalizeHostname('example'), null);
  assert.equal(normalizeHostname('https://'), null);
  assert.equal(normalizeHostname(''), null);
});

test('normalizeHostnames de-dupes and drops invalids', () => {
  assert.deepEqual(normalizeHostnames(['https://A.com', 'a.com', 'nope', 'b.com']), ['a.com', 'b.com']);
});

test('hostname cap is 10 on Free and 200 on Enterprise', () => {
  assert.equal(hostnameCap(false), TURNSTILE_HOSTNAME_CAP_FREE);
  assert.equal(hostnameCap(true), 200);
});

test('interpretSiteverify: dummy-token failure means the secret is good', () => {
  assert.equal(interpretSiteverify({ success: false, 'error-codes': ['invalid-input-response'] }).ok, true);
  assert.equal(interpretSiteverify({ success: false, 'error-codes': ['missing-input-response'] }).ok, true);
  assert.equal(interpretSiteverify({ success: true }).ok, true);
});

test('interpretSiteverify: invalid-input-secret means the key is wrong', () => {
  const r = interpretSiteverify({ success: false, 'error-codes': ['invalid-input-secret'] });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'invalid_secret');
});

test('Turnstile site key no longer falls back to a platform env var', () => {
  assert.equal(providerSiteKey('turnstile', { turnstileSiteKey: '0x4AAA-form' }), '0x4AAA-form');
  assert.equal(providerSiteKey('turnstile', { turnstileSiteKey: null }), null);
  assert.equal(providerSiteKey(null, { turnstileSiteKey: '0x4AAA-form' }), null);
});

test('TurnstileSaveSchema treats omitted secret as keep-stored (write-only)', () => {
  const a = TurnstileSaveSchema.parse({ siteKey: '0x4AAA', hostnames: ['example.com'] });
  assert.equal(a.secret, undefined);
  const b = TurnstileSaveSchema.parse({ secret: null, apiToken: '' });
  assert.equal(b.secret, null);
});
