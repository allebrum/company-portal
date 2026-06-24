import { randomUUID } from 'node:crypto';
import { getServiceSupabase } from '../lib/supabase.js';
import { env } from '../env.js';

/**
 * Supabase Storage transport — the replacement for the Google Drive uploader.
 *
 * Files live in a single `spaces` bucket, keyed by
 * `<tenantId>/<scopeKind>/<scopeId>/<uuid>/<filename>` so they stay isolated
 * per tenant + scope (the same isolation the per-client/project Drive folders
 * gave us). The bucket is public and keys carry an unguessable UUID, so the
 * stored public URL works as a capability link from both the staff app and the
 * client portal — matching the prior "open the file link" UX without a Drive
 * connection. (Hardening to private + signed URLs gated on `sharedWithClient`
 * is a documented follow-up.)
 */
export const SPACES_BUCKET = 'spaces';

export function storageConfigured(): boolean {
  return !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

function sanitizeName(name: string): string {
  const cleaned = name.replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(0, 200);
  return cleaned.replace(/^[_.]+/, '') || 'file';
}

export type StoredObject = { key: string; url: string; size: number };

export async function uploadObject(args: {
  tenantId: string;
  scopeKind: string;
  scopeId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<StoredObject> {
  const supa = getServiceSupabase();
  const key = `${args.tenantId}/${args.scopeKind}/${args.scopeId}/${randomUUID()}/${sanitizeName(args.filename)}`;
  const { error } = await supa.storage.from(SPACES_BUCKET).upload(key, args.buffer, {
    contentType: args.mimeType || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new Error(`storage_upload_failed: ${error.message}`);
  const { data } = supa.storage.from(SPACES_BUCKET).getPublicUrl(key);
  return { key, url: data.publicUrl, size: args.buffer.length };
}

/** Best-effort delete (used for rollback + file removal). Never throws. */
export async function deleteObject(key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    await getServiceSupabase().storage.from(SPACES_BUCKET).remove([key]);
  } catch {
    /* best-effort */
  }
}

/** Idempotently ensure the bucket exists (called from db:init). */
export async function ensureSpacesBucket(): Promise<void> {
  if (!storageConfigured()) return;
  const supa = getServiceSupabase();
  const { data } = await supa.storage.getBucket(SPACES_BUCKET);
  if (data) return;
  const { error } = await supa.storage.createBucket(SPACES_BUCKET, {
    public: true,
    fileSizeLimit: '100MB',
  });
  // Ignore "already exists" races; surface anything else.
  if (error && !/exist/i.test(error.message)) {
    throw new Error(`create_bucket_failed: ${error.message}`);
  }
}
