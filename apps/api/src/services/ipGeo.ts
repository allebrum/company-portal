/**
 * F24 — best-effort IP → geo lookup for QR scan logging.
 *
 * Uses the free `ip-api.com` JSON endpoint (no API key, 45 req/min rate
 * limit on their side). Results are cached in-process for 7 days keyed by
 * IP so the same IP scanning ten codes in a row only hits the upstream once.
 * Failures (rate limit, network, malformed response) are also cached briefly
 * (60s) so a bad-batch IP doesn't get repeatedly retried in a hot loop.
 * (Redis was removed in the Supabase/Netlify migration; this per-instance
 * cache is sufficient for best-effort scan enrichment.)
 *
 * Returns `null` on any failure path; the caller (`recordScan`) keeps
 * the row's geo columns null. The scan row is still written either way.
 *
 * Private / link-local / IPv6 loopback IPs short-circuit to null so dev
 * environments don't burn ip-api.com quota.
 */

export type GeoFields = {
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
};

const HIT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const MISS_TTL_SECONDS = 60;
const FETCH_TIMEOUT_MS = 1500;

// In-process cache: ip -> { value, expiresAt }. value === 'MISS' is a negative
// cache entry. Bounded by natural IP churn + short MISS TTL.
const geoCache = new Map<string, { value: GeoFields | 'MISS'; expiresAt: number }>();

/** RFC 1918 / RFC 4193 / loopback / link-local — never sends to upstream. */
function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  if (ip === '::1' || ip.startsWith('::ffff:127.') || ip.startsWith('127.')) return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.')) return true; // link-local
  // 172.16.0.0 – 172.31.255.255
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1] ?? '0', 10);
    if (second >= 16 && second <= 31) return true;
  }
  // IPv6 private ranges (very rough — fc00::/7, fe80::/10)
  if (/^f[cd]/i.test(ip) || /^fe[89ab]/i.test(ip)) return true;
  return false;
}

export async function lookupGeo(ip: string | null | undefined): Promise<GeoFields | null> {
  if (!ip || isPrivateIp(ip)) return null;

  // Cache hit fast path (negative cache uses the 'MISS' sentinel).
  const hit = geoCache.get(ip);
  if (hit && Date.now() < hit.expiresAt) {
    return hit.value === 'MISS' ? null : hit.value;
  }

  // Fetch with a tight timeout. ip-api.com's free tier is HTTP-only;
  // their `fields` query reduces payload size.
  const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,region,city,lat,lon`;
  let geo: GeoFields | null = null;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (res.ok) {
      const body = (await res.json()) as {
        status?: string;
        country?: string;
        countryCode?: string;
        region?: string;
        city?: string;
        lat?: number;
        lon?: number;
      };
      if (body.status === 'success') {
        geo = {
          country: body.country ?? null,
          countryCode: body.countryCode ?? null,
          region: body.region ?? null,
          city: body.city ?? null,
          latitude: typeof body.lat === 'number' ? body.lat : null,
          longitude: typeof body.lon === 'number' ? body.lon : null,
        };
      }
    }
  } catch {
    // Network / timeout / parse failure — fall through to negative cache.
  }

  geoCache.set(ip, {
    value: geo ?? 'MISS',
    expiresAt: Date.now() + (geo ? HIT_TTL_SECONDS : MISS_TTL_SECONDS) * 1000,
  });

  return geo;
}
