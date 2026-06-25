import { z } from 'zod';

/**
 * F24 — shared schemas for the QR Code Generator tool. Mirrors the
 * `qr_codes` + `qr_scans` tables. Styling fields default to safe values
 * so a bare `POST /api/qr` with just `targetUrl` works.
 */

export const QR_VISIBILITIES = ['private', 'workspace'] as const;
export type QrVisibility = (typeof QR_VISIBILITIES)[number];

export const QR_ERROR_LEVELS = ['L', 'M', 'Q', 'H'] as const;
export type QrErrorLevel = (typeof QR_ERROR_LEVELS)[number];

// Same 80KB ceiling F8's `brandLogoDataUrl` uses — base64-encoded image
// data URLs that fit comfortably in a JSON payload.
const LOGO_MAX_BYTES = 110_000;

const colorHex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Hex color #RRGGBB');

export const CreateQrSchema = z.object({
  label: z.string().max(80).optional().default(''),
  targetUrl: z.string().url().max(2000),
  clientId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  visibility: z.enum(QR_VISIBILITIES).optional().default('private'),
  foregroundColor: colorHex.optional().default('#000000'),
  backgroundColor: colorHex.optional().default('#FFFFFF'),
  errorCorrection: z.enum(QR_ERROR_LEVELS).optional().default('M'),
  logoDataUrl: z.string().max(LOGO_MAX_BYTES).nullable().optional(),
});
export type CreateQrInput = z.input<typeof CreateQrSchema>;

export const UpdateQrSchema = z.object({
  label: z.string().max(80).optional(),
  targetUrl: z.string().url().max(2000).optional(),
  clientId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  visibility: z.enum(QR_VISIBILITIES).optional(),
  foregroundColor: colorHex.optional(),
  backgroundColor: colorHex.optional(),
  errorCorrection: z.enum(QR_ERROR_LEVELS).optional(),
  logoDataUrl: z.string().max(LOGO_MAX_BYTES).nullable().optional(),
});
export type UpdateQrInput = z.infer<typeof UpdateQrSchema>;

/** Row shape returned by `GET /api/qr` and `GET /api/qr/:id`. */
export type QrCodeRow = {
  id: string;
  ownerUserId: string;
  label: string;
  targetUrl: string;
  clientId: string | null;
  projectId: string | null;
  totalScans: number;
  uniqueVisitors: number;
  shortCode: string;
  visibility: QrVisibility;
  foregroundColor: string;
  backgroundColor: string;
  errorCorrection: QrErrorLevel;
  logoDataUrl: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type QrScanRow = {
  id: string;
  qrCodeId: string;
  scannedAt: string;
  ip: string | null;
  userAgent: string | null;
  referer: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
};

/** Aggregate dashboard payload for `GET /api/qr/:id/scans`. */
export type QrScanSummary = {
  total: number;
  last7d: number;
  uniqueIps: number;
  mostRecentScanAt: string | null;
  /** 30 entries, oldest → newest. `date` is ISO yyyy-mm-dd. */
  dailyBuckets: { date: string; count: number }[];
  /** Top countries by scan count, max 5. */
  topCountries: { countryCode: string; country: string; count: number }[];
  /** Most recent 25 scans, newest first. */
  recentScans: QrScanRow[];
};
