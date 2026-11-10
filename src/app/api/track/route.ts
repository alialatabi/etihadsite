import { z } from 'zod';
import { readCapped } from '../_lib/body';
import { classifyDevice, classifySource, isBot } from '@/lib/analytics/classify';
import { trackServer, visitorHash } from '@/lib/analytics/server';
import { createRateLimiter, type RateLimiter } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const STEPS = [
  'shape', 'design', 'size', 'quantity', 'details', // builder steps
  'shown', 'accepted', 'installed', // install events
] as const;

const bodySchema = z.object({
  type: z.enum(['pageview', 'step', 'install']),
  path: z.string().max(200).startsWith('/'),
  step: z.enum(STEPS).optional(),
  referrer: z.string().max(500).optional(),
  utm: z.string().max(60).optional(),
});

const g = globalThis as unknown as { __epTrackLimiter?: RateLimiter };
function limiter(): RateLimiter {
  return (g.__epTrackLimiter ??= createRateLimiter({ limit: 300, windowMs: 60 * 60 * 1000 }));
}

const noContent = () => new Response(null, { status: 204 });

/** POST /api/track — first-party, cookieless analytics beacon. 204 unless the body is invalid. */
export async function POST(request: Request): Promise<Response> {
  try {
    const ua = request.headers.get('user-agent');
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(await readCapped(request, 4096)));
    } catch {
      return new Response(null, { status: 400 });
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) return new Response(null, { status: 400 });
    const b = parsed.data;

    if (isBot(ua) || b.path === '/admin' || b.path.startsWith('/admin/')) return noContent();

    const visitor = visitorHash(request);
    if (!limiter().check(visitor).ok) return noContent();

    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    await trackServer(request, {
      type: b.type,
      visitor,
      path: b.path,
      ...(b.step ? { step: b.step } : {}),
      // Only a pageview carrying a referrer/utm gets a source; the raw URL is never stored.
      ...(b.type === 'pageview' && (b.referrer !== undefined || b.utm)
        ? { source: classifySource(b.referrer, b.utm, host) }
        : {}),
      device: classifyDevice(ua),
    });
    return noContent();
  } catch (e) {
    console.error('[track] failed', e);
    return noContent();
  }
}
