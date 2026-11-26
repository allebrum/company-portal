import { createHash } from 'node:crypto';
import type {
  FormDefinition,
} from '@allebrum/shared';
import {
  DEFAULT_MAX_SUBMISSIONS_PER_HOUR,
  DEFAULT_MAX_SUBMISSIONS_PER_IP_PER_HOUR,
  DEFAULT_RESUBMIT_WINDOW_HOURS,
  FORM_ALREADY_SUBMITTED_MESSAGE,
  FORM_RATE_LIMITED_MESSAGE,
} from '@allebrum/shared';
/** Small Redis surface used by the submit guard (and a memory fake in tests). */
export type RedisCounter = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<string | null>;
};

/** Short burst cap: 5 accepted submissions / 10 minutes / visitor / form. */
export const FORM_SUBMIT_BURST_MAX = 5;
export const FORM_SUBMIT_BURST_WINDOW_SEC = 10 * 60;
/** Ignore an identical repeat from the same visitor for 10 minutes. */
export const FORM_DEDUPE_WINDOW_SEC = 10 * 60;

export function hashVisitorToken(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

export type SubmitGuardInput = {
  formId: string;
  ip: string | null;
  sessionId: string | null;
  answers: Record<string, unknown>;
  definition: FormDefinition;
  redis: RedisCounter;
};

export type SubmitGuardResult =
  | { ok: true }
  | { ok: true; skipStore: 'already_submitted' | 'duplicate'; message: string }
  | { ok: false; status: 429; errors: { __form: string } };

function visitorKeyPart(ip: string | null): string {
  return hashVisitorToken((ip && ip.trim()) || 'unknown');
}

function stableAnswers(answers: Record<string, unknown>): string {
  const keys = Object.keys(answers).sort();
  const norm: Record<string, unknown> = {};
  for (const k of keys) {
    const v = answers[k];
    if (Array.isArray(v)) norm[k] = [...v].map((x) => String(x)).sort();
    else if (v == null) norm[k] = '';
    else if (typeof v === 'boolean' || typeof v === 'number') norm[k] = v;
    else norm[k] = String(v);
  }
  return JSON.stringify(norm);
}

async function incrWindow(redis: RedisCounter, key: string, windowSec: number): Promise<number> {
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, windowSec);
  return n;
}

/**
 * Per-form / per-visitor limits for an already-validated public submission.
 *
 * Redis keys hash the IP (and session id) so raw addresses are not stored
 * there. Fail open if Redis is down, matching the coarse IP limiter.
 *
 * Turnstile (and other captchas) are not a volume throttle — they only
 * verify a human and typically consume a token once. These counters are
 * what actually cap how many accepted submissions a visitor or form can
 * produce.
 */
export async function guardPublicSubmit(input: SubmitGuardInput): Promise<SubmitGuardResult> {
  const redis = input.redis;
  const def = input.definition;
  const allowMore = def.allowAnotherSubmission !== false;
  const ipHash = visitorKeyPart(input.ip);
  const formId = input.formId;
  const successMessage = def.successMessage || 'Thanks, we got your submission.';

  try {
    if (!allowMore) {
      const windowSec = Math.max(1, def.resubmitWindowHours ?? DEFAULT_RESUBMIT_WINDOW_HOURS) * 3600;
      const onceIpKey = `form:once:${formId}:ip:${ipHash}`;
      const onceSidKey = input.sessionId
        ? `form:once:${formId}:sid:${hashVisitorToken(input.sessionId)}`
        : null;

      const existing = (await redis.get(onceIpKey)) ?? (onceSidKey ? await redis.get(onceSidKey) : null);
      if (existing) {
        return { ok: true, skipStore: 'already_submitted', message: FORM_ALREADY_SUBMITTED_MESSAGE };
      }

      const claimed = await redis.set(onceIpKey, '1', 'EX', windowSec, 'NX');
      if (claimed !== 'OK') {
        return { ok: true, skipStore: 'already_submitted', message: FORM_ALREADY_SUBMITTED_MESSAGE };
      }
      if (onceSidKey) {
        await redis.set(onceSidKey, '1', 'EX', windowSec);
      }
    }

    const dedupeKey = `form:dedupe:${hashVisitorToken(`${formId}|${ipHash}|${stableAnswers(input.answers)}`)}`;
    const fresh = await redis.set(dedupeKey, '1', 'EX', FORM_DEDUPE_WINDOW_SEC, 'NX');
    if (fresh !== 'OK') {
      return { ok: true, skipStore: 'duplicate', message: successMessage };
    }

    const ipHourMax = def.maxSubmissionsPerIpPerHour ?? DEFAULT_MAX_SUBMISSIONS_PER_IP_PER_HOUR;
    const formHourMax = def.maxSubmissionsPerHour ?? DEFAULT_MAX_SUBMISSIONS_PER_HOUR;

    const burst = await incrWindow(redis, `form:rl:${formId}:ip:${ipHash}:10m`, FORM_SUBMIT_BURST_WINDOW_SEC);
    if (burst > FORM_SUBMIT_BURST_MAX) {
      return { ok: false, status: 429, errors: { __form: FORM_RATE_LIMITED_MESSAGE } };
    }
    const ipHour = await incrWindow(redis, `form:rl:${formId}:ip:${ipHash}:1h`, 3600);
    if (ipHour > ipHourMax) {
      return { ok: false, status: 429, errors: { __form: FORM_RATE_LIMITED_MESSAGE } };
    }
    const formHour = await incrWindow(redis, `form:rl:${formId}:1h`, 3600);
    if (formHour > formHourMax) {
      return { ok: false, status: 429, errors: { __form: FORM_RATE_LIMITED_MESSAGE } };
    }

    return { ok: true };
  } catch {
    return { ok: true };
  }
}

/** In-memory Redis stand-in for unit tests. */
export function memoryRedis(): RedisCounter {
  type Entry = { value: string; exp?: number };
  const store = new Map<string, Entry>();
  const now = () => Date.now();
  const alive = (key: string): Entry | null => {
    const e = store.get(key);
    if (!e) return null;
    if (e.exp !== undefined && e.exp <= now()) {
      store.delete(key);
      return null;
    }
    return e;
  };
  return {
    async incr(key) {
      const e = alive(key);
      const n = (e ? Number(e.value) || 0 : 0) + 1;
      store.set(key, { value: String(n), exp: e?.exp });
      return n;
    },
    async expire(key, seconds) {
      const e = alive(key);
      if (e) store.set(key, { value: e.value, exp: now() + seconds * 1000 });
    },
    async get(key) {
      return alive(key)?.value ?? null;
    },
    async set(key, value, ...args) {
      let ttl: number | undefined;
      let nx = false;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === 'EX') {
          ttl = Number(args[i + 1]);
          i += 1;
        } else if (args[i] === 'NX') {
          nx = true;
        }
      }
      if (nx && alive(key)) return null;
      store.set(key, { value, exp: ttl !== undefined ? now() + ttl * 1000 : undefined });
      return 'OK';
    },
  };
}
