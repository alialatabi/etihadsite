import { adminApiGuard } from '@/lib/auth/session';
import { getStorage } from '@/lib/storage';
import { ID_RE } from '@/lib/storage/paths';

export const dynamic = 'force-dynamic';

/** GET /api/admin/designs/<uploadId>/image — a generated design, shown inline. Auth re-checked here. */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return new Response(null, { status: 404 });

  const file = await getStorage().readUpload(id);
  if (!file) return new Response(null, { status: 404 });

  return new Response(file.bytes as BodyInit, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(file.bytes.byteLength),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
