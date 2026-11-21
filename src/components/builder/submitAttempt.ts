import type { AttemptContext, SubmitInput } from './submitFlow';

/** sessionStorage key of the in-flight order attempt `{ v, orderId, fingerprint, savedAt }` (this tab only). */
export const ATTEMPT_KEY = 'ub:order-attempt:v1';
/** A stored attempt older than this is ignored (a new order id is made). */
export const ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * What defines an order, as two strings. `design` covers only the picked file (and the seed upload),
 * `order` covers everything. The rasterised JPG of the needs_raster path is NOT part of it: that
 * path swaps `ctx.uploadId` but leaves `input.design.file` alone, so the fingerprint stays stable.
 */
export interface AttemptFingerprint {
  order: string;
  design: string;
}

export function attemptFingerprint(input: SubmitInput, seedUploadId?: string): AttemptFingerprint {
  const f = input.design.file;
  const design = JSON.stringify([f.name, f.size, f.lastModified, seedUploadId ?? null]);
  // The WhatsApp-offers box is session-only (never restored after a reload), so it must not decide the order id: a
  // reload that finds it unticked would otherwise get a NEW id and could duplicate an order that already landed.
  // A replayed order keeps the choice it was first saved with.
  const customer = { ...input.customer, marketingOptIn: undefined };
  const order = JSON.stringify([input.spec, input.material, input.stickers, input.sheets, customer, design]);
  return { order, design };
}

/** The attempt kept in memory: its context and what it was made for. */
export interface KeptAttempt {
  ctx: AttemptContext;
  fp: AttemptFingerprint;
}

export interface StoredAttempt {
  orderId: string;
  /** `AttemptFingerprint.order` of the attempt. */
  fingerprint: string;
}

/** Parse what sessionStorage holds; anything unreadable, malformed or expired gives null. */
export function parseStoredAttempt(raw: unknown, now: number): StoredAttempt | null {
  if (typeof raw !== 'string') return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown> | null;
    if (!o || typeof o !== 'object' || o.v !== 1) return null;
    if (typeof o.orderId !== 'string' || !o.orderId || typeof o.fingerprint !== 'string' || !o.fingerprint) return null;
    if (typeof o.savedAt !== 'number' || !Number.isFinite(o.savedAt) || Math.abs(now - o.savedAt) > ATTEMPT_TTL_MS) return null;
    return { orderId: o.orderId, fingerprint: o.fingerprint };
  } catch {
    return null;
  }
}

export function serialiseAttempt(orderId: string, fingerprint: string, now: number): string {
  return JSON.stringify({ v: 1, orderId, fingerprint, savedAt: now });
}

/** A fresh context for a new order id; `seedUploadId` is the accepted AI design's upload, when it is the design. */
function freshContext(orderId: string, seedUploadId?: string): AttemptContext {
  return { orderId, rastered: false, ...(seedUploadId ? { uploadId: seedUploadId, seeded: true } : {}) };
}

/**
 * Which context this submit runs with.
 * - Same order as the kept attempt: the kept context (same id, finished upload).
 * - The order changed: a fresh id. The finished upload is kept only when the design did not change and
 *   it is not a rasterised JPG (that was drawn for the old sticker size).
 * - Nothing kept in memory (first submit, or after a reload): the stored id when its fingerprint matches
 *   (the server's idempotency then returns the order it already saved), otherwise a fresh id.
 */
export function resolveAttempt(args: {
  kept: KeptAttempt | null;
  stored: StoredAttempt | null;
  fp: AttemptFingerprint;
  seedUploadId?: string;
  newId: () => string;
}): AttemptContext {
  const { kept, stored, fp, seedUploadId, newId } = args;
  if (kept) {
    if (kept.fp.order === fp.order) return kept.ctx;
    const next = freshContext(newId(), seedUploadId);
    if (kept.fp.design === fp.design && !kept.ctx.rastered && kept.ctx.uploadId) {
      next.uploadId = kept.ctx.uploadId;
      if (kept.ctx.seeded) next.seeded = true;
      else delete next.seeded;
    }
    return next;
  }
  if (stored && stored.fingerprint === fp.order) return freshContext(stored.orderId, seedUploadId);
  return freshContext(newId(), seedUploadId);
}

/** After a failed answer: only `rate_limited` keeps the attempt (the same id may already be saved on the server). */
export function keepAttemptAfterError(code: string): boolean {
  return code === 'rate_limited';
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStore(): Store | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Best effort: a blocked or full sessionStorage just means no survival across a reload. */
export function loadStoredAttempt(now: number = Date.now(), store: Store | null = defaultStore()): StoredAttempt | null {
  try {
    return store ? parseStoredAttempt(store.getItem(ATTEMPT_KEY), now) : null;
  } catch {
    return null;
  }
}

export function saveStoredAttempt(orderId: string, fingerprint: string, now: number = Date.now(), store: Store | null = defaultStore()): void {
  try {
    store?.setItem(ATTEMPT_KEY, serialiseAttempt(orderId, fingerprint, now));
  } catch {
    /* ignore */
  }
}

export function clearStoredAttempt(store: Store | null = defaultStore()): void {
  try {
    store?.removeItem(ATTEMPT_KEY);
  } catch {
    /* ignore */
  }
}
