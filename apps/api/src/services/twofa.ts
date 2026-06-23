import { eq, and, isNull, inArray } from 'drizzle-orm';
import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { db } from '../db/client.js';
import {
  userTotp,
  userRecoveryCodes,
  webauthnCredentials,
  userGroups,
  groups,
} from '../db/schema.js';
import { getUser } from './users.js';
import { webauthnOrigin, webauthnRpId } from '../env.js';
import type { TwoFactorStatus } from '@modernzen/shared';

// ---- requirement / status ----
export async function groupRequires2fa(userId: string): Promise<boolean> {
  const rows = await db
    .select({ require2fa: groups.require2fa })
    .from(userGroups)
    .innerJoin(groups, eq(groups.id, userGroups.groupId))
    .where(eq(userGroups.userId, userId));
  return rows.some((r) => r.require2fa);
}

export async function getTotp(userId: string) {
  const rows = await db.select().from(userTotp).where(eq(userTotp.userId, userId)).limit(1);
  return rows[0];
}

export async function listPasskeys(userId: string) {
  return db
    .select({ id: webauthnCredentials.id, name: webauthnCredentials.name, createdAt: webauthnCredentials.createdAt })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId));
}

export async function hasAnySecondFactor(userId: string): Promise<boolean> {
  const totp = await getTotp(userId);
  if (totp?.enabled) return true;
  const pk = await listPasskeys(userId);
  return pk.length > 0;
}

/** A second factor must be presented if the user enrolled one OR a group enforces it. */
export async function needsSecondFactor(userId: string): Promise<boolean> {
  if (await hasAnySecondFactor(userId)) return true;
  return groupRequires2fa(userId);
}

export async function getStatus(userId: string): Promise<TwoFactorStatus> {
  const [totp, passkeys, required] = await Promise.all([
    getTotp(userId),
    listPasskeys(userId),
    groupRequires2fa(userId),
  ]);
  return {
    required,
    totpEnabled: !!totp?.enabled,
    passkeys: passkeys.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt })),
  };
}

// ---- recovery codes ----
function genRecoveryCode(): string {
  const raw = randomBytes(5).toString('hex'); // 10 hex chars
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  await db.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
  const codes = Array.from({ length: 10 }, genRecoveryCode);
  const rows = await Promise.all(
    codes.map(async (c) => ({ id: randomUUID(), userId, codeHash: await argon2.hash(c) })),
  );
  await db.insert(userRecoveryCodes).values(rows);
  return codes;
}

async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(userRecoveryCodes)
    .where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)));
  for (const r of rows) {
    if (await argon2.verify(r.codeHash, code)) {
      await db
        .update(userRecoveryCodes)
        .set({ usedAt: new Date().toISOString() })
        .where(eq(userRecoveryCodes.id, r.id));
      return true;
    }
  }
  return false;
}

// ---- TOTP ----
export async function startTotpSetup(userId: string): Promise<{ otpauthUrl: string; qrDataUrl: string }> {
  const user = await getUser(userId);
  if (!user) throw new Error('user_not_found');
  const secret = generateSecret();
  await db
    .insert(userTotp)
    .values({ userId, secret, enabled: false })
    .onConflictDoUpdate({ target: userTotp.userId, set: { secret, enabled: false, verifiedAt: null } });
  const otpauthUrl = generateURI({ issuer: 'Allebrum Portal', label: user.email, secret });
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
  return { otpauthUrl, qrDataUrl };
}

export async function enableTotp(userId: string, code: string): Promise<string[]> {
  const row = await getTotp(userId);
  if (!row) throw new Error('totp_not_started');
  if (!verifySync({ secret: row.secret, token: code }).valid) {
    throw new Error('invalid_code');
  }
  await db
    .update(userTotp)
    .set({ enabled: true, verifiedAt: new Date().toISOString() })
    .where(eq(userTotp.userId, userId));
  return regenerateRecoveryCodes(userId);
}

export async function disableTotp(userId: string): Promise<void> {
  await db.delete(userTotp).where(eq(userTotp.userId, userId));
}

/** Verify a 6-digit TOTP token, falling back to a one-time recovery code. */
export async function verifySecondFactorCode(userId: string, code: string): Promise<boolean> {
  const row = await getTotp(userId);
  const clean = code.trim();
  if (
    row?.enabled &&
    /^\d{6}$/.test(clean) &&
    verifySync({ secret: row.secret, token: clean, epochTolerance: 30 }).valid
  ) {
    return true;
  }
  return consumeRecoveryCode(userId, clean);
}

// ---- WebAuthn ----
export async function webauthnRegisterOptions(userId: string) {
  const user = await getUser(userId);
  if (!user) throw new Error('user_not_found');
  const existing = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId));
  const options = await generateRegistrationOptions({
    rpName: 'Allebrum Portal',
    rpID: webauthnRpId,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credentialId })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
  return options;
}

export async function webauthnRegisterVerify(
  userId: string,
  response: unknown,
  expectedChallenge: string,
  name: string,
): Promise<boolean> {
  const verification = await verifyRegistrationResponse({
    response: response as Parameters<typeof verifyRegistrationResponse>[0]['response'],
    expectedChallenge,
    expectedOrigin: webauthnOrigin,
    expectedRPID: webauthnRpId,
  });
  if (!verification.verified || !verification.registrationInfo) return false;
  const { credential } = verification.registrationInfo;
  await db.insert(webauthnCredentials).values({
    userId,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports ?? [],
    name: name || 'Passkey',
  });
  return true;
}

export async function webauthnAuthOptions(userId: string) {
  const creds = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId));
  return generateAuthenticationOptions({
    rpID: webauthnRpId,
    allowCredentials: creds.map((c) => ({ id: c.credentialId })),
    userVerification: 'preferred',
  });
}

export async function webauthnAuthVerify(
  userId: string,
  response: unknown,
  expectedChallenge: string,
): Promise<boolean> {
  const resp = response as { id?: string };
  const credId = typeof resp?.id === 'string' ? resp.id : '';
  const rows = await db
    .select()
    .from(webauthnCredentials)
    .where(and(eq(webauthnCredentials.userId, userId), eq(webauthnCredentials.credentialId, credId)))
    .limit(1);
  const cred = rows[0];
  if (!cred) return false;
  const verification = await verifyAuthenticationResponse({
    response: response as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
    expectedChallenge,
    expectedOrigin: webauthnOrigin,
    expectedRPID: webauthnRpId,
    credential: {
      id: cred.credentialId,
      publicKey: new Uint8Array(Buffer.from(cred.publicKey, 'base64url')),
      counter: cred.counter,
      transports: cred.transports as ('ble' | 'hybrid' | 'internal' | 'nfc' | 'usb')[],
    },
  });
  if (!verification.verified) return false;
  await db
    .update(webauthnCredentials)
    .set({ counter: verification.authenticationInfo.newCounter })
    .where(eq(webauthnCredentials.id, cred.id));
  return true;
}

export async function deletePasskey(userId: string, id: string): Promise<void> {
  await db
    .delete(webauthnCredentials)
    .where(and(eq(webauthnCredentials.userId, userId), eq(webauthnCredentials.id, id)));
}

export async function renamePasskey(userId: string, id: string, name: string): Promise<void> {
  await db
    .update(webauthnCredentials)
    .set({ name })
    .where(and(eq(webauthnCredentials.userId, userId), eq(webauthnCredentials.id, id)));
}

// keep imports tree-shake-safe
void inArray;
