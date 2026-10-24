import { HttpError } from './errorHandler.js';

/** Header a client sends to opt in: the `updatedAt` it last read. */
export const EXPECTED_UPDATED_AT_HEADER = 'x-expected-updated-at';

const TS_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

/** Validates the header value; undefined when absent, throws 400 when malformed. */
export function readExpectedUpdatedAt(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  // Accept ISO-8601 and Postgres' text form ("2026-10-23 23:39:49.853-07"),
  // which is what the API returns in `updatedAt`.
  if (value.length > 64 || !TS_RE.test(value)) {
    throw new HttpError(400, 'invalid_expected_updated_at');
  }
  return value;
}
