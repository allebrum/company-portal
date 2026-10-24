import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const web = process.cwd();
const m = JSON.parse(fs.readFileSync(path.join(web, 'public/site.webmanifest'), 'utf8'));

function pngSize(file: string): [number, number] {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('ascii', 1, 4), 'PNG', `${file} is not a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('manifest has the installability basics', () => {
  assert.equal(m.name, 'Hoppa');
  assert.equal(m.short_name, 'Hoppa');
  assert.equal(m.display, 'standalone');
  assert.equal(m.scope, '/');
  assert.equal(m.id, '/');
  assert.match(m.theme_color, /^#9333ea$/i);
  assert.match(m.background_color, /^#9333ea$/i);
  assert.ok(m.start_url.startsWith('/'));
});

test('start_url and shortcuts point at real exported routes', () => {
  for (const url of [m.start_url, ...m.shortcuts.map((s: { url: string }) => s.url)]) {
    const route = url.replace(/^\/|\/$/g, '').split('?')[0];
    assert.ok(fs.existsSync(path.join(web, 'src/app', route, 'page.tsx')), `no page for ${url}`);
    assert.ok(url.endsWith('/'), `${url} should end with / (trailingSlash export)`);
  }
});

test('icons exist with the declared sizes, including maskable 192 + 512', () => {
  for (const icon of m.icons) {
    const [w, h] = pngSize(path.join(web, 'public', icon.src));
    assert.equal(`${w}x${h}`, icon.sizes, icon.src);
  }
  const maskable = m.icons.filter((i: { purpose?: string }) => i.purpose?.includes('maskable')).map((i: { sizes: string }) => i.sizes);
  assert.deepEqual(maskable.sort(), ['192x192', '512x512']);
  assert.ok(m.icons.some((i: { purpose?: string; sizes: string }) => i.purpose === 'any' && i.sizes === '512x512'));
});

test('every precached shell asset in sw.js exists in public/', () => {
  const src = fs.readFileSync(path.join(web, 'sw/sw.js'), 'utf8');
  const block = src.slice(src.indexOf('SHELL_ASSETS = ['), src.indexOf('];', src.indexOf('SHELL_ASSETS = [')));
  const list = [...block.matchAll(/'(\/[^']+)'/g)].map((x) => x[1]!);
  assert.ok(list.length >= 5);
  for (const p of list) assert.ok(fs.existsSync(path.join(web, 'public', p)), `missing public${p}`);
  assert.ok(src.includes("var OFFLINE_URL = '/offline.html'"));
});
