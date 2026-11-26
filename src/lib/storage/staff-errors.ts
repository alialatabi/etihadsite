/**
 * Typed errors of the staff-account storage methods. No imports at all: the local adapter loads
 * this file under tsx (scripts/purge-orders.ts), so it cannot use `@/` or `server-only`.
 *
 *   not_ready   the staff table / columns are missing (migration 20261126000000 not applied)
 *   phone_taken a staff account with this phone already exists
 */
export type StaffStorageErrorCode = 'not_ready' | 'phone_taken';

export class StaffStorageError extends Error {
  constructor(readonly code: StaffStorageErrorCode) {
    super(`staff storage: ${code}`);
    this.name = 'StaffStorageError';
  }
}

const isCode = (e: unknown, c: StaffStorageErrorCode): boolean =>
  e instanceof StaffStorageError
    ? e.code === c
    : typeof e === 'object' &&
      e !== null &&
      (e as { name?: unknown }).name === 'StaffStorageError' &&
      (e as { code?: unknown }).code === c;

export const isStaffNotReady = (e: unknown): boolean => isCode(e, 'not_ready');
export const isStaffPhoneTaken = (e: unknown): boolean => isCode(e, 'phone_taken');

/** Normalised Iraqi mobile (normalisePhone output): 964 + 7 + 9 digits. */
export const STAFF_PHONE_RE = /^9647\d{9}$/;
