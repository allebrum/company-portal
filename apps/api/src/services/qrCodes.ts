import { randomBytes } from 'node:crypto';
import { eq, and, or, desc, gte, isNull, count, sql } from 'drizzle-orm';
import { UAParser } from 'ua-parser-js';
import { db } from '../db/client.js';
import { qrCodes, qrScans, type QrCode, type QrScan } from '../db/schema.js';
import { HttpError } from '../middleware/errorHandler.js';
import { appendActivity } from './activity.js';
import { lookupGeo } from './ipGeo.js';
import type {
  CreateQrInput,
  UpdateQrInput,
  QrCodeRow,
  QrScanRow,
  QrScanSummary,
} from '@allebrum/shared';

/**
 * F24 — QR code generator service. Owns CRUD + scan recording +
 * dashboard aggregation. Visibility model is binary: `private` (owner
 * only) or `workspace` (any signed-in staffer can view + see the scan
 * dashboard; only owner can mutate). The `owner_user_id` column is the
 * single source of truth for "can I edit this".
 *
 * Scan flow:
 *   1. Public `GET /q/:shortCode` calls `recordScan` synchronously.
 *   2. `recordScan` parses UA + inserts a row + 302-target URL fast.
 *   3. Geo lookup is fire-and-forget; when it resolves, the row is
 *      patched with country/city/lat/lon. The 302 doesn't wait.
 */

// ---------- helpers ----------

function rowToRow(r: QrCode): QrCodeRow {
  return {
    id: r.id,
    ownerUserId: r.ownerUserId,
    label: r.label,
    targetUrl: r.targetUrl,
    shortCode: r.shortCode,
    visibility: r.visibility as 'private' | 'workspace',
    foregroundColor: r.foregroundColor,
    backgroundColor: r.backgroundColor,
    errorCorrection: r.errorCorrection as 'L' | 'M' | 'Q' | 'H',
    logoDataUrl: r.logoDataUrl,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    archivedAt: r.archivedAt,
  };
}

function scanRowToRow(s: QrScan): QrScanRow {
  return {
    id: s.id,
    qrCodeId: s.qrCodeId,
    scannedAt: s.scannedAt,
    ip: s.ip,
    userAgent: s.userAgent,
    referer: s.referer,
    browser: s.browser,
    os: s.os,
    device: s.device,
    country: s.country,
    countryCode: s.countryCode,
    region: s.region,
    city: s.city,
    latitude: s.latitude !== null ? Number(s.latitude) : null,
    longitude: s.longitude !== null ? Number(s.longitude) : null,
  };
}

/**
 * Mint an 8-char URL-safe code from 6 random bytes. base64url over 6
 * bytes gives 8 chars. UNIQUE constraint on `short_code` covers the
 * (vanishingly rare) collision; we retry a few times then give up.
 */
async function mintShortCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomBytes(6).toString('base64url');
    const existing = await db
      .select({ id: qrCodes.id })
      .from(qrCodes)
      .where(eq(qrCodes.shortCode, code))
      .limit(1);
    if (existing.length === 0) return code;
  }
  throw new Error('short_code_collision');
}

// ---------- CRUD ----------

/** Returns codes the viewer can see: their own + workspace-shared. */
export async function listVisible(viewerId: string): Promise<QrCodeRow[]> {
  const rows = await db
    .select()
    .from(qrCodes)
    .where(
      and(
        isNull(qrCodes.archivedAt),
        or(eq(qrCodes.ownerUserId, viewerId), eq(qrCodes.visibility, 'workspace')),
      ),
    )
    .orderBy(desc(qrCodes.createdAt));
  return rows.map(rowToRow);
}

/** Owner-only fetch. Returns null when not found or not owned. */
export async function getOwned(id: string, ownerId: string): Promise<QrCode | null> {
  const [row] = await db
    .select()
    .from(qrCodes)
    .where(and(eq(qrCodes.id, id), eq(qrCodes.ownerUserId, ownerId), isNull(qrCodes.archivedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * Owner or workspace-visible fetch. Used by viewer-side reads (scans
 * dashboard, CSV export, image PNG download). Non-owner workspace
 * viewers get the same payload as owner.
 */
export async function getForViewer(id: string, viewerId: string): Promise<QrCode | null> {
  const [row] = await db
    .select()
    .from(qrCodes)
    .where(
      and(
        eq(qrCodes.id, id),
        isNull(qrCodes.archivedAt),
        or(eq(qrCodes.ownerUserId, viewerId), eq(qrCodes.visibility, 'workspace')),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function create(args: { ownerId: string; input: CreateQrInput }): Promise<QrCodeRow> {
  const shortCode = await mintShortCode();
  const [row] = await db
    .insert(qrCodes)
    .values({
      ownerUserId: args.ownerId,
      label: args.input.label ?? '',
      targetUrl: args.input.targetUrl,
      shortCode,
      visibility: args.input.visibility ?? 'private',
      foregroundColor: args.input.foregroundColor ?? '#000000',
      backgroundColor: args.input.backgroundColor ?? '#FFFFFF',
      errorCorrection: args.input.errorCorrection ?? 'M',
      logoDataUrl: args.input.logoDataUrl ?? null,
    })
    .returning();
  if (!row) throw new Error('insert_failed');
  await appendActivity({
    whoId: args.ownerId,
    kind: 'qr.create',
    target: `${row.label || row.shortCode} → ${row.targetUrl}`,
  });
  return rowToRow(row);
}

/**
 * Owner-only patch. Returns the updated row. Audit-logs the set of
 * fields touched so target-URL repoints are traceable.
 */
export async function update(args: {
  id: string;
  ownerId: string;
  patch: UpdateQrInput;
}): Promise<QrCodeRow> {
  const existing = await getOwned(args.id, args.ownerId);
  if (!existing) throw new HttpError(404, 'qr_not_found');
  const upd: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  const changedKeys: string[] = [];
  for (const k of [
    'label',
    'targetUrl',
    'visibility',
    'foregroundColor',
    'backgroundColor',
    'errorCorrection',
    'logoDataUrl',
  ] as const) {
    const v = args.patch[k];
    if (v !== undefined) {
      // Map camelCase → DB snake_case via Drizzle's column accessor.
      switch (k) {
        case 'targetUrl':
          upd.targetUrl = v;
          break;
        case 'foregroundColor':
          upd.foregroundColor = v;
          break;
        case 'backgroundColor':
          upd.backgroundColor = v;
          break;
        case 'errorCorrection':
          upd.errorCorrection = v;
          break;
        case 'logoDataUrl':
          upd.logoDataUrl = v;
          break;
        default:
          upd[k] = v;
      }
      changedKeys.push(k);
    }
  }
  if (changedKeys.length === 0) return rowToRow(existing);
  const [row] = await db
    .update(qrCodes)
    .set(upd)
    .where(eq(qrCodes.id, args.id))
    .returning();
  if (!row) throw new HttpError(404, 'qr_not_found');
  await appendActivity({
    whoId: args.ownerId,
    kind: 'qr.update',
    target: `${row.label || row.shortCode} · ${changedKeys.join(', ')}`,
  });
  return rowToRow(row);
}

/** Owner-only soft delete. Keeps scan history queryable for audit. */
export async function softDelete(id: string, ownerId: string): Promise<void> {
  const existing = await getOwned(id, ownerId);
  if (!existing) throw new HttpError(404, 'qr_not_found');
  await db
    .update(qrCodes)
    .set({ archivedAt: new Date().toISOString() })
    .where(eq(qrCodes.id, id));
  await appendActivity({
    whoId: ownerId,
    kind: 'qr.delete',
    target: `${existing.label || existing.shortCode}`,
  });
}

// ---------- Scan recording ----------

/**
 * Public-flow entry. Looks up by short code (ignoring archived), parses
 * UA, inserts the scan row, fires async geo lookup (non-blocking) to
 * patch the row in place. Returns the target URL so the route can 302.
 *
 * Returns null when the short code doesn't exist or is archived — the
 * route then responds 404.
 */
export async function recordScan(args: {
  shortCode: string;
  ip: string | null;
  userAgent: string | null;
  referer: string | null;
}): Promise<{ targetUrl: string } | null> {
  const [code] = await db
    .select({ id: qrCodes.id, targetUrl: qrCodes.targetUrl, archivedAt: qrCodes.archivedAt })
    .from(qrCodes)
    .where(eq(qrCodes.shortCode, args.shortCode))
    .limit(1);
  if (!code || code.archivedAt) return null;

  let browser: string | null = null;
  let os: string | null = null;
  let device: string | null = null;
  if (args.userAgent) {
    try {
      const ua = new UAParser(args.userAgent).getResult();
      browser = ua.browser.name ?? null;
      os = ua.os.name ?? null;
      device = ua.device.type ?? (ua.device.vendor ? `${ua.device.vendor} ${ua.device.model ?? ''}`.trim() : null);
    } catch {
      /* parser tolerates garbage; ignore */
    }
  }

  const [scan] = await db
    .insert(qrScans)
    .values({
      qrCodeId: code.id,
      ip: args.ip ?? null,
      userAgent: args.userAgent ?? null,
      referer: args.referer ?? null,
      browser,
      os,
      device,
    })
    .returning({ id: qrScans.id });

  // Fire-and-forget geo patch. Wrapped so an upstream/Redis blip doesn't
  // surface as an unhandled rejection.
  if (scan?.id && args.ip) {
    void lookupGeo(args.ip).then(async (geo) => {
      if (!geo) return;
      try {
        await db
          .update(qrScans)
          .set({
            country: geo.country,
            countryCode: geo.countryCode,
            region: geo.region,
            city: geo.city,
            latitude: geo.latitude !== null ? String(geo.latitude) : null,
            longitude: geo.longitude !== null ? String(geo.longitude) : null,
          })
          .where(eq(qrScans.id, scan.id));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[qr] geo patch failed', e);
      }
    });
  }

  return { targetUrl: code.targetUrl };
}

// ---------- Analytics ----------

/** Inclusive ISO yyyy-mm-dd of the day `n` days before today. */
function isoDateOffset(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export async function summaryFor(args: { id: string; viewerId: string }): Promise<QrScanSummary> {
  const code = await getForViewer(args.id, args.viewerId);
  if (!code) throw new HttpError(404, 'qr_not_found');

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29); // inclusive of today

  // Total + unique IPs (rough) + most-recent timestamp.
  const [totals] = await db
    .select({
      total: count(qrScans.id),
      mostRecent: sql<string | null>`max(${qrScans.scannedAt})`,
    })
    .from(qrScans)
    .where(eq(qrScans.qrCodeId, code.id));

  const [last7] = await db
    .select({ n: count(qrScans.id) })
    .from(qrScans)
    .where(
      and(
        eq(qrScans.qrCodeId, code.id),
        gte(qrScans.scannedAt, sevenDaysAgo.toISOString()),
      ),
    );

  const [uniqIpRow] = await db
    .select({ n: sql<number>`count(distinct ${qrScans.ip})` })
    .from(qrScans)
    .where(eq(qrScans.qrCodeId, code.id));

  // Daily buckets — fill missing days with zero so the sparkline is dense.
  const bucketRows = await db
    .select({
      day: sql<string>`to_char(${qrScans.scannedAt}, 'YYYY-MM-DD')`,
      n: count(qrScans.id),
    })
    .from(qrScans)
    .where(
      and(
        eq(qrScans.qrCodeId, code.id),
        gte(qrScans.scannedAt, thirtyDaysAgo.toISOString()),
      ),
    )
    .groupBy(sql`to_char(${qrScans.scannedAt}, 'YYYY-MM-DD')`);
  const bucketMap = new Map(bucketRows.map((r) => [r.day, Number(r.n)]));
  const dailyBuckets: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = isoDateOffset(i);
    dailyBuckets.push({ date: day, count: bucketMap.get(day) ?? 0 });
  }

  // Top countries.
  const countryRows = await db
    .select({
      country: qrScans.country,
      countryCode: qrScans.countryCode,
      n: count(qrScans.id),
    })
    .from(qrScans)
    .where(and(eq(qrScans.qrCodeId, code.id), sql`${qrScans.countryCode} is not null`))
    .groupBy(qrScans.country, qrScans.countryCode)
    .orderBy(desc(count(qrScans.id)))
    .limit(5);
  const topCountries = countryRows.map((r) => ({
    countryCode: r.countryCode ?? '?',
    country: r.country ?? r.countryCode ?? 'Unknown',
    count: Number(r.n),
  }));

  // Recent scans.
  const recentRows = await db
    .select()
    .from(qrScans)
    .where(eq(qrScans.qrCodeId, code.id))
    .orderBy(desc(qrScans.scannedAt))
    .limit(25);
  const recentScans = recentRows.map(scanRowToRow);

  return {
    total: Number(totals?.total ?? 0),
    last7d: Number(last7?.n ?? 0),
    uniqueIps: Number(uniqIpRow?.n ?? 0),
    mostRecentScanAt: totals?.mostRecent ?? null,
    dailyBuckets,
    topCountries,
    recentScans,
  };
}

// ---------- CSV export ----------

/**
 * Streaming-friendly generator yielding CSV rows for the
 * `/api/qr/:id/scans.csv` route. Reuses the F2 inline writer's
 * formula-injection guard (cells starting with `=`, `+`, `-`, `@`, tab,
 * or carriage return get a single-quote prefix).
 */
export async function* scansCsvStream(args: { id: string; viewerId: string }): AsyncGenerator<string> {
  const code = await getForViewer(args.id, args.viewerId);
  if (!code) throw new HttpError(404, 'qr_not_found');

  const header = [
    'timestamp_iso',
    'ip',
    'country',
    'country_code',
    'region',
    'city',
    'browser',
    'os',
    'device',
    'referer',
  ];
  yield header.map(csvCell).join(',') + '\r\n';

  // Drizzle doesn't expose a true cursor; for v1 we page in chunks of
  // 1000 ordered by scanned_at — fine for tens of thousands of rows.
  let offset = 0;
  const PAGE = 1000;
  for (;;) {
    const rows = await db
      .select()
      .from(qrScans)
      .where(eq(qrScans.qrCodeId, code.id))
      .orderBy(desc(qrScans.scannedAt))
      .limit(PAGE)
      .offset(offset);
    if (rows.length === 0) break;
    for (const r of rows) {
      yield [
        r.scannedAt,
        r.ip ?? '',
        r.country ?? '',
        r.countryCode ?? '',
        r.region ?? '',
        r.city ?? '',
        r.browser ?? '',
        r.os ?? '',
        r.device ?? '',
        r.referer ?? '',
      ]
        .map(csvCell)
        .join(',') + '\r\n';
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
}

/**
 * CSV cell escaper + formula-injection guard. Mirrors `apps/api/src/
 * services/entries.ts`'s `csvCell` from F2.
 */
function csvCell(value: string): string {
  let s = value ?? '';
  // Excel-style formula injection guard.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
