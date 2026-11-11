import { z } from 'zod';
import { SMALL_JSON_MAX_BYTES, readJsonCapped } from '../_lib/body';
import { classifySource, isBot } from '@/lib/analytics/classify';
import { isStaffPath } from '@/lib/analytics/paths';
import { trackServer, visitorHash } from '@/lib/analytics/server';
import { limiters } from '@/lib/rate-limit';
import { BUILDER_STEPS, INSTALL_EVENTS } from '@/lib/types';

export const dynamic = 'force-dynamic';

const STEPS = [...BUILDER_STEPS, ...INSTALL_EVENTS] as const;

const bodySchema = z.object({
  type: z.enum(['pageview', 'step', 'install']),
  path: z.string().max(200).startsWith('/'),
  step: z.enum(STEPS).optional(),
  referrer: z.string().max(500).optional(),
  utm: z.string().max(60).optional(),
});

const noContent = () => new Response(null, { status: 204 });

/** POST /api/track — first-party, cookieless analytics beacon. 204 unless the body is invalid. */
export async function POST(request: Request): Promise<Response> {
  try {
    const ua = request.headers.get('user-agent');
    let json: unknown;
    try {
      json = await readJsonCapped(request, SMALL_JSON_MAX_BYTES);
    } catch {
      return new Response(null, { status: 400 });
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) return new Response(null, { status: 400 });
    const b = parsed.data;

    if (isBot(ua) || b.path === '/admin' || b.path.startsWith('/admin/') || isStaffPath(b.path)) return noContent();

    const visitor = visitorHash(request);
    if (!limiters().track.check(visitor).ok) return noContent();

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
    });
    return noContent();
  } catch (e) {
    console.error('[track] failed', e);
    return noContent();
  }
}
