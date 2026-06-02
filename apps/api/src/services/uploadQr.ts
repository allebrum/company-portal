import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { uploadQrSessionFiles, uploadQrSessions, users } from '../db/schema.js';
import { HttpError } from '../middleware/errorHandler.js';
import { currentTenantId, withTenant } from '../tenancy/context.js';
import { tenantEq } from '../tenancy/scope.js';
import { uploadSpaceFile } from './spaceFiles.js';
import { uploadTodoFile } from './todoFiles.js';
import { uploadFile } from './drive.js';
import { uploadGoalResource } from './goals.js';

export type UploadQrTarget =
  | { kind: 'space'; scopeKind: 'client' | 'project'; scopeId: string }
  | { kind: 'drive'; folderId: string }
  | { kind: 'todo'; todoId: string }
  | { kind: 'goal'; goalId: string };

type TargetKind = 'space_client' | 'space_project' | 'drive_folder' | 'todo' | 'goal';

type ActiveSession = typeof uploadQrSessions.$inferSelect;

function toTarget(target: UploadQrTarget): { targetKind: TargetKind; targetId: string } {
  if (target.kind === 'space') {
    return {
      targetKind: target.scopeKind === 'client' ? 'space_client' : 'space_project',
      targetId: target.scopeId,
    };
  }
  if (target.kind === 'drive') {
    return { targetKind: 'drive_folder', targetId: target.folderId };
  }
  if (target.kind === 'goal') {
    return { targetKind: 'goal', targetId: target.goalId };
  }
  return { targetKind: 'todo', targetId: target.todoId };
}

function fromTarget(session: ActiveSession): UploadQrTarget {
  if (session.targetKind === 'space_client') {
    return { kind: 'space', scopeKind: 'client', scopeId: session.targetId };
  }
  if (session.targetKind === 'space_project') {
    return { kind: 'space', scopeKind: 'project', scopeId: session.targetId };
  }
  if (session.targetKind === 'drive_folder') {
    return { kind: 'drive', folderId: session.targetId };
  }
  if (session.targetKind === 'goal') {
    return { kind: 'goal', goalId: session.targetId };
  }
  return { kind: 'todo', todoId: session.targetId };
}

function isExpired(session: ActiveSession): boolean {
  return new Date(session.expiresAt).getTime() < Date.now();
}

export async function createUploadQrSession(args: {
  createdBy: string;
  target: UploadQrTarget;
  label?: string;
  expiresAt: string;
}): Promise<ActiveSession> {
  const token = randomUUID();
  const { targetKind, targetId } = toTarget(args.target);

  const [row] = await db
    .insert(uploadQrSessions)
    .values({
      tenantId: currentTenantId(),
      token,
      createdByUserId: args.createdBy,
      targetKind,
      targetId,
      label: args.label ?? 'Mobile upload',
      expiresAt: args.expiresAt,
    })
    .returning();

  if (!row) throw new Error('upload qr session insert failed');
  return row;
}

export async function getUploadQrSession(token: string): Promise<ActiveSession> {
  const [row] = await db
    .select()
    .from(uploadQrSessions)
    .where(eq(uploadQrSessions.token, token))
    .limit(1);

  if (!row || row.revokedAt) throw new HttpError(404, 'upload_qr_not_found');
  if (isExpired(row)) throw new HttpError(410, 'upload_qr_expired');
  return row;
}

export type ActiveUploadQrSessionRow = {
  id: string;
  token: string;
  label: string;
  targetKind: string;
  targetId: string;
  uploadedCount: number;
  lastUploadedAt: string | null;
  createdAt: string;
  expiresAt: string;
  createdByUserId: string;
  createdByName: string | null;
  createdByEmail: string | null;
};

export async function listActiveUploadQrSessions(): Promise<ActiveUploadQrSessionRow[]> {
  const nowIso = new Date().toISOString();
  return db
    .select({
      id: uploadQrSessions.id,
      token: uploadQrSessions.token,
      label: uploadQrSessions.label,
      targetKind: uploadQrSessions.targetKind,
      targetId: uploadQrSessions.targetId,
      uploadedCount: uploadQrSessions.uploadedCount,
      lastUploadedAt: uploadQrSessions.lastUploadedAt,
      createdAt: uploadQrSessions.createdAt,
      expiresAt: uploadQrSessions.expiresAt,
      createdByUserId: uploadQrSessions.createdByUserId,
      createdByName: users.name,
      createdByEmail: users.email,
    })
    .from(uploadQrSessions)
    .leftJoin(users, eq(users.id, uploadQrSessions.createdByUserId))
    .where(and(tenantEq(uploadQrSessions.tenantId), isNull(uploadQrSessions.revokedAt), gt(uploadQrSessions.expiresAt, nowIso)))
    .orderBy(desc(uploadQrSessions.createdAt));
}

export async function revokeUploadQrSession(id: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const [updated] = await db
    .update(uploadQrSessions)
    .set({ revokedAt: nowIso, updatedAt: nowIso })
    .where(and(eq(uploadQrSessions.id, id), tenantEq(uploadQrSessions.tenantId), isNull(uploadQrSessions.revokedAt)))
    .returning({ id: uploadQrSessions.id });
  if (!updated) throw new HttpError(404, 'upload_qr_not_found');
}

export type UploadQrSessionFileRow = {
  id: string;
  sessionId: string;
  uploadTitle: string | null;
  uploadNotes: string | null;
  originalName: string;
  mimeType: string | null;
  sizeBytes: number;
  destinationKind: string;
  destinationId: string;
  storedFileId: string | null;
  storedFileUrl: string | null;
  createdAt: string;
};

export async function listUploadQrSessionFiles(sessionId: string): Promise<UploadQrSessionFileRow[]> {
  return db
    .select({
      id: uploadQrSessionFiles.id,
      sessionId: uploadQrSessionFiles.sessionId,
      uploadTitle: uploadQrSessionFiles.uploadTitle,
      uploadNotes: uploadQrSessionFiles.uploadNotes,
      originalName: uploadQrSessionFiles.originalName,
      mimeType: uploadQrSessionFiles.mimeType,
      sizeBytes: uploadQrSessionFiles.sizeBytes,
      destinationKind: uploadQrSessionFiles.destinationKind,
      destinationId: uploadQrSessionFiles.destinationId,
      storedFileId: uploadQrSessionFiles.storedFileId,
      storedFileUrl: uploadQrSessionFiles.storedFileUrl,
      createdAt: uploadQrSessionFiles.createdAt,
    })
    .from(uploadQrSessionFiles)
    .where(and(eq(uploadQrSessionFiles.sessionId, sessionId), tenantEq(uploadQrSessionFiles.tenantId)))
    .orderBy(desc(uploadQrSessionFiles.createdAt));
}

export async function uploadViaQrSession(
  token: string,
  files: Express.Multer.File[],
  options?: { uploadTitle?: string | null; uploadNotes?: string | null },
): Promise<{
  uploaded: Array<{ name: string; id?: string; url?: string }>;
  failed: Array<{ name: string; error: string }>;
}> {
  const session = await getUploadQrSession(token);
  // The public token-upload path has no request tenant context — establish it
  // from the session so the tenant-scoped upload services (uploadSpaceFile,
  // uploadTodoFile, uploadGoalResource, drive uploadFile) resolve the right
  // workspace.
  return withTenant(session.tenantId, async () => {
  const target = fromTarget(session);
  const uploadTitle = options?.uploadTitle ?? null;
  const uploadNotes = options?.uploadNotes ?? null;

  const uploaded: Array<{ name: string; id?: string; url?: string }> = [];
  const failed: Array<{ name: string; error: string }> = [];

  for (const f of files) {
    try {
      if (target.kind === 'space') {
        const out = await uploadSpaceFile({
          scopeKind: target.scopeKind,
          scopeId: target.scopeId,
          whoId: session.createdByUserId,
          filename: f.originalname,
          mimeType: f.mimetype,
          buffer: f.buffer,
        });
        uploaded.push({ name: out.file.title, id: out.file.id, url: out.file.url });
        await db.insert(uploadQrSessionFiles).values({
          tenantId: session.tenantId,
          sessionId: session.id,
          uploadTitle,
          uploadNotes,
          originalName: f.originalname,
          mimeType: f.mimetype,
          sizeBytes: f.size,
          destinationKind: `space_${target.scopeKind}`,
          destinationId: target.scopeId,
          storedFileId: out.file.id,
          storedFileUrl: out.file.url,
        });
        continue;
      }

      if (target.kind === 'todo') {
        const out = await uploadTodoFile({
          todoId: target.todoId,
          whoId: session.createdByUserId,
          filename: f.originalname,
          mimeType: f.mimetype,
          buffer: f.buffer,
        });
        uploaded.push({ name: out.file.title, id: out.file.id, url: out.file.url });
        await db.insert(uploadQrSessionFiles).values({
          tenantId: session.tenantId,
          sessionId: session.id,
          uploadTitle,
          uploadNotes,
          originalName: f.originalname,
          mimeType: f.mimetype,
          sizeBytes: f.size,
          destinationKind: 'todo',
          destinationId: target.todoId,
          storedFileId: out.file.id,
          storedFileUrl: out.file.url,
        });
        continue;
      }

      if (target.kind === 'goal') {
        const out = await uploadGoalResource(
          target.goalId,
          {
            originalname: f.originalname,
            mimetype: f.mimetype,
            buffer: f.buffer,
            size: f.size,
          },
          session.createdByUserId,
        );
        uploaded.push({ name: out.title, id: out.id, url: out.url });
        await db.insert(uploadQrSessionFiles).values({
          tenantId: session.tenantId,
          sessionId: session.id,
          uploadTitle,
          uploadNotes,
          originalName: f.originalname,
          mimeType: f.mimetype,
          sizeBytes: f.size,
          destinationKind: 'goal',
          destinationId: target.goalId,
          storedFileId: out.id,
          storedFileUrl: out.url,
        });
        continue;
      }

      const driveEntry = await uploadFile(target.folderId, f.originalname, f.mimetype, f.buffer);
      uploaded.push({
        name: driveEntry.name,
        id: driveEntry.id,
        url: driveEntry.webViewLink ?? `https://drive.google.com/file/d/${driveEntry.id}/view`,
      });
      await db.insert(uploadQrSessionFiles).values({
        tenantId: session.tenantId,
        sessionId: session.id,
        uploadTitle,
        uploadNotes,
        originalName: f.originalname,
        mimeType: f.mimetype,
        sizeBytes: f.size,
        destinationKind: 'drive_folder',
        destinationId: target.folderId,
        storedFileId: driveEntry.id,
        storedFileUrl: driveEntry.webViewLink ?? `https://drive.google.com/file/d/${driveEntry.id}/view`,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'upload_failed';
      failed.push({ name: f.originalname, error: message });
    }
  }

  if (uploaded.length > 0) {
    await db
      .update(uploadQrSessions)
      .set({
        uploadedCount: session.uploadedCount + uploaded.length,
        lastUploadedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(uploadQrSessions.id, session.id));
  }

  return { uploaded, failed };
  });
}
