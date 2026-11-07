import { clientLogSchema } from "@/lib/order-schema";
import { clientIp, limiters } from "@/lib/rate-limit";
import { BodyTooLarge, readJsonCapped } from "../_lib/body";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;

/** POST ClientLogEvent JSON → console.warn. 204 normally (never reveals validation or limits); 413 when oversize. */
export async function POST(request: Request): Promise<Response> {
  try {
    if (limiters().log.check(clientIp(request)).ok) {
      const parsed = clientLogSchema.safeParse(
        await readJsonCapped(request, MAX_BODY_BYTES),
      );
      if (parsed.success) console.warn("[client]", JSON.stringify(parsed.data));
    }
  } catch (e) {
    if (e instanceof BodyTooLarge) return new Response(null, { status: 413 });
    /* ignore malformed bodies */
  }
  return new Response(null, { status: 204 });
}
