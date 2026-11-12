import { createHmac } from 'node:crypto';

/**
 * Minimal RFC 6238 TOTP code generator for stored third-party 2FA seeds
 * (credentials vault). Accepts a base32 seed or an otpauth:// URI. We roll
 * our own instead of otplib because otplib's guardrails reject the common
 * 80-bit seeds many providers still issue.
 */
export interface TotpParams {
  secret: Buffer;
  digits: number;
  period: number;
  algorithm: 'sha1' | 'sha256' | 'sha512';
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('totp_bad_secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (out.length < 5) throw new Error('totp_bad_secret');
  return Buffer.from(out);
}

/** Parse a base32 seed or otpauth://totp/...?secret=...&digits=&period=&algorithm= */
export function parseTotp(raw: string): TotpParams {
  const v = raw.trim();
  if (/^otpauth:\/\//i.test(v)) {
    const u = new URL(v);
    if (u.hostname.toLowerCase() !== 'totp') throw new Error('totp_unsupported');
    const secret = u.searchParams.get('secret');
    if (!secret) throw new Error('totp_bad_secret');
    const digits = Number(u.searchParams.get('digits') ?? 6);
    const period = Number(u.searchParams.get('period') ?? 30);
    const alg = (u.searchParams.get('algorithm') ?? 'SHA1').toLowerCase();
    if (![6, 7, 8].includes(digits) || !(period >= 10 && period <= 300)) throw new Error('totp_unsupported');
    if (alg !== 'sha1' && alg !== 'sha256' && alg !== 'sha512') throw new Error('totp_unsupported');
    return { secret: base32Decode(secret), digits, period, algorithm: alg };
  }
  return { secret: base32Decode(v), digits: 6, period: 30, algorithm: 'sha1' };
}

export function totpCode(p: TotpParams, nowMs = Date.now()): { code: string; expiresInSec: number } {
  const step = Math.floor(nowMs / 1000 / p.period);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac(p.algorithm, p.secret).update(counter).digest();
  const off = h[h.length - 1]! & 0x0f;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  const code = String(bin % 10 ** p.digits).padStart(p.digits, '0');
  const expiresInSec = p.period - (Math.floor(nowMs / 1000) % p.period);
  return { code, expiresInSec };
}
