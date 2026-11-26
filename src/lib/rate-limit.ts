/**
 * In-memory sliding-window rate limiter. Pure apart from the injected clock.
 * State is per process: on serverless hosting every instance counts on its own, so these
 * limits are a per-instance guard and not a site-wide quota (see README, "Still open").
 */
export interface RateLimiter {
  /** Records a hit for `key`; ok=false when over the limit (the hit is not counted then). */
  check(key: string): { ok: boolean; retryAfterSec: number };
}

/** Hard cap on tracked keys; the oldest-inserted key is evicted past it. */
const MAX_KEYS = 5000;

export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();
  return {
    check(key) {
      const t = now();
      const fresh = (hits.get(key) ?? []).filter((x) => t - x < opts.windowMs);
      if (fresh.length >= opts.limit) {
        hits.set(key, fresh);
        return {
          ok: false,
          retryAfterSec: Math.max(
            1,
            Math.ceil((fresh[0] + opts.windowMs - t) / 1000),
          ),
        };
      }
      fresh.push(t);
      hits.set(key, fresh);
      if (hits.size > MAX_KEYS) {
        for (const [k, v] of hits)
          if (v.every((x) => t - x >= opts.windowMs)) hits.delete(k);
        while (hits.size > MAX_KEYS)
          hits.delete(hits.keys().next().value as string);
      }
      return { ok: true, retryAfterSec: 0 };
    },
  };
}

/** Number of trusted proxy hops from TRUST_PROXY (integer >= 0, default 0). */
export function trustProxyHops(): number {
  const n = Number(process.env.TRUST_PROXY);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 10) : 0;
}

/**
 * Rate-limit key for the caller. With hops = 0 the (client-controlled) x-forwarded-for
 * header is ignored and everyone shares the key "global". With hops = n the n-th value
 * from the END of x-forwarded-for is used (the part appended by our own proxies).
 */
export function clientIpFromHeaders(
  headers: { get(name: string): string | null },
  hops: number = trustProxyHops(),
): string {
  if (hops <= 0) return "global";
  const parts = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts[parts.length - hops] || "global";
}

/** clientIpFromHeaders() for a Request (route handlers). */
export function clientIp(
  request: Request,
  hops: number = trustProxyHops(),
): string {
  // As before the split: with no trusted hop the request is not read at all.
  if (hops <= 0) return "global";
  return clientIpFromHeaders(request.headers, hops);
}

const HOUR = 60 * 60 * 1000;
/** Per-address limits; multiplied by 20 when there is no trusted proxy (one global bucket). */
const SCALED = {
  upload: { limit: 20, windowMs: HOUR },
  commit: { limit: 40, windowMs: HOUR },
  trackIp: { limit: 600, windowMs: HOUR },
  order: { limit: 5, windowMs: HOUR },
  log: { limit: 60, windowMs: HOUR },
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  brief: { limit: 30, windowMs: HOUR },
  generate: { limit: 15, windowMs: HOUR },
} as const;
type ScaledName = keyof typeof SCALED;
const scaled = (name: ScaledName, k: number) =>
  createRateLimiter({ limit: SCALED[name].limit * k, windowMs: SCALED[name].windowMs });
// Keyed by the visitor hash, not by clientIp(): no shared "global" bucket, so no x20, and a mode change does not reset it.
const trackLimiter = () => createRateLimiter({ limit: 300, windowMs: HOUR });
// Keyed by the staff account ('staff:<id>'), never by IP: no shared bucket, so no x20. Bounds a stolen session per hour;
// the stored daily limit (50 images per account) is the real cap.
const STAFF = { staffBrief: { limit: 120, windowMs: HOUR }, staffGenerate: { limit: 60, windowMs: HOUR } } as const;
const staffLimiter = (name: keyof typeof STAFF) => createRateLimiter(STAFF[name]);
// Added after the first limiter set (2026-11-21): a set that survived a dev hot reload gets them without resetting the others.
const BACKFILLED = ['brief', 'generate', 'commit', 'trackIp'] as const satisfies readonly ScaledName[];
type Limiters = {
  upload: RateLimiter;
  /** POST /api/upload/direct/commit: kept apart from `upload`, so the start and the commit of one real upload do not use two hits of the same allowance. */
  commit: RateLimiter;
  order: RateLimiter;
  log: RateLimiter;
  login: RateLimiter;
  track: RateLimiter;
  /** POST /api/track, keyed by clientIp(): a second guard, because the visitor hash changes with every User-Agent string. */
  trackIp: RateLimiter;
  /** POST /api/design/brief: a cheap first guard before the stored daily AI counter. */
  brief: RateLimiter;
  /** POST /api/design/generate: every attempt counts (never refunded), before refs and the stored reservation. */
  generate: RateLimiter;
  /** POST /api/team/design/brief, keyed by the staff account. */
  staffBrief: RateLimiter;
  /** POST /api/team/design/generate, keyed by the staff account (every attempt counts, like `generate`). */
  staffGenerate: RateLimiter;
  mode: number;
};
const g = globalThis as unknown as { __epLimiters?: Limiters };

/**
 * Shared limiters (kept on globalThis so dev hot reload does not reset them).
 * Without a trusted proxy there is a single global bucket per route, so limits are x20.
 */
export function limiters(): Limiters {
  const hops = trustProxyHops();
  const mode = hops > 0 ? 1 : 0;
  const k = mode ? 1 : 20;
  if (g.__epLimiters?.mode !== mode) {
    const prevTrack = g.__epLimiters?.track;
    g.__epLimiters = {
      mode,
      upload: scaled('upload', k),
      commit: scaled('commit', k),
      trackIp: scaled('trackIp', k),
      order: scaled('order', k),
      log: scaled('log', k),
      login: scaled('login', k),
      brief: scaled('brief', k),
      generate: scaled('generate', k),
      track: prevTrack ?? trackLimiter(),
      staffBrief: g.__epLimiters?.staffBrief ?? staffLimiter('staffBrief'),
      staffGenerate: g.__epLimiters?.staffGenerate ?? staffLimiter('staffGenerate'),
    };
  }
  g.__epLimiters.track ??= trackLimiter();
  for (const name of BACKFILLED) g.__epLimiters[name] ??= scaled(name, k);
  g.__epLimiters.staffBrief ??= staffLimiter('staffBrief');
  g.__epLimiters.staffGenerate ??= staffLimiter('staffGenerate');
  return g.__epLimiters;
}
