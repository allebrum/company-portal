// Post-build step: copy sw/sw.js into the static export with a per-build
// version, so each deploy ships a byte-different service worker (which is
// what makes browsers notice the update and show the Reload toast).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'out');
const buildIdFile = path.join(root, '.next', 'BUILD_ID');
if (!fs.existsSync(out)) throw new Error('build-sw: out/ not found — run `next build` first');
const buildId = fs.readFileSync(buildIdFile, 'utf8').trim();
if (!buildId) throw new Error('build-sw: empty BUILD_ID');
const src = fs.readFileSync(path.join(root, 'sw', 'sw.js'), 'utf8');
if (!src.includes('__SW_VERSION__')) throw new Error('build-sw: __SW_VERSION__ placeholder missing');
const version = `${buildId}`;
fs.writeFileSync(path.join(out, 'sw.js'), src.replaceAll('__SW_VERSION__', version));
console.log(`build-sw: wrote out/sw.js (version ${version})`);
