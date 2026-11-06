import { clientLogSchema } from '@/lib/order-schema';
import { clientIp, limiters } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** POST ClientLogEvent JSON → console.warn. Always 204 (never reveals validation or limits). */
export async function POST(request: Request): Promise<Response> {
  try {
    if (limiters().log.check(clientIp(request)).ok) {
      const parsed = clientLogSchema.safeParse(await request.json());
      if (parsed.success) console.warn('[client]', JSON.stringify(parsed.data));
    }
  } catch {
    /* ignore malformed bodies */
  }
  return new Response(null, { status: 204 });
}
