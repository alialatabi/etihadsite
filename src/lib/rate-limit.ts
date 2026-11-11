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
type Limiters = {
  upload: RateLimiter;
  order: RateLimiter;
  log: RateLimiter;
  login: RateLimiter;
  track: RateLimiter;
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
  if (g.__epLimiters?.mode !== mode) {
    const k = mode ? 1 : 20;
    const prevTrack = g.__epLimiters?.track;
    g.__epLimiters = {
      mode,
      upload: createRateLimiter({ limit: 20 * k, windowMs: HOUR }),
      order: createRateLimiter({ limit: 5 * k, windowMs: HOUR }),
      log: createRateLimiter({ limit: 60 * k, windowMs: HOUR }),
      login: createRateLimiter({ limit: 10 * k, windowMs: 15 * 60 * 1000 }),
      // Keyed by the visitor hash, not by clientIp(): no shared "global" bucket, so no x20, and a mode change does not reset it.
      track: prevTrack ?? createRateLimiter({ limit: 300, windowMs: HOUR }),
    };
  }
  // An object built before `track` existed can survive a dev hot reload: add it without resetting the others.
  g.__epLimiters.track ??= createRateLimiter({ limit: 300, windowMs: HOUR });
  return g.__epLimiters;
}
