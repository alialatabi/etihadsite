/**
 * In-memory sliding-window rate limiter. Pure apart from the injected clock.
 * State lives in the Node process (fine for the single local server).
 */
export interface RateLimiter {
  /** Records a hit for `key`; ok=false when over the limit (the hit is not counted then). */
  check(key: string): { ok: boolean; retryAfterSec: number };
}

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

/** Hard cap on tracked keys; the oldest-inserted key is evicted past it. */
const MAX_KEYS = 5000;

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
export function clientIp(
  request: Request,
  hops: number = trustProxyHops(),
): string {
  if (hops <= 0) return "global";
  const parts = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts[parts.length - hops] || "global";
}

const HOUR = 60 * 60 * 1000;
type Limiters = {
  upload: RateLimiter;
  order: RateLimiter;
  log: RateLimiter;
  login: RateLimiter;
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
    g.__epLimiters = {
      mode,
      upload: createRateLimiter({ limit: 20 * k, windowMs: HOUR }),
      order: createRateLimiter({ limit: 5 * k, windowMs: HOUR }),
      log: createRateLimiter({ limit: 60 * k, windowMs: HOUR }),
      login: createRateLimiter({ limit: 10 * k, windowMs: 15 * 60 * 1000 }),
    };
  }
  return g.__epLimiters;
}
