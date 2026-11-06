/**
 * In-memory sliding-window rate limiter. Pure apart from the injected clock.
 * State lives in the Node process (fine for the single local server).
 */
export interface RateLimiter {
  /** Records a hit for `key`; ok=false when over the limit (the hit is not counted then). */
  check(key: string): { ok: boolean; retryAfterSec: number };
}

export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();
  return {
    check(key) {
      const t = now();
      const fresh = (hits.get(key) ?? []).filter((x) => t - x < opts.windowMs);
      if (fresh.length >= opts.limit) {
        hits.set(key, fresh);
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((fresh[0] + opts.windowMs - t) / 1000)) };
      }
      fresh.push(t);
      hits.set(key, fresh);
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (v.every((x) => t - x >= opts.windowMs)) hits.delete(k);
      }
      return { ok: true, retryAfterSec: 0 };
    },
  };
}

/** First value of x-forwarded-for, else 127.0.0.1. */
export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  return first || '127.0.0.1';
}

const HOUR = 60 * 60 * 1000;
type Limiters = { upload: RateLimiter; order: RateLimiter; log: RateLimiter; login: RateLimiter };
const g = globalThis as unknown as { __epLimiters?: Limiters };

/** Shared limiters (kept on globalThis so dev hot reload does not reset them). */
export function limiters(): Limiters {
  return (g.__epLimiters ??= {
    upload: createRateLimiter({ limit: 20, windowMs: HOUR }),
    order: createRateLimiter({ limit: 5, windowMs: HOUR }),
    log: createRateLimiter({ limit: 60, windowMs: HOUR }),
    login: createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 }),
  });
}
