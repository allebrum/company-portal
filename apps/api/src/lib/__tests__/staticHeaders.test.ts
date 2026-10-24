import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staticCacheHeaders } from '../staticHeaders.js';

test('sw.js is never long-cached and is scoped to the whole app', () => {
  const h = staticCacheHeaders('/sw.js');
  assert.match(h['Cache-Control']!, /no-cache/);
  assert.doesNotMatch(h['Cache-Control']!, /immutable|max-age=[1-9]/);
  assert.equal(h['Service-Worker-Allowed'], '/');
  assert.match(h['Content-Type']!, /javascript/);
});

test('hashed Next assets are immutable; pages and manifest revalidate', () => {
  assert.match(staticCacheHeaders('/_next/static/chunks/app-abc123.js')['Cache-Control']!, /immutable/);
  assert.equal(staticCacheHeaders('/dashboard/index.html')['Cache-Control'], 'no-cache');
  assert.equal(staticCacheHeaders('/offline.html')['Cache-Control'], 'no-cache');
  assert.equal(staticCacheHeaders('/dashboard/index.txt')['Cache-Control'], 'no-cache');
  const m = staticCacheHeaders('/site.webmanifest');
  assert.equal(m['Cache-Control'], 'no-cache');
  assert.match(m['Content-Type']!, /manifest\+json/);
  assert.match(staticCacheHeaders('/maskable-512x512.png')['Cache-Control']!, /max-age=3600/);
});
