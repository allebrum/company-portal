import path from 'node:path';

/**
 * Cache headers for the bundled static web export (SERVE_WEB / Docker).
 *
 *  - /sw.js: must never be cached long-term, or browsers keep running an old
 *    worker after a deploy (and never see the update). `no-cache` = always
 *    revalidate. `Service-Worker-Allowed: /` pins the scope to the whole app.
 *  - /_next/static/*: content-hashed file names -> cache forever.
 *  - HTML pages + manifest: revalidate every time so a deploy is picked up.
 *  - everything else (icons, fonts in /public): short cache.
 */
export function staticCacheHeaders(urlPath: string): Record<string, string> {
  const p = urlPath.split('?')[0] ?? urlPath;
  if (p === '/sw.js') {
    return {
      'Cache-Control': 'no-cache, max-age=0, must-revalidate',
      'Service-Worker-Allowed': '/',
      'Content-Type': 'text/javascript; charset=utf-8',
    };
  }
  if (p.startsWith('/_next/static/')) return { 'Cache-Control': 'public, max-age=31536000, immutable' };
  if (p === '/site.webmanifest') {
    return { 'Cache-Control': 'no-cache', 'Content-Type': 'application/manifest+json; charset=utf-8' };
  }
  const ext = path.extname(p);
  if (ext === '' || ext === '.html' || ext === '.txt') return { 'Cache-Control': 'no-cache' };
  return { 'Cache-Control': 'public, max-age=3600' };
}
